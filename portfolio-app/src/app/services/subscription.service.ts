/**
 * Subscription Service
 * Calls backend subscription endpoints (SES + DynamoDB).
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type SubscriptionPromptState = 'requested' | 'subscribed';

@Injectable({
  providedIn: 'root'
})
export class SubscriptionService {
  private readonly apiUrl = environment.redisApiUrl || '';
  private readonly headers = new HttpHeaders({
    'Content-Type': 'application/json'
  });
  private readonly promptStateStorageKey = 'portfolio_blog_subscribe_state_v1';
  private readonly promptDismissedSessionKey = 'portfolio_blog_subscribe_dismissed_session_v1';

  constructor(private http: HttpClient) {}

  request(email: string, topics: string[] = ['blog_posts'], source: string = 'blog'): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/subscriptions/request`,
      { email, topics, source },
      { headers: this.headers }
    );
  }

  confirm(token: string): Observable<any> {
    return this.http.get(
      `${this.apiUrl}/subscriptions/confirm?token=${encodeURIComponent(token)}`,
      { headers: this.headers }
    );
  }

  unsubscribe(token: string): Observable<any> {
    return this.http.get(
      `${this.apiUrl}/subscriptions/unsubscribe?token=${encodeURIComponent(token)}`,
      { headers: this.headers }
    );
  }

  updatePreferences(token: string, topics: string[]): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/subscriptions/preferences`,
      { token, topics },
      { headers: this.headers }
    );
  }

  getPromptState(): SubscriptionPromptState | null {
    if (typeof window === 'undefined') return null;
    try {
      const value = (localStorage.getItem(this.promptStateStorageKey) || '').trim().toLowerCase();
      if (value === 'dismissed') {
        // Migrate old behavior where dismiss was persisted forever.
        localStorage.removeItem(this.promptStateStorageKey);
        return null;
      }
      if (value === 'requested' || value === 'subscribed') {
        return value;
      }
      return null;
    } catch {
      return null;
    }
  }

  setPromptState(state: SubscriptionPromptState): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(this.promptStateStorageKey, state);
      sessionStorage.removeItem(this.promptDismissedSessionKey);
    } catch {
      // ignore storage failures
    }
  }

  clearPromptState(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(this.promptStateStorageKey);
      sessionStorage.removeItem(this.promptDismissedSessionKey);
    } catch {
      // ignore storage failures
    }
  }

  isPromptDismissedForSession(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return sessionStorage.getItem(this.promptDismissedSessionKey) === '1';
    } catch {
      return false;
    }
  }

  setPromptDismissedForSession(dismissed: boolean = true): void {
    if (typeof window === 'undefined') return;
    try {
      if (dismissed) {
        sessionStorage.setItem(this.promptDismissedSessionKey, '1');
      } else {
        sessionStorage.removeItem(this.promptDismissedSessionKey);
      }
    } catch {
      // ignore storage failures
    }
  }
}
