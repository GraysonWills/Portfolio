import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

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

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  private readonly endpoint = `${String(environment.redisApiUrl || '').replace(/\/+$/, '')}/analytics/events`;
  private readonly source = 'portfolio-app';
  private readonly flushIntervalMs = 10_000;
  private readonly maxBufferedEvents = 25;
  private readonly maxPayloadEvents = 25;
  private readonly visitorKey = 'portfolio_analytics_visitor_id';
  private readonly sessionKey = 'portfolio_analytics_session_id';

  private queue: AnalyticsEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private visitorId = '';
  private sessionId = '';
  private enabled = false;

  constructor() {
    this.enabled = typeof window !== 'undefined' && typeof fetch === 'function';
    if (!this.enabled) return;

    this.visitorId = this.getOrCreateLocal(this.visitorKey, true);
    this.sessionId = this.getOrCreateLocal(this.sessionKey, false);

    window.addEventListener('beforeunload', () => {
      this.flush(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
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
    if (!this.enabled) return;
    const type = String(eventType || '').trim();
    if (!type) return;

    const event: AnalyticsEvent = {
      type,
      ts: new Date().toISOString(),
      route: this.normalizeRoute(payload.route || window.location.pathname || '/'),
      page: payload.page || this.pageFromRoute(payload.route || window.location.pathname || '/'),
      source: this.source,
      referrer: payload.referrer || document.referrer || '',
      sessionId: payload.sessionId || this.sessionId,
      visitorId: payload.visitorId || this.visitorId,
      metadata: payload.metadata || {}
    };

    this.queue.push(event);

    if (this.queue.length >= this.maxBufferedEvents) {
      this.flush();
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.flushIntervalMs);
  }

  private async flush(useBeacon = false): Promise<void> {
    if (!this.enabled || !this.queue.length) return;
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
      // Re-queue once on transport failures to avoid data loss spikes.
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

  private getOrCreateLocal(key: string, usePersistentStorage: boolean): string {
    const generator = () =>
      `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      const storage = usePersistentStorage ? localStorage : sessionStorage;
      const existing = String(storage.getItem(key) || '').trim();
      if (existing) return existing;
      const created = generator();
      storage.setItem(key, created);
      return created;
    } catch {
      return generator();
    }
  }
}

