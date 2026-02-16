import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AuthenticationDetails,
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

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly SESSION_KEY = 'blog_authoring_cognito_session_v1';
  private session: StoredSession | null = null;

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
      const cognitoUser = new CognitoUser({ Username: trimmedUser, Pool: this.userPool });
      const authDetails = new AuthenticationDetails({ Username: trimmedUser, Password: trimmedPass });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (result: CognitoUserSession) => {
          this.persistSession(trimmedUser, result);
          observer.next(true);
          observer.complete();
        },
        onFailure: (err: any) => {
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
    return !!this.getIdToken();
  }

  getCurrentUser(): string | null {
    return this.session?.username || null;
  }

  getIdToken(): string | null {
    if (!this.session) return null;
    if (Date.now() >= this.session.expiresAtMs) {
      this.logout();
      return null;
    }
    return this.session.idToken;
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
      if (Date.now() >= parsed.expiresAtMs) {
        localStorage.removeItem(this.SESSION_KEY);
        return;
      }
      this.session = parsed;
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

