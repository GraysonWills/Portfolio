import { Component, ElementRef, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { Router, NavigationEnd, NavigationStart, ActivatedRoute, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';
import { RedisService } from './services/redis.service';
import { SeoService } from './services/seo.service';
import { environment } from '../environments/environment';
import { routeTransition } from './animations/route-animations';
import { AnalyticsService } from './services/analytics.service';
import { SiteConsentService } from './services/site-consent.service';
import { RouteViewStateService } from './services/route-view-state.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  standalone: false,
  styleUrl: './app.component.scss',
  animations: [routeTransition]
})
export class AppComponent implements OnInit, OnDestroy {
  @ViewChild('cookieBanner') private cookieBanner?: ElementRef<HTMLElement>;

  title = 'Grayson Wills - Portfolio';
  private currentRouteKey = '/';
  private routerSub!: Subscription;
  private navigationStartSub?: Subscription;
  private consentSub?: Subscription;
  private consentReviewSub?: Subscription;
  previewModeActive = false;
  cookieUiReady = false;
  showCookieBanner = false;
  currentAnalyticsPreference: boolean | null = null;
  consentConfirmation: { summary: string; detail: string } | null = null;
  private readonly previewStorageKey = 'portfolio_preview_token_v1';
  private cookiePreferenceTrigger: HTMLElement | null = null;
  private cookieUiReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private cookieFocusTimer: ReturnType<typeof setTimeout> | null = null;
  private consentConfirmationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private redisService: RedisService,
    private seo: SeoService,
    private analytics: AnalyticsService,
    private consent: SiteConsentService,
    private routeViewState: RouteViewStateService,
    private router: Router,
    private activatedRoute: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.redisService.setApiEndpoint(environment.redisApiUrl);
    this.initializePreviewMode();
    const initialConsent = this.consent.getConsentSnapshot();
    this.currentAnalyticsPreference = initialConsent.analytics;
    this.showCookieBanner = initialConsent.analytics === null;
    this.currentRouteKey = this.getCurrentPathOnly();
    this.syncOverlayBodyState();
    this.navigationStartSub = this.router.events.pipe(
      filter((event) => event instanceof NavigationStart)
    ).subscribe((event) => {
      this.routeViewState.captureSnapshot(this.currentRouteKey);
      const nextRouteKey = this.getPathOnly((event as NavigationStart).url);
      if (typeof window !== 'undefined' && !this.routeViewState.hasState(nextRouteKey)) {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    });
    this.consentSub = this.consent.consent$.subscribe((state) => {
      this.currentAnalyticsPreference = state.analytics;
      this.showCookieBanner = state.analytics === null;
      this.syncOverlayBodyState();
    });
    this.consentReviewSub = this.consent.reviewRequests$.subscribe(() => {
      this.captureCookiePreferenceTrigger();
      this.cookieUiReady = true;
      this.showCookieBanner = true;
      this.syncOverlayBodyState();
      this.focusCookiePreferenceAction();
    });
    this.prepareCookiePreferenceUi();

    this.routerSub = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.activatedRoute),
      map(route => {
        while (route.firstChild) { route = route.firstChild; }
        return route;
      }),
      mergeMap(route => route.data)
    ).subscribe(data => {
      const pageTitle = data['title'] as string | undefined;
      const description = data['description'] as string | undefined;
      const type = data['type'] as ('website' | 'article') | undefined;
      const configuredRobots = data['robots'] as string | undefined;

      const pathOnly = this.getCurrentPathOnly();
      const previewNoindex = /(?:\?|&)previewToken=/.test(this.router.url);
      this.seo.update({
        title: pageTitle,
        description,
        url: pathOnly,
        type,
        robots: previewNoindex ? 'noindex,nofollow,noarchive' : configuredRobots
      });
      this.updateRouteStructuredData(pathOnly);
      this.analytics.trackPageView(pathOnly, pageTitle);
      this.currentRouteKey = pathOnly;
    });

    const initialPath = this.getCurrentPathOnly();
    this.currentRouteKey = initialPath;
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.navigationStartSub?.unsubscribe();
    this.consentSub?.unsubscribe();
    this.consentReviewSub?.unsubscribe();
    if (this.cookieUiReadyTimer) clearTimeout(this.cookieUiReadyTimer);
    if (this.cookieFocusTimer) clearTimeout(this.cookieFocusTimer);
    if (this.consentConfirmationTimer) clearTimeout(this.consentConfirmationTimer);
    this.setBodyClass('cookie-banner-active', false);
    this.setBodyClass('mobile-overlay-active', false);
  }

  getRouteAnimationData(outlet: RouterOutlet): string {
    return outlet?.activatedRouteData?.['title'] || '';
  }

  exitPreviewMode(): void {
    this.previewModeActive = false;
    this.redisService.clearPreviewSessionToken();

    if (typeof window === 'undefined') return;

    try {
      sessionStorage.removeItem(this.previewStorageKey);
    } catch {
      // ignore
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('previewToken');
    url.searchParams.delete('previewClear');
    window.location.assign(url.toString());
  }

  acceptAnalyticsCookies(): void {
    this.consent.acceptAnalytics();
    this.showCookieBanner = false;
    this.syncOverlayBodyState();
    this.notifyCookiePreferenceSaved(
      'Analytics enabled',
      'Your choice was saved. Anonymous analytics are now allowed.'
    );
    this.restoreCookiePreferenceTrigger();
    const currentPath = this.getCurrentPathOnly();
    this.analytics.track('cookie_consent_updated', {
      route: currentPath,
      metadata: {
        source: 'cookie-banner',
        analytics: true
      }
    });
    this.analytics.trackPageView(currentPath, document.title || undefined);
  }

  useNecessaryCookiesOnly(): void {
    this.consent.rejectAnalytics();
    this.showCookieBanner = false;
    this.syncOverlayBodyState();
    this.notifyCookiePreferenceSaved(
      'Preference saved',
      'Only the necessary cookie used to remember this choice will remain.'
    );
    this.restoreCookiePreferenceTrigger();
  }

  private captureCookiePreferenceTrigger(): void {
    if (typeof document === 'undefined') return;
    this.cookiePreferenceTrigger = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }

  private focusCookiePreferenceAction(): void {
    if (typeof window === 'undefined') return;
    if (this.cookieFocusTimer) clearTimeout(this.cookieFocusTimer);

    this.cookieFocusTimer = setTimeout(() => {
      this.cookieFocusTimer = null;
      const choice = this.currentAnalyticsPreference === false ? 'necessary' : 'analytics';
      this.cookieBanner?.nativeElement
        .querySelector<HTMLButtonElement>(`[data-consent-choice="${choice}"]`)
        ?.focus();
    });
  }

  private restoreCookiePreferenceTrigger(): void {
    const trigger = this.cookiePreferenceTrigger;
    this.cookiePreferenceTrigger = null;
    if (typeof window === 'undefined' || !trigger?.isConnected) return;
    setTimeout(() => trigger.focus());
  }

  private notifyCookiePreferenceSaved(summary: string, detail: string): void {
    if (this.consentConfirmationTimer) clearTimeout(this.consentConfirmationTimer);
    this.consentConfirmation = { summary, detail };
    this.consentConfirmationTimer = setTimeout(() => {
      this.consentConfirmation = null;
      this.consentConfirmationTimer = null;
    }, 4000);
  }

  private prepareCookiePreferenceUi(): void {
    if (typeof window === 'undefined') return;
    if (this.cookieUiReadyTimer) clearTimeout(this.cookieUiReadyTimer);

    this.cookieUiReadyTimer = setTimeout(() => {
      this.cookieUiReadyTimer = null;
      const state = this.consent.getConsentSnapshot();
      this.currentAnalyticsPreference = state.analytics;
      this.showCookieBanner = state.analytics === null;
      this.cookieUiReady = true;
      this.syncOverlayBodyState();
    });
  }

  private initializePreviewMode(): void {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const clearRequested = params.get('previewClear') === '1';
    if (clearRequested) {
      this.redisService.clearPreviewSessionToken();
      this.previewModeActive = false;
      try {
        sessionStorage.removeItem(this.previewStorageKey);
      } catch {
        // ignore
      }
      return;
    }

    const queryToken = (params.get('previewToken') || '').trim();
    let token = queryToken;

    if (!token) {
      try {
        token = (sessionStorage.getItem(this.previewStorageKey) || '').trim();
      } catch {
        token = '';
      }
    }

    if (!token) {
      this.redisService.clearPreviewSessionToken();
      this.previewModeActive = false;
      return;
    }

    this.redisService.setPreviewSessionToken(token);
    this.previewModeActive = true;
    try {
      sessionStorage.setItem(this.previewStorageKey, token);
    } catch {
      // ignore
    }
  }

  private syncOverlayBodyState(): void {
    const cookieOpen = this.cookieUiReady && this.showCookieBanner;
    this.setBodyClass('cookie-banner-active', cookieOpen);
    this.setBodyClass('mobile-overlay-active', cookieOpen);
  }

  private setBodyClass(className: string, enabled: boolean): void {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle(className, enabled);
  }

  private getCurrentPathOnly(): string {
    return this.getPathOnly(this.router.url);
  }

  private updateRouteStructuredData(path: string): void {
    this.seo.clearStructuredData('route-entity');
    this.seo.clearStructuredData('route-breadcrumbs');
    const baseUrl = 'https://www.grayson-wills.com';
    const breadcrumb = (name: string) => ({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${baseUrl}/` },
        { '@type': 'ListItem', position: 2, name, item: `${baseUrl}${path}` }
      ]
    });

    if (path === '/') {
      this.seo.setStructuredData('route-entity', {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        '@id': `${baseUrl}/#profile`,
        url: `${baseUrl}/`,
        name: 'Grayson Wills — Profile and Portfolio',
        mainEntity: { '@id': `${baseUrl}/#person` },
        isPartOf: { '@id': `${baseUrl}/#website` }
      });
      return;
    }

    if (path === '/blog') {
      this.seo.setStructuredData('route-entity', {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        '@id': `${baseUrl}/blog#blog`,
        url: `${baseUrl}/blog`,
        name: 'Grayson Wills Blog',
        description: 'Field notes for curious builders on technology, creativity, personal development, and honest process.',
        author: { '@id': `${baseUrl}/#person` },
        publisher: { '@id': `${baseUrl}/#person` },
        isPartOf: { '@id': `${baseUrl}/#website` },
        inLanguage: 'en-US'
      });
      this.seo.setStructuredData('route-breadcrumbs', breadcrumb('Blog'));
      return;
    }

    if (path === '/projects') {
      this.seo.setStructuredData('route-entity', {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        '@id': `${baseUrl}/projects#collection`,
        url: `${baseUrl}/projects`,
        name: 'Projects by Grayson Wills',
        about: { '@id': `${baseUrl}/#person` },
        mainEntity: { '@type': 'ItemList', name: 'Selected projects' },
        isPartOf: { '@id': `${baseUrl}/#website` }
      });
      this.seo.setStructuredData('route-breadcrumbs', breadcrumb('Projects'));
      return;
    }

    if (path === '/work') {
      this.seo.setStructuredData('route-entity', {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        '@id': `${baseUrl}/work#profile`,
        url: `${baseUrl}/work`,
        name: 'Work experience of Grayson Wills',
        mainEntity: { '@id': `${baseUrl}/#person` },
        isPartOf: { '@id': `${baseUrl}/#website` }
      });
      this.seo.setStructuredData('route-breadcrumbs', breadcrumb('Work'));
    }
  }

  private getPathOnly(url: string | undefined | null): string {
    return String(url || '/').split('?')[0].split('#')[0] || '/';
  }
}
