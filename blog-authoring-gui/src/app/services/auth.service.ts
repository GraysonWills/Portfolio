import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AuthenticationDetails,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession
} from 'amazon-cognito-identity-js';

type StoredSession = {
  username: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
};

export type LoginThrottleState = {
  locked: boolean;
  attemptsRemaining: number;
  retryAfterMs: number;
  maxAttempts: number;
  windowMs: number;
};

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly SESSION_KEY = 'blog_authoring_cognito_session_v1';
  private readonly LOGIN_ATTEMPTS_KEY = 'blog_authoring_login_attempts_v1';
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOGIN_WINDOW_MS = 5 * 60 * 1000;
  private readonly TOKEN_REFRESH_SKEW_MS = 60 * 1000;
  private session: StoredSession | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  private readonly userPool = new CognitoUserPool({
    UserPoolId: environment.cognito.userPoolId,
    ClientId: environment.cognito.clientId
  });

  constructor() {
    this.loadSession();
  }

  login(username: string, password: string): Observable<boolean> {
    const trimmedUser = (username || '').trim();
    const trimmedPass = (password || '').trim();
    if (!trimmedUser || !trimmedPass) return new Observable<boolean>((obs) => { obs.next(false); obs.complete(); });

    return new Observable<boolean>((observer) => {
      const throttle = this.getLoginThrottleState();
      if (throttle.locked) {
        observer.error(new Error(`Too many login attempts. Try again in ${this.formatDuration(throttle.retryAfterMs)}.`));
        return;
      }

      const cognitoUser = new CognitoUser({ Username: trimmedUser, Pool: this.userPool });
      const authDetails = new AuthenticationDetails({ Username: trimmedUser, Password: trimmedPass });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (result: CognitoUserSession) => {
          this.clearFailedLoginAttempts();
          this.persistSession(trimmedUser, result);
          observer.next(true);
          observer.complete();
        },
        onFailure: (err: any) => {
          this.recordFailedLoginAttempt();
          const nextState = this.getLoginThrottleState();
          if (nextState.locked) {
            observer.error(new Error(`Too many login attempts. Try again in ${this.formatDuration(nextState.retryAfterMs)}.`));
            return;
          }
          observer.error(new Error(err?.message || 'Invalid username or password'));
        }
      });
    });
  }

  logout(): void {
    try {
      this.userPool.getCurrentUser()?.signOut();
    } catch {
      // ignore
    }

    this.session = null;
    try {
      localStorage.removeItem(this.SESSION_KEY);
    } catch {
      // ignore
    }
  }

  isAuthenticated(): boolean {
    return !!(this.session?.username && (this.getIdToken() || this.session?.refreshToken));
  }

  getCurrentUser(): string | null {
    return this.session?.username || null;
  }

  getIdToken(): string | null {
    if (!this.session) return null;
    if (this.isTokenStale(this.session.expiresAtMs)) {
      return null;
    }
    return this.session.idToken;
  }

  async getValidIdToken(): Promise<string | null> {
    const existing = this.getIdToken();
    if (existing) return existing;

    if (!this.session?.refreshToken || !this.session?.username) return null;
    return this.refreshSession();
  }

  getLoginThrottleState(now: number = Date.now()): LoginThrottleState {
    const attempts = this.loadRecentFailedAttempts(now);
    const attemptsRemaining = Math.max(0, this.MAX_LOGIN_ATTEMPTS - attempts.length);

    if (attempts.length < this.MAX_LOGIN_ATTEMPTS) {
      return {
        locked: false,
        attemptsRemaining,
        retryAfterMs: 0,
        maxAttempts: this.MAX_LOGIN_ATTEMPTS,
        windowMs: this.LOGIN_WINDOW_MS
      };
    }

    const oldestAttempt = attempts[0];
    const retryAfterMs = Math.max(0, oldestAttempt + this.LOGIN_WINDOW_MS - now);
    return {
      locked: retryAfterMs > 0,
      attemptsRemaining,
      retryAfterMs,
      maxAttempts: this.MAX_LOGIN_ATTEMPTS,
      windowMs: this.LOGIN_WINDOW_MS
    };
  }

  /**
   * Starts the password reset flow. Cognito will email a verification code
   * to the user's verified email address.
   */
  forgotPassword(username: string): Observable<void> {
    const trimmedUser = (username || '').trim();
    if (!trimmedUser) return new Observable<void>((obs) => { obs.error(new Error('Username is required')); });

    return new Observable<void>((observer) => {
      const cognitoUser = new CognitoUser({ Username: trimmedUser, Pool: this.userPool });
      cognitoUser.forgotPassword({
        onSuccess: () => {
          observer.next();
          observer.complete();
        },
        onFailure: (err: any) => {
          observer.error(new Error(err?.message || 'Failed to send reset code'));
        },
        inputVerificationCode: () => {
          // Code has been sent. UI should now ask for code + new password.
          observer.next();
          observer.complete();
        }
      });
    });
  }

  confirmForgotPassword(username: string, code: string, newPassword: string): Observable<void> {
    const trimmedUser = (username || '').trim();
    const trimmedCode = (code || '').trim();
    const trimmedNewPass = (newPassword || '').trim();
    if (!trimmedUser || !trimmedCode || !trimmedNewPass) {
      return new Observable<void>((obs) => { obs.error(new Error('Username, code, and new password are required')); });
    }

    return new Observable<void>((observer) => {
      const cognitoUser = new CognitoUser({ Username: trimmedUser, Pool: this.userPool });
      cognitoUser.confirmPassword(trimmedCode, trimmedNewPass, {
        onSuccess: () => {
          observer.next();
          observer.complete();
        },
        onFailure: (err: any) => {
          observer.error(new Error(err?.message || 'Failed to reset password'));
        }
      });
    });
  }

  private loadSession(): void {
    try {
      const raw = localStorage.getItem(this.SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredSession;
      if (!parsed?.idToken || !parsed?.expiresAtMs) return;
      if (Date.now() >= parsed.expiresAtMs && !parsed?.refreshToken) {
        localStorage.removeItem(this.SESSION_KEY);
        return;
      }
      this.session = parsed;
      if (this.isTokenStale(parsed.expiresAtMs) && parsed.refreshToken && parsed.username) {
        // Best-effort background refresh so the user can stay signed in across sessions.
        void this.refreshSession();
      }
    } catch {
      // ignore
    }
  }

  private persistSession(username: string, result: CognitoUserSession): void {
    const idToken = result.getIdToken().getJwtToken();
    const accessToken = result.getAccessToken().getJwtToken();
    const refreshToken = result.getRefreshToken().getToken();

    const expMs = this.getJwtExpMs(idToken);
    const expiresAtMs = expMs ?? (Date.now() + 55 * 60 * 1000); // fallback ~55m

    this.session = {
      username,
      idToken,
      accessToken,
      refreshToken,
      expiresAtMs
    };

    try {
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(this.session));
    } catch {
      // ignore
    }
  }

  private async refreshSession(): Promise<string | null> {
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.session?.username || !this.session?.refreshToken) return null;

    this.refreshPromise = new Promise<string | null>((resolve) => {
      const username = this.session?.username || '';
      const refreshToken = this.session?.refreshToken || '';
      const cognitoUser = new CognitoUser({ Username: username, Pool: this.userPool });
      const token = new CognitoRefreshToken({ RefreshToken: refreshToken });

      cognitoUser.refreshSession(token, (err, session) => {
        if (err || !session) {
          this.logout();
          resolve(null);
          return;
        }
        this.persistSession(username, session);
        resolve(this.session?.idToken || null);
      });
    }).finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private isTokenStale(expiresAtMs: number): boolean {
    return Date.now() + this.TOKEN_REFRESH_SKEW_MS >= expiresAtMs;
  }

  private loadRecentFailedAttempts(now: number): number[] {
    let attempts: number[] = [];
    try {
      const raw = localStorage.getItem(this.LOGIN_ATTEMPTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        attempts = parsed
          .map((t) => Number(t))
          .filter((t) => Number.isFinite(t));
      }
    } catch {
      attempts = [];
    }

    const valid = attempts
      .filter((t) => now - t < this.LOGIN_WINDOW_MS)
      .sort((a, b) => a - b);

    this.persistFailedAttempts(valid);
    return valid;
  }

  private persistFailedAttempts(attempts: number[]): void {
    try {
      if (!attempts.length) {
        localStorage.removeItem(this.LOGIN_ATTEMPTS_KEY);
        return;
      }
      localStorage.setItem(this.LOGIN_ATTEMPTS_KEY, JSON.stringify(attempts));
    } catch {
      // ignore
    }
  }

  private recordFailedLoginAttempt(): void {
    const now = Date.now();
    const attempts = this.loadRecentFailedAttempts(now);
    attempts.push(now);
    this.persistFailedAttempts(attempts);
  }

  private clearFailedLoginAttempts(): void {
    this.persistFailedAttempts([]);
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  private getJwtExpMs(jwt: string): number | null {
    try {
      const [, payload] = jwt.split('.');
      if (!payload) return null;
      const json = JSON.parse(this.base64UrlDecode(payload));
      const expSeconds = typeof json?.exp === 'number' ? json.exp : null;
      return expSeconds ? expSeconds * 1000 : null;
    } catch {
      return null;
    }
  }

  private base64UrlDecode(input: string): string {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => `%${('00' + c.charCodeAt(0).toString(16)).slice(-2)}`)
        .join('')
    );
  }
}
