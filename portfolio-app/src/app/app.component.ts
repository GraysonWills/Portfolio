import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd, NavigationStart, ActivatedRoute, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';
import { RedisService } from './services/redis.service';
import { SeoService } from './services/seo.service';
import { SubscriptionService } from './services/subscription.service';
import { environment } from '../environments/environment';
import { routeTransition } from './animations/route-animations';
import { MessageService } from 'primeng/api';
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
  title = 'Grayson Wills - Portfolio';
  private readonly buyMeCoffeeScriptId = 'bmc-widget-script';
  private readonly buyMeCoffeeMessage = 'If you’ve found value in my projects, writing, or tools, you can support the work here';
  private routerSub!: Subscription;
  private navigationStartSub?: Subscription;
  private consentSub?: Subscription;
  private consentReviewSub?: Subscription;
  private widgetObserver?: MutationObserver;
  private buyMeCoffeeLoadCleanup?: () => void;
  private buyMeCoffeeLoadTimer: ReturnType<typeof setTimeout> | null = null;
  private buyMeCoffeeScriptInjected = false;
  previewModeActive = false;
  showSubscribePrompt = false;
  showCookieBanner = false;
  subscribePromptEmail = '';
  isSubscribePromptSubmitting = false;
  private subscribePromptTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subscribePromptDelayMs = 1400;
  private readonly previewStorageKey = 'portfolio_preview_token_v1';

  constructor(
    private redisService: RedisService,
    private seo: SeoService,
    private subscriptions: SubscriptionService,
    private analytics: AnalyticsService,
    private consent: SiteConsentService,
    private routeViewState: RouteViewStateService,
    private messageService: MessageService,
    private router: Router,
    private activatedRoute: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.redisService.setApiEndpoint(environment.redisApiUrl);
    this.initializePreviewMode();
    this.showCookieBanner = this.consent.needsDecision();
    this.scheduleBuyMeCoffeeWidgetLoad();
    this.initializeWidgetObserver();
    this.syncOverlayBodyState();
    this.navigationStartSub = this.router.events.pipe(
      filter((event) => event instanceof NavigationStart)
    ).subscribe(() => {
      this.routeViewState.captureSnapshot(this.getCurrentPathOnly());
    });
    this.consentSub = this.consent.consent$.subscribe((state) => {
      this.showCookieBanner = state.analytics === null;
      if (this.showCookieBanner) {
        this.showSubscribePrompt = false;
      }
      this.syncOverlayBodyState();
    });
    this.consentReviewSub = this.consent.reviewRequests$.subscribe(() => {
      this.showCookieBanner = true;
      this.showSubscribePrompt = false;
      this.syncOverlayBodyState();
    });

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

      const pathOnly = this.getCurrentPathOnly();
      this.seo.update({ title: pageTitle, description, url: pathOnly, type });
      this.analytics.trackPageView(pathOnly, pageTitle);
      this.subscriptions.trackPromptRoute(pathOnly);
      this.maybeShowSubscribePrompt(pathOnly);
    });

    const initialPath = this.getCurrentPathOnly();
    this.subscriptions.trackPromptRoute(initialPath);
    this.maybeShowSubscribePrompt(initialPath);
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.navigationStartSub?.unsubscribe();
    this.consentSub?.unsubscribe();
    this.consentReviewSub?.unsubscribe();
    this.widgetObserver?.disconnect();
    this.clearSubscribePromptTimer();
    this.clearBuyMeCoffeeLoad();
    this.setBodyClass('cookie-banner-active', false);
    this.setBodyClass('subscribe-prompt-active', false);
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

  dismissSubscribePrompt(): void {
    const promptState = this.subscriptions.dismissPrompt();
    const currentPath = this.getCurrentPathOnly();
    this.showSubscribePrompt = false;
    this.subscribePromptEmail = '';
    this.syncOverlayBodyState();
    this.analytics.track('subscribe_prompt_dismissed', {
      route: currentPath,
      page: 'blog',
      metadata: {
        source: 'blog-engagement-modal',
        dismissCount: promptState.dismissCount,
        permanentlyDismissed: promptState.permanentlyDismissed
      }
    });
  }

  submitSubscribePrompt(): void {
    const currentPath = this.getCurrentPathOnly();
    const email = (this.subscribePromptEmail || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.analytics.track('subscribe_prompt_invalid_email', {
        route: currentPath,
        page: 'blog',
        metadata: { source: 'blog-engagement-modal' }
      });
      this.messageService.add({
        severity: 'warn',
        summary: 'Invalid Email',
        detail: 'Please enter a valid email address.'
      });
      return;
    }

    if (this.isSubscribePromptSubmitting) return;
    this.isSubscribePromptSubmitting = true;
    this.analytics.track('subscribe_prompt_submit_attempt', {
      route: currentPath,
      page: 'blog',
      metadata: { source: 'blog-engagement-modal' }
    });

    this.subscriptions.request(email, ['blog_posts'], 'blog-engagement-modal').subscribe({
      next: (result) => {
        this.isSubscribePromptSubmitting = false;
        this.showSubscribePrompt = false;
        this.subscribePromptEmail = '';
        this.syncOverlayBodyState();

        const status = String(result?.status || '').toUpperCase();
        if (status === 'ALREADY_SUBSCRIBED' || result?.alreadySubscribed) {
          this.analytics.track('subscribe_prompt_already_subscribed', {
            route: currentPath,
            page: 'blog',
            metadata: { source: 'blog-engagement-modal' }
          });
          this.subscriptions.setPromptState('subscribed');
          this.messageService.add({
            severity: 'info',
            summary: 'Already Subscribed',
            detail: 'This email is already subscribed to blog updates.'
          });
          return;
        }

        if (status === 'ALREADY_PENDING' || result?.alreadyPending) {
          this.analytics.track('subscribe_prompt_already_pending', {
            route: currentPath,
            page: 'blog',
            metadata: { source: 'blog-engagement-modal' }
          });
          this.subscriptions.setPromptState('requested');
          this.messageService.add({
            severity: 'info',
            summary: 'Check Your Email',
            detail: 'You already requested access. Please confirm from your inbox.'
          });
          return;
        }

        this.subscriptions.setPromptState('requested');
        this.analytics.track('subscribe_prompt_requested', {
          route: currentPath,
          page: 'blog',
          metadata: { source: 'blog-engagement-modal' }
        });
        this.messageService.add({
          severity: 'success',
          summary: 'Almost Done',
          detail: 'Check your email to confirm your subscription.'
        });
      },
      error: (err) => {
        this.isSubscribePromptSubmitting = false;
        this.analytics.track('subscribe_prompt_error', {
          route: currentPath,
          page: 'blog',
          metadata: {
            source: 'blog-engagement-modal',
            error: String(err?.error?.error || err?.message || 'unknown')
          }
        });
        const msg = err?.error?.error || err?.message || 'Failed to start subscription.';
        this.messageService.add({
          severity: 'error',
          summary: 'Subscribe Failed',
          detail: msg
        });
      }
    });
  }

  acceptAnalyticsCookies(): void {
    this.consent.acceptAnalytics();
    this.showCookieBanner = false;
    this.syncOverlayBodyState();
    const currentPath = this.getCurrentPathOnly();
    this.analytics.track('cookie_consent_updated', {
      route: currentPath,
      metadata: {
        source: 'cookie-banner',
        analytics: true
      }
    });
    this.analytics.trackPageView(currentPath, document.title || undefined);
    this.maybeShowSubscribePrompt(currentPath);
  }

  useNecessaryCookiesOnly(): void {
    this.consent.rejectAnalytics();
    this.showCookieBanner = false;
    this.syncOverlayBodyState();
    const currentPath = this.getCurrentPathOnly();
    this.maybeShowSubscribePrompt(currentPath);
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

  private maybeShowSubscribePrompt(pathOnly: string): void {
    if (typeof window === 'undefined') return;
    if (this.previewModeActive) {
      this.clearSubscribePromptTimer();
      this.showSubscribePrompt = false;
      this.syncOverlayBodyState();
      return;
    }
    if (this.showCookieBanner || this.consent.needsDecision()) {
      this.clearSubscribePromptTimer();
      this.showSubscribePrompt = false;
      this.syncOverlayBodyState();
      return;
    }

    if (this.shouldHidePromptForRoute(pathOnly)) {
      this.clearSubscribePromptTimer();
      this.showSubscribePrompt = false;
      this.syncOverlayBodyState();
      return;
    }

    if (!this.subscriptions.shouldShowPromptForPath(pathOnly)) {
      this.clearSubscribePromptTimer();
      this.showSubscribePrompt = false;
      this.syncOverlayBodyState();
      return;
    }

    if (this.showSubscribePrompt || this.subscribePromptTimer) return;

    this.subscribePromptTimer = setTimeout(() => {
      this.subscribePromptTimer = null;
      const currentPath = this.getCurrentPathOnly();
      if (this.shouldHidePromptForRoute(currentPath)) return;
      if (!this.subscriptions.shouldShowPromptForPath(currentPath)) return;
      this.subscriptions.markPromptShown();
      this.showSubscribePrompt = true;
      this.syncOverlayBodyState();
      this.analytics.track('subscribe_prompt_shown', {
        route: currentPath,
        page: 'blog',
        metadata: {
          source: 'blog-engagement-modal',
          blogVisitCount: this.subscriptions.getPromptInteractionState().blogVisitCount
        }
      });
    }, this.subscribePromptDelayMs);
  }

  private shouldHidePromptForRoute(pathOnly: string): boolean {
    const path = String(pathOnly || '/');
    return path.startsWith('/notifications');
  }

  private clearSubscribePromptTimer(): void {
    if (!this.subscribePromptTimer) return;
    clearTimeout(this.subscribePromptTimer);
    this.subscribePromptTimer = null;
  }

  private scheduleBuyMeCoffeeWidgetLoad(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined' || this.buyMeCoffeeScriptInjected) {
      return;
    }

    const loadWidget = () => {
      if (this.buyMeCoffeeLoadTimer || this.buyMeCoffeeScriptInjected) return;
      this.buyMeCoffeeLoadTimer = setTimeout(() => {
        this.buyMeCoffeeLoadTimer = null;
        this.injectBuyMeCoffeeWidget();
      }, 1200);
    };

    if (document.readyState === 'complete') {
      loadWidget();
      return;
    }

    const onLoad = () => loadWidget();
    window.addEventListener('load', onLoad, { once: true });
    this.buyMeCoffeeLoadCleanup = () => window.removeEventListener('load', onLoad);
  }

  private clearBuyMeCoffeeLoad(): void {
    this.buyMeCoffeeLoadCleanup?.();
    this.buyMeCoffeeLoadCleanup = undefined;

    if (this.buyMeCoffeeLoadTimer) {
      clearTimeout(this.buyMeCoffeeLoadTimer);
      this.buyMeCoffeeLoadTimer = null;
    }
  }

  private injectBuyMeCoffeeWidget(): void {
    if (typeof document === 'undefined' || this.buyMeCoffeeScriptInjected) return;
    if (document.getElementById(this.buyMeCoffeeScriptId)) {
      this.buyMeCoffeeScriptInjected = true;
      this.tagBuyMeCoffeeElements();
      return;
    }

    const script = document.createElement('script');
    script.id = this.buyMeCoffeeScriptId;
    script.src = 'https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js';
    script.async = true;
    script.setAttribute('data-name', 'BMC-Widget');
    script.setAttribute('data-cfasync', 'false');
    script.setAttribute('data-id', 'calvarygmak');
    script.setAttribute('data-description', 'Support me on Buy me a coffee!');
    script.setAttribute('data-message', this.buyMeCoffeeMessage);
    script.setAttribute('data-color', '#FF813F');
    script.setAttribute('data-position', 'Right');
    script.setAttribute('data-x_margin', '18');
    script.setAttribute('data-y_margin', '18');
    script.addEventListener('load', () => {
      this.buyMeCoffeeScriptInjected = true;
      this.tagBuyMeCoffeeElements();
    }, { once: true });
    script.addEventListener('error', () => {
      this.buyMeCoffeeScriptInjected = false;
    }, { once: true });
    document.body.appendChild(script);
  }

  private initializeWidgetObserver(): void {
    if (typeof document === 'undefined' || this.widgetObserver) return;
    this.tagBuyMeCoffeeElements();
    this.widgetObserver = new MutationObserver(() => this.tagBuyMeCoffeeElements());
    this.widgetObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'src', 'alt']
    });
  }

  private tagBuyMeCoffeeElements(): void {
    if (typeof document === 'undefined') return;

    document.querySelectorAll('img[alt="Buy Me A Coffee"]').forEach((node) => {
      node.classList.add('bmc-widget-button');
    });

    document.querySelectorAll('iframe[src*="buymeacoffee"]').forEach((node) => {
      node.classList.add('bmc-widget-frame');
    });

    const scriptMessage = this.buyMeCoffeeMessage;

    Array.from(document.body.querySelectorAll('div')).forEach((node) => {
      const text = String(node.textContent || '').trim();
      const style = String(node.getAttribute('style') || '');
      const looksLikeBmcMessage = (
        !!scriptMessage
        && text === scriptMessage
        && style.includes('position: fixed')
        && style.includes('z-index: 9999')
      );
      if (looksLikeBmcMessage) {
        node.classList.add('bmc-widget-message');
      }
    });
  }

  private syncOverlayBodyState(): void {
    const cookieOpen = this.showCookieBanner;
    const subscribeOpen = this.showSubscribePrompt;
    this.setBodyClass('cookie-banner-active', cookieOpen);
    this.setBodyClass('subscribe-prompt-active', subscribeOpen);
    this.setBodyClass('mobile-overlay-active', cookieOpen || subscribeOpen);
    this.tagBuyMeCoffeeElements();
  }

  private setBodyClass(className: string, enabled: boolean): void {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle(className, enabled);
  }

  private getCurrentPathOnly(): string {
    return (this.router.url || '/').split('?')[0].split('#')[0];
  }
}
