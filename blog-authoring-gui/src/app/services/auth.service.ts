import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { delay, tap } from 'rxjs/operators';

export interface UserCredentials {
  username: string;
  password: string; // In production, store hashed password
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly STORAGE_KEY = 'blog_authoring_credentials';
  private readonly SESSION_KEY = 'blog_authoring_session';
  private currentUser: string | null = null;

  constructor() {
    // Check for existing session
    const session = localStorage.getItem(this.SESSION_KEY);
    if (session) {
      try {
        const sessionData = JSON.parse(session);
        if (sessionData.expires > Date.now()) {
          this.currentUser = sessionData.username;
        } else {
          localStorage.removeItem(this.SESSION_KEY);
        }
      } catch (e) {
        localStorage.removeItem(this.SESSION_KEY);
      }
    }
  }

  /**
   * Authenticate user
   */
  login(username: string, password: string): Observable<boolean> {
    // Load stored credentials
    const stored = this.getStoredCredentials();
    
    if (!stored) {
      // First time login - store credentials
      this.storeCredentials(username, password);
      this.createSession(username);
      return of(true).pipe(delay(500));
    }

    // Verify credentials
    if (stored.username === username && stored.password === password) {
      this.createSession(username);
      return of(true).pipe(delay(500));
    }

    return throwError(() => new Error('Invalid username or password')).pipe(delay(500));
  }

  /**
   * Logout user
   */
  logout(): void {
    localStorage.removeItem(this.SESSION_KEY);
    this.currentUser = null;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.currentUser !== null;
  }

  /**
   * Get current user
   */
  getCurrentUser(): string | null {
    return this.currentUser;
  }

  /**
   * Store credentials locally (encrypted)
   */
  private storeCredentials(username: string, password: string): void {
    // Simple encryption (in production, use proper encryption)
    const credentials: UserCredentials = { username, password };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(credentials));
  }

  /**
   * Get stored credentials
   */
  private getStoredCredentials(): UserCredentials | null {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as UserCredentials;
      }
    } catch (e) {
      console.error('Error reading stored credentials:', e);
    }
    return null;
  }

  /**
   * Create session
   */
  private createSession(username: string): void {
    const sessionData = {
      username,
      expires: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
    this.currentUser = username;
  }

  /**
   * Update stored password
   */
  updatePassword(newPassword: string): void {
    const stored = this.getStoredCredentials();
    if (stored) {
      stored.password = newPassword;
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(stored));
    }
  }
}
