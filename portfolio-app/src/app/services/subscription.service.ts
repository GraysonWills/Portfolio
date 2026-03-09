/**
 * Subscription Service
 * Calls backend subscription endpoints (SES + DynamoDB).
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type SubscriptionPromptState = 'requested' | 'subscribed';

type PromptInteractionState = {
  dismissCount: number;
  dismissedUntil: string | null;
  permanentlyDismissed: boolean;
  blogVisitCount: number;
  lastPromptedAt: string | null;
  lastTrackedBlogPath: string | null;
};

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
  private readonly promptInteractionStorageKey = 'portfolio_blog_subscribe_prompt_interaction_v1';
  private readonly promptLastTrackedBlogPathSessionKey = 'portfolio_blog_subscribe_last_blog_path_session_v1';
  private readonly promptCooldownDays = 60;

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
      this.writePromptInteractionState({
        ...this.readPromptInteractionState(),
        dismissedUntil: null,
        permanentlyDismissed: false
      });
      sessionStorage.removeItem(this.promptDismissedSessionKey);
    } catch {
      // ignore storage failures
    }
  }

  clearPromptState(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(this.promptStateStorageKey);
      localStorage.removeItem(this.promptInteractionStorageKey);
      sessionStorage.removeItem(this.promptDismissedSessionKey);
      sessionStorage.removeItem(this.promptLastTrackedBlogPathSessionKey);
    } catch {
      // ignore storage failures
    }
  }

  isPromptDismissedForSession(): boolean {
    return this.isPromptSuppressed();
  }

  setPromptDismissedForSession(dismissed: boolean = true): void {
    if (!dismissed) return;
    this.dismissPrompt();
  }

  trackPromptRoute(pathOnly: string): void {
    const normalizedPath = this.normalizePath(pathOnly);
    if (!this.isBlogRoute(normalizedPath)) return;

    const lastTrackedPath = this.readLastTrackedBlogPathForSession();
    if (lastTrackedPath === normalizedPath) {
      return;
    }

    const current = this.readPromptInteractionState();
    this.writePromptInteractionState({
      ...current,
      blogVisitCount: current.blogVisitCount + 1
    });
    this.writeLastTrackedBlogPathForSession(normalizedPath);
  }

  shouldShowPromptForPath(pathOnly: string): boolean {
    const normalizedPath = this.normalizePath(pathOnly);
    if (!this.isBlogRoute(normalizedPath)) return false;
    if (this.getPromptState()) return false;

    const state = this.readPromptInteractionState();
    if (state.permanentlyDismissed) return false;
    if (this.isDismissedUntilActive(state.dismissedUntil)) return false;

    return state.blogVisitCount >= 2;
  }

  markPromptShown(): void {
    const current = this.readPromptInteractionState();
    this.writePromptInteractionState({
      ...current,
      lastPromptedAt: new Date().toISOString()
    });
  }

  dismissPrompt(): PromptInteractionState {
    const current = this.readPromptInteractionState();
    const dismissCount = current.dismissCount + 1;
    const permanentlyDismissed = dismissCount >= 2;
    const dismissedUntil = permanentlyDismissed
      ? null
      : new Date(Date.now() + (this.promptCooldownDays * 24 * 60 * 60 * 1000)).toISOString();

    const next = {
      ...current,
      dismissCount,
      dismissedUntil,
      permanentlyDismissed,
      lastPromptedAt: new Date().toISOString()
    };

    this.writePromptInteractionState(next);
    return next;
  }

  getPromptInteractionState(): PromptInteractionState {
    return this.readPromptInteractionState();
  }

  private isPromptSuppressed(): boolean {
    if (this.getPromptState()) return true;
    const state = this.readPromptInteractionState();
    return state.permanentlyDismissed || this.isDismissedUntilActive(state.dismissedUntil);
  }

  private readPromptInteractionState(): PromptInteractionState {
    if (typeof window === 'undefined') {
      return this.defaultPromptInteractionState();
    }

    try {
      const raw = localStorage.getItem(this.promptInteractionStorageKey);
      if (!raw) {
        return this.defaultPromptInteractionState();
      }

      const parsed = JSON.parse(raw) as Partial<PromptInteractionState>;
      return {
        dismissCount: Math.max(0, Number(parsed.dismissCount) || 0),
        dismissedUntil: typeof parsed.dismissedUntil === 'string' && parsed.dismissedUntil.trim()
          ? parsed.dismissedUntil
          : null,
        permanentlyDismissed: parsed.permanentlyDismissed === true,
        blogVisitCount: Math.max(0, Number(parsed.blogVisitCount) || 0),
        lastPromptedAt: typeof parsed.lastPromptedAt === 'string' && parsed.lastPromptedAt.trim()
          ? parsed.lastPromptedAt
          : null,
        lastTrackedBlogPath: typeof parsed.lastTrackedBlogPath === 'string' && parsed.lastTrackedBlogPath.trim()
          ? parsed.lastTrackedBlogPath
          : null
      };
    } catch {
      return this.defaultPromptInteractionState();
    }
  }

  private writePromptInteractionState(state: PromptInteractionState): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(this.promptInteractionStorageKey, JSON.stringify(state));
      sessionStorage.removeItem(this.promptDismissedSessionKey);
    } catch {
      // ignore storage failures
    }
  }

  private isDismissedUntilActive(value: string | null): boolean {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp > Date.now();
  }

  private readLastTrackedBlogPathForSession(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const value = sessionStorage.getItem(this.promptLastTrackedBlogPathSessionKey);
      return value ? value.trim() : null;
    } catch {
      return null;
    }
  }

  private writeLastTrackedBlogPathForSession(pathOnly: string): void {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(this.promptLastTrackedBlogPathSessionKey, pathOnly);
    } catch {
      // ignore storage failures
    }
  }

  private isBlogRoute(pathOnly: string): boolean {
    return pathOnly === '/blog' || pathOnly.startsWith('/blog/');
  }

  private normalizePath(pathOnly: string): string {
    const normalized = String(pathOnly || '/').trim();
    return normalized || '/';
  }

  private defaultPromptInteractionState(): PromptInteractionState {
    return {
      dismissCount: 0,
      dismissedUntil: null,
      permanentlyDismissed: false,
      blogVisitCount: 0,
      lastPromptedAt: null,
      lastTrackedBlogPath: null
    };
  }
}
