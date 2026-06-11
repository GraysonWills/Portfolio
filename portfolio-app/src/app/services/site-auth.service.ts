import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

type StoredSiteSession = {
  username: string;
  email?: string;
  displayName?: string;
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
};

export type SiteUser = {
  username: string;
  email?: string;
  displayName: string;
};

type CognitoAuthTokens = {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
};

type CognitoAuthResponse = {
  AuthenticationResult?: CognitoAuthTokens;
  ChallengeName?: string;
  Session?: string;
};

type CognitoAttribute = {
  Name: string;
  Value: string;
};

type CognitoTarget =
  | 'InitiateAuth'
  | 'RespondToAuthChallenge'
  | 'SignUp'
  | 'ConfirmSignUp'
  | 'ResendConfirmationCode'
  | 'UpdateUserAttributes'
  | 'DeleteUser';

type PendingEmailOtp = {
  email: string;
  session: string;
  expiresAtMs: number;
};

@Injectable({
  providedIn: 'root'
})
export class SiteAuthService {
  private readonly SESSION_KEY = 'portfolio_comment_session_v1';
  private readonly TOKEN_REFRESH_SKEW_MS = 60 * 1000;
  private readonly EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
  private session: StoredSiteSession | null = null;
  private pendingEmailOtp: PendingEmailOtp | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private readonly currentUserSubject = new BehaviorSubject<SiteUser | null>(null);
  readonly currentUser$ = this.currentUserSubject.asObservable();

  constructor() {
    this.loadSession();
  }

  isConfigured(): boolean {
    const cfg = environment.commentsAuth || {};
    return !!String(cfg.userPoolId || '').trim() && !!String(cfg.clientId || '').trim();
  }

  login(usernameOrEmail: string, password: string): Observable<boolean> {
    const username = String(usernameOrEmail || '').trim();
    const pass = String(password || '').trim();
    if (!username || !pass) {
      return new Observable<boolean>((observer) => {
        observer.error(new Error('Email and password are required'));
      });
    }

    return new Observable<boolean>((observer) => {
      if (!this.isConfigured()) {
        observer.error(new Error('Comment accounts are not configured yet.'));
        return;
      }

      this.callCognito('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: environment.commentsAuth.clientId,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: pass
        }
      })
        .then((response) => {
          if (!response.AuthenticationResult?.IdToken || !response.AuthenticationResult?.AccessToken) {
            throw new Error('Cognito did not return a signed-in session.');
          }
          this.persistAuthTokens(username, response.AuthenticationResult);
          observer.next(true);
          observer.complete();
        })
        .catch((err) => {
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Sign in failed'));
        });
    });
  }

  startEmailCodeLogin(email: string): Observable<void> {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) {
      return new Observable<void>((observer) => {
        observer.error(new Error('Email is required'));
      });
    }

    return new Observable<void>((observer) => {
      if (!this.isConfigured()) {
        observer.error(new Error('Comment accounts are not configured yet.'));
        return;
      }

      this.callCognito('InitiateAuth', {
        AuthFlow: 'USER_AUTH',
        ClientId: environment.commentsAuth.clientId,
        AuthParameters: {
          USERNAME: cleanEmail,
          PREFERRED_CHALLENGE: 'EMAIL_OTP'
        }
      })
        .then((response) => {
          if (response.AuthenticationResult?.IdToken && response.AuthenticationResult?.AccessToken) {
            this.persistAuthTokens(cleanEmail, response.AuthenticationResult);
            this.pendingEmailOtp = null;
            observer.next();
            observer.complete();
            return;
          }

          if (response.ChallengeName !== 'EMAIL_OTP' || !response.Session) {
            throw new Error('Email sign-in code was not available for this account.');
          }

          this.pendingEmailOtp = {
            email: cleanEmail,
            session: response.Session,
            expiresAtMs: Date.now() + this.EMAIL_CODE_TTL_MS
          };
          observer.next();
          observer.complete();
        })
        .catch((err) => {
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Could not send sign-in code.'));
        });
    });
  }

  confirmEmailCodeLogin(email: string, code: string): Observable<boolean> {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim();
    if (!cleanEmail || !cleanCode) {
      return new Observable<boolean>((observer) => {
        observer.error(new Error('Email and verification code are required'));
      });
    }

    return new Observable<boolean>((observer) => {
      if (!this.isConfigured()) {
        observer.error(new Error('Comment accounts are not configured yet.'));
        return;
      }

      const pending = this.pendingEmailOtp;
      if (!pending || pending.email !== cleanEmail) {
        observer.error(new Error('Request a new sign-in code first.'));
        return;
      }

      if (Date.now() >= pending.expiresAtMs) {
        this.pendingEmailOtp = null;
        observer.error(new Error('That code expired. Send a new code and try again.'));
        return;
      }

      this.callCognito('RespondToAuthChallenge', {
        ClientId: environment.commentsAuth.clientId,
        ChallengeName: 'EMAIL_OTP',
        Session: pending.session,
        ChallengeResponses: {
          USERNAME: cleanEmail,
          EMAIL_OTP_CODE: cleanCode
        }
      })
        .then((response) => {
          if (!response.AuthenticationResult?.IdToken || !response.AuthenticationResult?.AccessToken) {
            throw new Error('Cognito did not return a signed-in session.');
          }
          this.persistAuthTokens(cleanEmail, response.AuthenticationResult);
          this.pendingEmailOtp = null;
          observer.next(true);
          observer.complete();
        })
        .catch((err) => {
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Could not verify sign-in code.'));
        });
    });
  }

  register(displayName: string, email: string, password: string): Observable<void> {
    const cleanName = String(displayName || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '').trim();
    if (!cleanName || !cleanEmail || !cleanPassword) {
      return new Observable<void>((observer) => {
        observer.error(new Error('Display name, email, and password are required'));
      });
    }

    return new Observable<void>((observer) => {
      if (!this.isConfigured()) {
        observer.error(new Error('Comment accounts are not configured yet.'));
        return;
      }

      const attrs: CognitoAttribute[] = [
        { Name: 'email', Value: cleanEmail },
        { Name: 'preferred_username', Value: cleanName }
      ];

      this.callCognito('SignUp', {
        ClientId: environment.commentsAuth.clientId,
        Username: cleanEmail,
        Password: cleanPassword,
        UserAttributes: attrs
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

  confirmRegistration(email: string, code: string): Observable<void> {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim();
    if (!cleanEmail || !cleanCode) {
      return new Observable<void>((observer) => {
        observer.error(new Error('Email and verification code are required'));
      });
    }

    return new Observable<void>((observer) => {
      if (!this.isConfigured()) {
        observer.error(new Error('Comment accounts are not configured yet.'));
        return;
      }

      this.callCognito('ConfirmSignUp', {
        ClientId: environment.commentsAuth.clientId,
        Username: cleanEmail,
        ConfirmationCode: cleanCode,
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

  resendRegistrationCode(email: string): Observable<void> {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) {
      return new Observable<void>((observer) => {
        observer.error(new Error('Email is required'));
      });
    }

    return new Observable<void>((observer) => {
      if (!this.isConfigured()) {
        observer.error(new Error('Comment accounts are not configured yet.'));
        return;
      }

      this.callCognito('ResendConfirmationCode', {
        ClientId: environment.commentsAuth.clientId,
        Username: cleanEmail
      })
        .then(() => {
          observer.next();
          observer.complete();
        })
        .catch((err) => {
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Could not resend verification code'));
        });
    });
  }

  logout(): void {
    this.session = null;
    this.currentUserSubject.next(null);
    try {
      localStorage.removeItem(this.SESSION_KEY);
    } catch {
      // ignore
    }
  }

  isAuthenticated(): boolean {
    return !!this.getIdToken();
  }

  getCurrentUser(): SiteUser | null {
    return this.currentUserSubject.getValue();
  }

  getIdToken(): string | null {
    if (!this.session?.idToken) return null;
    if (this.isTokenStale(this.session.expiresAtMs)) return null;
    return this.session.idToken;
  }

  getAccessToken(): string | null {
    if (!this.session?.accessToken) return null;
    if (this.isTokenStale(this.session.expiresAtMs)) return null;
    return this.session.accessToken;
  }

  async getValidIdToken(): Promise<string | null> {
    const current = this.getIdToken();
    if (current) return current;
    if (!this.session?.refreshToken || !this.session?.username) return null;
    return this.refreshSession();
  }

  async getValidAccessToken(): Promise<string | null> {
    const current = this.getAccessToken();
    if (current) return current;
    if (!this.session?.refreshToken || !this.session?.username) return null;
    await this.refreshSession();
    return this.getAccessToken();
  }

  updateDisplayName(displayName: string): Observable<SiteUser> {
    const cleanName = String(displayName || '').trim().replace(/\s+/g, ' ');
    if (cleanName.length < 2) {
      return new Observable<SiteUser>((observer) => {
        observer.error(new Error('Display name must be at least 2 characters.'));
      });
    }

    return new Observable<SiteUser>((observer) => {
      this.getValidAccessToken()
        .then((accessToken) => {
          if (!accessToken) throw new Error('Sign in to update your profile.');
          return this.callCognito('UpdateUserAttributes', {
            AccessToken: accessToken,
            UserAttributes: [
              { Name: 'preferred_username', Value: cleanName },
              { Name: 'name', Value: cleanName }
            ]
          });
        })
        .then(() => {
          if (!this.session) throw new Error('Session was not available.');
          this.session = {
            ...this.session,
            displayName: cleanName
          };
          this.persistCurrentSession();
          this.publishCurrentUser();
          observer.next(this.getCurrentUser() as SiteUser);
          observer.complete();
        })
        .catch((err) => {
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Could not update profile.'));
        });
    });
  }

  deleteAccount(): Observable<void> {
    return new Observable<void>((observer) => {
      this.getValidAccessToken()
        .then((accessToken) => {
          if (!accessToken) throw new Error('Sign in to delete your account.');
          return this.callCognito('DeleteUser', {
            AccessToken: accessToken
          });
        })
        .then(() => {
          this.logout();
          observer.next();
          observer.complete();
        })
        .catch((err) => {
          observer.error(new Error(this.getCognitoErrorMessage(err) || 'Could not delete account.'));
        });
    });
  }

  private loadSession(): void {
    try {
      const raw = localStorage.getItem(this.SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredSiteSession;
      if (!parsed?.idToken || !parsed?.expiresAtMs) return;
      if (Date.now() >= parsed.expiresAtMs && !parsed.refreshToken) {
        localStorage.removeItem(this.SESSION_KEY);
        return;
      }
      this.session = parsed;
      this.publishCurrentUser();
      if (this.isTokenStale(parsed.expiresAtMs) && parsed.refreshToken && parsed.username) {
        void this.refreshSession();
      }
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

    const refreshToken = String(tokens.RefreshToken || '');
    const expMs = this.getJwtExpMs(idToken);
    const email = this.getJwtStringClaim(idToken, 'email') || undefined;
    const displayName = this.getJwtStringClaim(idToken, 'preferred_username')
      || this.getJwtStringClaim(idToken, 'name')
      || this.nameFromEmail(email)
      || username;

    this.session = {
      username,
      email,
      displayName,
      idToken,
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      expiresAtMs: expMs ?? (Date.now() + 55 * 60 * 1000)
    };

    try {
      this.persistCurrentSession();
    } catch {
      // ignore
    }
    this.publishCurrentUser();
  }

  private async refreshSession(): Promise<string | null> {
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.session?.username || !this.session?.refreshToken) return null;

    if (!this.isConfigured()) return null;

    this.refreshPromise = (async () => {
      const username = this.session?.username || '';
      const refreshToken = this.session?.refreshToken || '';
      try {
        const response = await this.callCognito('InitiateAuth', {
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: environment.commentsAuth.clientId,
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

  private publishCurrentUser(): void {
    if (!this.session) {
      this.currentUserSubject.next(null);
      return;
    }
    this.currentUserSubject.next({
      username: this.session.username,
      email: this.session.email,
      displayName: this.session.displayName || this.session.username
    });
  }

  private persistCurrentSession(): void {
    if (!this.session) return;
    try {
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(this.session));
    } catch {
      // ignore
    }
  }

  private isTokenStale(expiresAtMs: number): boolean {
    return Date.now() + this.TOKEN_REFRESH_SKEW_MS >= expiresAtMs;
  }

  private nameFromEmail(email?: string): string {
    const value = String(email || '').trim();
    if (!value.includes('@')) return '';
    return value.split('@')[0].replace(/[._-]+/g, ' ');
  }

  private async callCognito(target: CognitoTarget, body: Record<string, unknown>): Promise<CognitoAuthResponse> {
    const region = String(environment.commentsAuth?.region || '').trim();
    if (!region) throw new Error('Cognito region is not configured.');

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
      return value.trim() || null;
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
