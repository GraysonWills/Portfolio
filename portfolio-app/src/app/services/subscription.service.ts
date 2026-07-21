/**
 * Subscription Service
 * Calls backend subscription endpoints (SES + DynamoDB).
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, from, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { SiteAuthService } from './site-auth.service';
import { AnalyticsService } from './analytics.service';
import { GrowthContext, growthMetadata } from '../models/growth.model';

export type SubscriptionPromptState = 'requested' | 'subscribed';
export type AccountSubscriptionStatus = 'NONE' | 'PENDING' | 'SUBSCRIBED' | 'UNSUBSCRIBED';

export type SharedSubscriptionStatus =
  | 'idle'
  | 'invalid'
  | 'submitting'
  | 'pending'
  | 'already_pending'
  | 'confirmed'
  | 'already_subscribed'
  | 'error';

export interface SharedSubscriptionState {
  status: SharedSubscriptionStatus;
  email: string;
  message: string;
  updatedAt: string | null;
}

export interface SubscriptionAttribution {
  placement?: string | null;
  postId?: string | null;
  postSlug?: string | null;
  conversionId?: string | null;
}

export type AccountSubscription = {
  email: string;
  status: AccountSubscriptionStatus;
  topics: string[];
  source?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  confirmedAt?: string | null;
  unsubscribedAt?: string | null;
};

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
  private readonly sharedStateSubject: BehaviorSubject<SharedSubscriptionState>;
  readonly sharedState$: Observable<SharedSubscriptionState>;

  constructor(
    private http: HttpClient,
    private siteAuth: SiteAuthService,
    private analytics: AnalyticsService
  ) {
    const promptState = this.getPromptState();
    this.sharedStateSubject = new BehaviorSubject<SharedSubscriptionState>({
      status: promptState === 'subscribed'
        ? 'confirmed'
        : promptState === 'requested'
          ? 'pending'
          : 'idle',
      email: '',
      message: promptState === 'subscribed'
        ? 'Your subscription is confirmed.'
        : promptState === 'requested'
          ? 'Use the confirmation link we sent to finish subscribing.'
          : '',
      updatedAt: promptState ? new Date().toISOString() : null
    });
    this.sharedState$ = this.sharedStateSubject.asObservable();
  }

  request(
    email: string,
    topics: string[] = ['blog_posts'],
    source: string = 'blog',
    attribution: SubscriptionAttribution = {}
  ): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/subscriptions/request`,
      {
        email,
        topics,
        source,
        placement: attribution.placement || source,
        postId: attribution.postId || null,
        postSlug: attribution.postSlug || null,
        conversionId: attribution.conversionId || null
      },
      { headers: this.headers }
    );
  }

  confirm(token: string): Observable<any> {
    return this.http.get(
      `${this.apiUrl}/subscriptions/confirm?token=${encodeURIComponent(token)}`,
      { headers: this.headers }
    ).pipe(
      tap((result: any) => {
        const placement = String(result?.placement || result?.source || 'blog_index').trim();
        this.markSharedConfirmed('Your subscription is confirmed. Welcome aboard.');
        this.analytics.track('subscription_confirmed', {
          metadata: {
            action: 'subscribe',
            placement,
            postId: String(result?.postId || '').trim() || null,
            postSlug: String(result?.postSlug || '').trim() || null,
            conversionId: String(result?.conversionId || '').trim() || null,
            outcome: 'confirmed'
          }
        });
      })
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

  getMySubscription(): Observable<AccountSubscription> {
    return from(this.authHeaders()).pipe(
      switchMap((headers) => this.http.get<{ subscription: AccountSubscription }>(
        `${this.apiUrl}/subscriptions/me`,
        { headers }
      )),
      map((response) => this.normalizeAccountSubscription(response?.subscription)),
      catchError(this.handleAccountError)
    );
  }

  updateMyPreferences(topics: string[]): Observable<AccountSubscription> {
    return from(this.authHeaders()).pipe(
      switchMap((headers) => this.http.post<{ subscription: AccountSubscription }>(
        `${this.apiUrl}/subscriptions/me/preferences`,
        { topics },
        { headers }
      )),
      map((response) => this.normalizeAccountSubscription(response?.subscription)),
      catchError(this.handleAccountError)
    );
  }

  unsubscribeMe(): Observable<AccountSubscription> {
    return from(this.authHeaders()).pipe(
      switchMap((headers) => this.http.post<{ subscription: AccountSubscription }>(
        `${this.apiUrl}/subscriptions/me/unsubscribe`,
        {},
        { headers }
      )),
      map((response) => this.normalizeAccountSubscription(response?.subscription)),
      catchError(this.handleAccountError)
    );
  }

  getSharedState(): SharedSubscriptionState {
    return this.sharedStateSubject.value;
  }

  updateSharedEmail(email: string): void {
    const current = this.sharedStateSubject.value;
    const nextStatus: SharedSubscriptionStatus = ['invalid', 'error'].includes(current.status)
      ? 'idle'
      : current.status;
    this.sharedStateSubject.next({
      ...current,
      status: nextStatus,
      email: String(email || ''),
      message: nextStatus === 'idle' ? '' : current.message
    });
  }

  submitShared(email: string, context: GrowthContext): void {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    const conversionId = this.generateConversionId();
    const normalizedContext: GrowthContext = {
      placement: context.placement,
      postId: String(context.postId || '').trim() || null,
      postSlug: String(context.postSlug || '').trim() || null,
      conversionId
    };

    this.analytics.track('subscription_form_attempt', {
      metadata: growthMetadata('subscribe', normalizedContext, { valid: isValid })
    });

    if (!isValid) {
      this.sharedStateSubject.next({
        status: 'invalid',
        email: normalizedEmail,
        message: 'Enter a valid email address.',
        updatedAt: new Date().toISOString()
      });
      return;
    }

    if (this.sharedStateSubject.value.status === 'submitting') return;
    this.sharedStateSubject.next({
      status: 'submitting',
      email: normalizedEmail,
      message: 'Sending your confirmation…',
      updatedAt: new Date().toISOString()
    });

    this.request(normalizedEmail, ['blog_posts'], context.placement, normalizedContext).subscribe({
      next: (result) => {
        const status = String(result?.status || '').toUpperCase();
        if (status === 'ALREADY_SUBSCRIBED' || result?.alreadySubscribed) {
          this.setPromptState('subscribed');
          this.sharedStateSubject.next({
            status: 'already_subscribed',
            email: '',
            message: 'This address is already confirmed for blog updates.',
            updatedAt: new Date().toISOString()
          });
          this.analytics.track('subscription_confirmed', {
            metadata: growthMetadata('subscribe', normalizedContext, { outcome: 'already_subscribed' })
          });
          return;
        }

        if (status === 'ALREADY_PENDING' || result?.alreadyPending) {
          this.setPromptState('requested');
          this.sharedStateSubject.next({
            status: 'already_pending',
            email: '',
            message: 'Use the confirmation link already sent to this address.',
            updatedAt: new Date().toISOString()
          });
          this.analytics.track('subscription_pending', {
            metadata: growthMetadata('subscribe', normalizedContext, { outcome: 'already_pending' })
          });
          return;
        }

        this.setPromptState('requested');
        this.sharedStateSubject.next({
          status: 'pending',
          email: '',
          message: 'Use the link we sent to finish subscribing.',
          updatedAt: new Date().toISOString()
        });
        this.analytics.track('subscription_pending', {
          metadata: growthMetadata('subscribe', normalizedContext, { outcome: 'requested' })
        });
      },
      error: (error) => {
        const message = String(error?.error?.error || error?.message || '').trim();
        this.sharedStateSubject.next({
          status: 'error',
          email: normalizedEmail,
          message: message || 'We couldn’t send that. Try again.',
          updatedAt: new Date().toISOString()
        });
      }
    });
  }

  markSharedConfirmed(message = 'Your subscription is confirmed.'): void {
    this.setPromptState('subscribed');
    this.sharedStateSubject.next({
      status: 'confirmed',
      email: '',
      message,
      updatedAt: new Date().toISOString()
    });
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
    if (!this.isBlogRoute(normalizedPath)) {
      this.clearLastTrackedBlogPathForSession();
      return;
    }

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

  private async authHeaders(): Promise<HttpHeaders> {
    const token = await this.siteAuth.getValidIdToken();
    if (!token) throw new Error('Sign in to manage subscriptions.');
    return this.headers.set('Authorization', `Bearer ${token}`);
  }

  private normalizeAccountSubscription(input?: Partial<AccountSubscription> | null): AccountSubscription {
    const rawStatus = String(input?.status || 'NONE').toUpperCase();
    const status: AccountSubscriptionStatus = ['PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED'].includes(rawStatus)
      ? rawStatus as AccountSubscriptionStatus
      : 'NONE';
    return {
      email: String(input?.email || '').trim().toLowerCase(),
      status,
      topics: Array.isArray(input?.topics) ? input.topics.map((topic) => String(topic || '').trim().toLowerCase()).filter(Boolean) : [],
      source: input?.source || '',
      createdAt: input?.createdAt || null,
      updatedAt: input?.updatedAt || null,
      confirmedAt: input?.confirmedAt || null,
      unsubscribedAt: input?.unsubscribedAt || null
    };
  }

  private handleAccountError(error: any): Observable<never> {
    const message = error?.error?.error || error?.message || 'Subscription request failed';
    return throwError(() => new Error(message));
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

  private clearLastTrackedBlogPathForSession(): void {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.removeItem(this.promptLastTrackedBlogPathSessionKey);
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

  private generateConversionId(): string {
    return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
