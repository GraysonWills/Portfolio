import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

type StoredSession = {
  username: string;
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
};

type CognitoAuthTokens = {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
};

type CognitoAuthResponse = {
  AuthenticationResult?: CognitoAuthTokens;
};

type CognitoTarget =
  | 'InitiateAuth'
  | 'SignUp'
  | 'ConfirmSignUp'
  | 'ForgotPassword'
  | 'ConfirmForgotPassword';

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
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.loadSession();
    this.startRefreshTimer();
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

      this.callCognito('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: environment.cognito.clientId,
        AuthParameters: {
          USERNAME: trimmedUser,
          PASSWORD: trimmedPass
        }
      })
        .then((response) => {
          if (!response.AuthenticationResult?.IdToken || !response.AuthenticationResult?.AccessToken) {
            throw new Error('Cognito did not return a signed-in session.');
          }
          this.clearFailedLoginAttempts();
          this.persistAuthTokens(trimmedUser, response.AuthenticationResult);
          observer.next(true);
          observer.complete();
        })
        .catch((err) => {
          this.recordFailedLoginAttempt();
          const nextState = this.getLoginThrottleState();
          if (nextState.locked) {
            observer.error(new Error(`Too many login attempts. Try again in ${this.formatDuration(nextState.retryAfterMs)}.`));
            return;
          }
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Invalid username or password'));
        });
    });
  }

  isGoogleSsoConfigured(): boolean {
    return !!String(environment.cognito?.hostedUiDomain || '').trim();
  }

  startGoogleSsoLogin(): void {
    const domain = String(environment.cognito?.hostedUiDomain || '').trim();
    const redirect = String(environment.cognito?.redirectSignIn || '').trim() || `${window.location.origin}/login`;
    const clientId = String(environment.cognito?.clientId || '').trim();
    if (!domain || !redirect || !clientId) {
      throw new Error('Google SSO is not configured. Missing Cognito Hosted UI settings.');
    }

    const query = new URLSearchParams({
      identity_provider: 'Google',
      redirect_uri: redirect,
      response_type: 'token',
      client_id: clientId,
      scope: 'openid email profile'
    });

    window.location.assign(`https://${domain}/oauth2/authorize?${query.toString()}`);
  }

  completeHostedUiLoginFromHash(hash: string): boolean {
    const raw = String(hash || '').trim();
    if (!raw.startsWith('#')) return false;

    const params = new URLSearchParams(raw.slice(1));
    const idToken = String(params.get('id_token') || '').trim();
    const accessToken = String(params.get('access_token') || '').trim();
    if (!idToken || !accessToken) return false;

    const username = this.getJwtStringClaim(idToken, 'cognito:username')
      || this.getJwtStringClaim(idToken, 'email')
      || this.getJwtStringClaim(idToken, 'sub')
      || 'google-user';

    this.persistHostedSession({ username, idToken, accessToken });
    return true;
  }

  logout(): void {
    this.session = null;
    try {
      localStorage.removeItem(this.SESSION_KEY);
    } catch {
      // ignore
    }
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      const expiresAt = this.session?.expiresAtMs;
      if (!expiresAt) return;
      if (this.isTokenStale(expiresAt) && this.session?.refreshToken && this.session?.username) {
        void this.refreshSession();
      }
    }, 30 * 1000);
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
      this.callCognito('ForgotPassword', {
        ClientId: environment.cognito.clientId,
        Username: trimmedUser
      })
        .then(() => {
          observer.next();
          observer.complete();
        })
        .catch((err) => {
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Failed to send reset code'));
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
      this.callCognito('ConfirmForgotPassword', {
        ClientId: environment.cognito.clientId,
        Username: trimmedUser,
        ConfirmationCode: trimmedCode,
        Password: trimmedNewPass
      })
        .then(() => {
          observer.next();
          observer.complete();
        })
        .catch((err) => {
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Failed to reset password'));
        });
    });
  }

  register(username: string, email: string, password: string): Observable<void> {
    const u = String(username || '').trim();
    const e = String(email || '').trim();
    const p = String(password || '').trim();
    if (!u || !e || !p) {
      return new Observable<void>((obs) => { obs.error(new Error('Username, email, and password are required')); });
    }

    return new Observable<void>((observer) => {
      this.callCognito('SignUp', {
        ClientId: environment.cognito.clientId,
        Username: u,
        Password: p,
        UserAttributes: [
          { Name: 'email', Value: e }
        ]
      })
        .then(() => {
          observer.next();
          observer.complete();
        })
        .catch((err) => {
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Registration failed'));
        });
    });
  }

  confirmRegistration(username: string, code: string): Observable<void> {
    const u = String(username || '').trim();
    const c = String(code || '').trim();
    if (!u || !c) {
      return new Observable<void>((obs) => { obs.error(new Error('Username and verification code are required')); });
    }

    return new Observable<void>((observer) => {
      this.callCognito('ConfirmSignUp', {
        ClientId: environment.cognito.clientId,
        Username: u,
        ConfirmationCode: c,
        ForceAliasCreation: true
      })
        .then(() => {
          observer.next();
          observer.complete();
        })
        .catch((err) => {
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Email verification failed'));
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

  private persistHostedSession(input: { username: string; idToken: string; accessToken: string; refreshToken?: string }): void {
    const expMs = this.getJwtExpMs(input.idToken);
    const expiresAtMs = expMs ?? (Date.now() + 55 * 60 * 1000); // fallback ~55m

    this.session = {
      username: String(input.username || '').trim() || 'user',
      idToken: input.idToken,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresAtMs
    };

    try {
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(this.session));
    } catch {
      // ignore
    }
  }

  private persistAuthTokens(username: string, tokens: CognitoAuthTokens): void {
    const idToken = String(tokens.IdToken || '');
    const accessToken = String(tokens.AccessToken || '');
    if (!idToken || !accessToken) {
      throw new Error('Cognito did not return the expected tokens.');
    }

    const refreshToken = String(tokens.RefreshToken || this.session?.refreshToken || '');
    this.persistHostedSession({
      username,
      idToken,
      accessToken,
      ...(refreshToken ? { refreshToken } : {})
    });
  }

  private async refreshSession(): Promise<string | null> {
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.session?.username || !this.session?.refreshToken) return null;

    this.refreshPromise = (async () => {
      const username = this.session?.username || '';
      const refreshToken = this.session?.refreshToken || '';
      try {
        const response = await this.callCognito('InitiateAuth', {
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: environment.cognito.clientId,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken
          }
        });
        const tokens = response.AuthenticationResult;
        if (!tokens?.IdToken || !tokens?.AccessToken) {
          throw new Error('Cognito did not return a refreshed session.');
        }
        this.persistAuthTokens(username, {
          ...tokens,
          RefreshToken: tokens.RefreshToken || refreshToken
        });
        return this.session?.idToken || null;
      } catch {
        this.logout();
        return null;
      }
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async callCognito(target: CognitoTarget, body: Record<string, unknown>): Promise<CognitoAuthResponse> {
    const region = String(environment.cognito?.region || '').trim();
    if (!region) throw new Error('Cognito region is not configured.');
    if (!String(environment.cognito?.clientId || '').trim()) throw new Error('Cognito client is not configured.');

    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
    if (!response.ok) {
      const message = typeof payload['message'] === 'string'
        ? payload['message']
        : (typeof payload['__type'] === 'string' ? payload['__type'] : 'Cognito request failed');
      throw new Error(message);
    }
    return payload as CognitoAuthResponse;
  }

  private getCognitoErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err || '').trim();
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

  private getJwtStringClaim(jwt: string, claim: string): string | null {
    try {
      const [, payload] = jwt.split('.');
      if (!payload) return null;
      const json = JSON.parse(this.base64UrlDecode(payload));
      const value = json?.[claim];
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed || null;
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
