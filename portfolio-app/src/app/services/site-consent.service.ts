import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

export type SiteConsentState = {
  necessary: true;
  analytics: boolean | null;
  version: 'v1';
  updatedAt: string | null;
};

type CookieLifetime =
  | { days: number; minutes?: never }
  | { minutes: number; days?: never };

@Injectable({
  providedIn: 'root'
})
export class SiteConsentService {
  readonly consentCookieName = 'gw_consent';
  readonly visitorCookieName = 'gw_vid';
  readonly sessionCookieName = 'gw_sid';
  readonly attributionCookieName = 'gw_attr';

  private readonly consentCookieLifetimeDays = 365;
  private readonly consentSubject = new BehaviorSubject<SiteConsentState>(this.readConsentState());
  private readonly reviewRequestSubject = new Subject<void>();

  readonly consent$ = this.consentSubject.asObservable();
  readonly reviewRequests$ = this.reviewRequestSubject.asObservable();

  getConsentSnapshot(): SiteConsentState {
    return this.consentSubject.value;
  }

  needsDecision(): boolean {
    return this.getConsentSnapshot().analytics === null;
  }

  hasAnalyticsConsent(): boolean {
    return this.getConsentSnapshot().analytics === true;
  }

  acceptAnalytics(): void {
    this.writeConsentState(true);
  }

  rejectAnalytics(): void {
    this.writeConsentState(false);
    this.deleteCookie(this.visitorCookieName);
    this.deleteCookie(this.sessionCookieName);
    this.deleteCookie(this.attributionCookieName);
  }

  requestPreferencesReview(): void {
    this.reviewRequestSubject.next();
  }

  getRawCookie(name: string): string {
    if (typeof document === 'undefined') return '';
    const target = `${String(name || '').trim()}=`;
    const parts = document.cookie.split(';');
    for (const part of parts) {
      const normalized = part.trim();
      if (!normalized.startsWith(target)) continue;
      return decodeURIComponent(normalized.slice(target.length));
    }
    return '';
  }

  readJsonCookie<T>(name: string): T | null {
    const raw = this.getRawCookie(name);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  setJsonCookie(name: string, value: unknown, lifetime: CookieLifetime): void {
    this.setCookie(name, JSON.stringify(value), lifetime);
  }

  deleteCookie(name: string): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`;
  }

  private writeConsentState(analytics: boolean): void {
    const nextState: SiteConsentState = {
      necessary: true,
      analytics,
      version: 'v1',
      updatedAt: new Date().toISOString()
    };
    this.setJsonCookie(this.consentCookieName, nextState, { days: this.consentCookieLifetimeDays });
    this.consentSubject.next(nextState);
  }

  private readConsentState(): SiteConsentState {
    const value = this.readJsonCookie<Partial<SiteConsentState>>(this.consentCookieName);
    if (!value || typeof value !== 'object') {
      return this.defaultConsentState();
    }

    const analytics = value.analytics === true ? true : value.analytics === false ? false : null;
    return {
      necessary: true,
      analytics,
      version: 'v1',
      updatedAt: typeof value.updatedAt === 'string' && value.updatedAt.trim() ? value.updatedAt : null
    };
  }

  private defaultConsentState(): SiteConsentState {
    return {
      necessary: true,
      analytics: null,
      version: 'v1',
      updatedAt: null
    };
  }

  private setCookie(name: string, rawValue: string, lifetime: CookieLifetime): void {
    if (typeof document === 'undefined') return;
    const encodedName = encodeURIComponent(String(name || '').trim());
    const encodedValue = encodeURIComponent(String(rawValue || ''));
    let cookie = `${encodedName}=${encodedValue}; Path=/; SameSite=Lax`;

    if (typeof lifetime.days === 'number') {
      cookie += `; Max-Age=${Math.max(0, Math.round(lifetime.days * 24 * 60 * 60))}`;
    } else if (typeof lifetime.minutes === 'number') {
      cookie += `; Max-Age=${Math.max(0, Math.round(lifetime.minutes * 60))}`;
    }

    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      cookie += '; Secure';
    }

    document.cookie = cookie;
  }
}
