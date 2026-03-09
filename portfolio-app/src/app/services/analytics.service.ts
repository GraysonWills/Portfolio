import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { SiteConsentService } from './site-consent.service';

type AnalyticsEvent = {
  type: string;
  ts?: string;
  route?: string;
  page?: string;
  source?: string;
  referrer?: string;
  sessionId?: string;
  visitorId?: string;
  metadata?: Record<string, unknown>;
};

type VisitorCookieState = {
  id: string;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
};

type SessionCookieState = {
  id: string;
  index: number;
  startedAt: string;
  lastActivityAt: string;
};

type AttributionCookieState = {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  landingRoute: string;
  referrerDomain: string;
  capturedAt: string;
};

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  private readonly endpoint = `${String(environment.redisApiUrl || '').replace(/\/+$/, '')}/analytics/events`;
  private readonly source = 'portfolio-app';
  private readonly flushIntervalMs = 10_000;
  private readonly maxBufferedEvents = 25;
  private readonly maxPayloadEvents = 25;
  private readonly visitorCookieLifetimeDays = 395;
  private readonly attributionCookieLifetimeDays = 30;
  private readonly sessionCookieLifetimeMinutes = 30;

  private queue: AnalyticsEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private visitorId = '';
  private sessionId = '';
  private sessionIndex = 0;
  private visitorKind: 'new' | 'returning' = 'returning';
  private attribution: AttributionCookieState | null = null;
  private browserCapable = false;
  private analyticsEnabled = false;
  private readonly initialLandingRoute: string;
  private readonly initialUtmSource: string;
  private readonly initialUtmMedium: string;
  private readonly initialUtmCampaign: string;
  private readonly initialReferrerDomain: string;

  constructor(private consent: SiteConsentService) {
    this.browserCapable = typeof window !== 'undefined' && typeof fetch === 'function';
    this.initialLandingRoute = this.captureInitialLandingRoute();
    this.initialUtmSource = this.captureInitialUtmValue('utm_source');
    this.initialUtmMedium = this.captureInitialUtmValue('utm_medium');
    this.initialUtmCampaign = this.captureInitialUtmValue('utm_campaign');
    this.initialReferrerDomain = this.captureInitialReferrerDomain();

    if (!this.browserCapable) return;

    this.applyConsentState();
    this.consent.consent$.subscribe(() => {
      this.applyConsentState();
    });

    window.addEventListener('beforeunload', () => {
      this.flush(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
  }

  hasAnalyticsConsent(): boolean {
    return this.analyticsEnabled;
  }

  trackPageView(route: string, title?: string): void {
    this.track('page_view', {
      route: this.normalizeRoute(route),
      page: this.pageFromRoute(route),
      metadata: {
        title: title || document.title || ''
      }
    });
  }

  track(eventType: string, payload: Partial<AnalyticsEvent> = {}): void {
    if (!this.browserCapable || !this.analyticsEnabled) return;
    const type = String(eventType || '').trim();
    if (!type) return;

    this.refreshTrackingState();
    if (!this.visitorId || !this.sessionId) return;

    const route = this.normalizeRoute(payload.route || window.location.pathname || '/');
    const metadata = {
      ...(payload.metadata || {}),
      consent: {
        analytics: true
      },
      visitorKind: this.visitorKind,
      sessionIndex: this.sessionIndex,
      utmSource: this.attribution?.utmSource || '',
      utmMedium: this.attribution?.utmMedium || '',
      utmCampaign: this.attribution?.utmCampaign || '',
      landingRoute: this.attribution?.landingRoute || this.initialLandingRoute,
      referrerDomain: this.attribution?.referrerDomain || this.initialReferrerDomain
    };

    const event: AnalyticsEvent = {
      type,
      ts: new Date().toISOString(),
      route,
      page: payload.page || this.pageFromRoute(route),
      source: this.source,
      referrer: payload.referrer || document.referrer || '',
      sessionId: payload.sessionId || this.sessionId,
      visitorId: payload.visitorId || this.visitorId,
      metadata
    };

    this.queue.push(event);

    if (this.queue.length >= this.maxBufferedEvents) {
      this.flush();
      return;
    }
    this.scheduleFlush();
  }

  private applyConsentState(): void {
    if (!this.browserCapable) return;

    if (!this.consent.hasAnalyticsConsent()) {
      this.analyticsEnabled = false;
      this.queue = [];
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.visitorId = '';
      this.sessionId = '';
      this.sessionIndex = 0;
      this.visitorKind = 'returning';
      this.attribution = null;
      return;
    }

    this.analyticsEnabled = true;
    this.initializeTrackingState();
  }

  private initializeTrackingState(): void {
    const visitor = this.getOrCreateVisitorState();
    this.visitorId = visitor.state.id;
    this.visitorKind = visitor.isNew ? 'new' : 'returning';

    const session = this.getOrCreateSessionState(visitor.state);
    this.sessionId = session.id;
    this.sessionIndex = session.index;
    this.attribution = this.getOrCreateAttributionState();
  }

  private refreshTrackingState(): void {
    if (!this.analyticsEnabled) return;

    let visitor = this.consent.readJsonCookie<VisitorCookieState>(this.consent.visitorCookieName);
    if (!visitor?.id) {
      const created = this.getOrCreateVisitorState();
      visitor = created.state;
      if (this.visitorKind !== 'new') {
        this.visitorKind = created.isNew ? 'new' : 'returning';
      }
      this.visitorId = visitor.id;
    }

    if (!visitor) return;
    const session = this.getOrCreateSessionState(visitor);
    this.sessionId = session.id;
    this.sessionIndex = session.index;
    this.attribution = this.getOrCreateAttributionState();
  }

  private getOrCreateVisitorState(): { state: VisitorCookieState; isNew: boolean } {
    const existing = this.consent.readJsonCookie<VisitorCookieState>(this.consent.visitorCookieName);
    if (existing?.id) {
      return {
        state: existing,
        isNew: false
      };
    }

    const nowIso = new Date().toISOString();
    const state: VisitorCookieState = {
      id: this.generateEventId(),
      sessionCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    this.consent.setJsonCookie(this.consent.visitorCookieName, state, { days: this.visitorCookieLifetimeDays });
    return { state, isNew: true };
  }

  private getOrCreateSessionState(visitor: VisitorCookieState): SessionCookieState {
    const existing = this.consent.readJsonCookie<SessionCookieState>(this.consent.sessionCookieName);
    const nowIso = new Date().toISOString();

    if (existing?.id && Number.isFinite(existing.index) && existing.index > 0) {
      const refreshed: SessionCookieState = {
        ...existing,
        lastActivityAt: nowIso
      };
      this.consent.setJsonCookie(this.consent.sessionCookieName, refreshed, { minutes: this.sessionCookieLifetimeMinutes });
      return refreshed;
    }

    const nextSessionCount = Math.max(0, Number(visitor.sessionCount) || 0) + 1;
    const updatedVisitor: VisitorCookieState = {
      ...visitor,
      sessionCount: nextSessionCount,
      updatedAt: nowIso
    };
    this.consent.setJsonCookie(this.consent.visitorCookieName, updatedVisitor, { days: this.visitorCookieLifetimeDays });

    const session: SessionCookieState = {
      id: this.generateEventId(),
      index: nextSessionCount,
      startedAt: nowIso,
      lastActivityAt: nowIso
    };
    this.consent.setJsonCookie(this.consent.sessionCookieName, session, { minutes: this.sessionCookieLifetimeMinutes });
    return session;
  }

  private getOrCreateAttributionState(): AttributionCookieState {
    const existing = this.consent.readJsonCookie<AttributionCookieState>(this.consent.attributionCookieName);
    if (existing && typeof existing === 'object') {
      return existing;
    }

    const state: AttributionCookieState = {
      utmSource: this.initialUtmSource,
      utmMedium: this.initialUtmMedium,
      utmCampaign: this.initialUtmCampaign,
      landingRoute: this.initialLandingRoute,
      referrerDomain: this.initialReferrerDomain,
      capturedAt: new Date().toISOString()
    };

    this.consent.setJsonCookie(this.consent.attributionCookieName, state, { days: this.attributionCookieLifetimeDays });
    return state;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.flushIntervalMs);
  }

  private async flush(useBeacon = false): Promise<void> {
    if (!this.browserCapable || !this.analyticsEnabled || !this.queue.length) return;
    const batch = this.queue.splice(0, this.maxPayloadEvents);
    const body = JSON.stringify({ events: batch });

    try {
      if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(this.endpoint, blob);
      } else {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
          credentials: 'omit'
        });

        if (!response.ok) {
          throw new Error(`Analytics request failed: ${response.status}`);
        }
      }
    } catch {
      this.queue = [...batch, ...this.queue].slice(0, this.maxBufferedEvents);
    }

    if (this.queue.length > 0 && !this.flushTimer) {
      this.scheduleFlush();
    }
  }

  private normalizeRoute(route: string): string {
    const value = String(route || '/');
    const path = value.split('?')[0].split('#')[0] || '/';
    return path.startsWith('/') ? path : `/${path}`;
  }

  private pageFromRoute(route: string): string {
    const normalized = this.normalizeRoute(route);
    if (normalized === '/' || normalized.startsWith('/home')) return 'home';
    if (normalized.startsWith('/work')) return 'work';
    if (normalized.startsWith('/projects')) return 'projects';
    if (normalized.startsWith('/blog')) return 'blog';
    if (normalized.startsWith('/notifications')) return 'notifications';
    return 'other';
  }

  private captureInitialLandingRoute(): string {
    if (typeof window === 'undefined') return '/';
    return this.normalizeRoute(window.location.pathname || '/');
  }

  private captureInitialUtmValue(paramName: string): string {
    if (typeof window === 'undefined') return '';
    try {
      const value = new URL(window.location.href).searchParams.get(paramName);
      return String(value || '').trim();
    } catch {
      return '';
    }
  }

  private captureInitialReferrerDomain(): string {
    if (typeof document === 'undefined') return '';
    const referrer = String(document.referrer || '').trim();
    if (!referrer) return '';

    try {
      return new URL(referrer).hostname.replace(/^www\./i, '');
    } catch {
      return '';
    }
  }

  private generateEventId(): string {
    return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
