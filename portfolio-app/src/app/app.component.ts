import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd, ActivatedRoute, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';
import { RedisService } from './services/redis.service';
import { SeoService } from './services/seo.service';
import { SubscriptionService } from './services/subscription.service';
import { environment } from '../environments/environment';
import { routeTransition } from './animations/route-animations';
import { MessageService } from 'primeng/api';
import { AnalyticsService } from './services/analytics.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  standalone: false,
  styleUrl: './app.component.scss',
  animations: [routeTransition]
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Grayson Wills - Portfolio';
  private routerSub!: Subscription;
  previewModeActive = false;
  showSubscribePrompt = false;
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
    private messageService: MessageService,
    private router: Router,
    private activatedRoute: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.redisService.setApiEndpoint(environment.redisApiUrl);
    this.initializePreviewMode();

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

      const pathOnly = (this.router.url || '/').split('?')[0].split('#')[0];
      this.seo.update({ title: pageTitle, description, url: pathOnly, type });
      this.analytics.trackPageView(pathOnly, pageTitle);
      this.maybeShowSubscribePrompt(pathOnly);
    });

    const initialPath = (this.router.url || '/').split('?')[0].split('#')[0];
    this.maybeShowSubscribePrompt(initialPath);
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    if (this.subscribePromptTimer) {
      clearTimeout(this.subscribePromptTimer);
      this.subscribePromptTimer = null;
    }
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
    this.showSubscribePrompt = false;
    this.subscriptions.setPromptDismissedForSession(true);
    this.subscribePromptEmail = '';
    this.analytics.track('subscribe_prompt_dismissed', {
      route: this.router.url,
      page: 'home',
      metadata: { source: 'first-visit-popup' }
    });
  }

  submitSubscribePrompt(): void {
    const email = (this.subscribePromptEmail || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.analytics.track('subscribe_prompt_invalid_email', {
        route: this.router.url,
        page: 'home',
        metadata: { source: 'first-visit-popup' }
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
      route: this.router.url,
      page: 'home',
      metadata: { source: 'first-visit-popup' }
    });

    this.subscriptions.request(email, ['blog_posts'], 'first-visit-popup').subscribe({
      next: (result) => {
        this.isSubscribePromptSubmitting = false;
        this.showSubscribePrompt = false;
        this.subscribePromptEmail = '';

        const status = String(result?.status || '').toUpperCase();
        if (status === 'ALREADY_SUBSCRIBED' || result?.alreadySubscribed) {
          this.analytics.track('subscribe_prompt_already_subscribed', {
            route: this.router.url,
            page: 'home',
            metadata: { source: 'first-visit-popup' }
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
            route: this.router.url,
            page: 'home',
            metadata: { source: 'first-visit-popup' }
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
          route: this.router.url,
          page: 'home',
          metadata: { source: 'first-visit-popup' }
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
          route: this.router.url,
          page: 'home',
          metadata: {
            source: 'first-visit-popup',
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
    if (this.previewModeActive) return;

    if (this.shouldHidePromptForRoute(pathOnly)) {
      this.showSubscribePrompt = false;
      return;
    }

    if (this.subscriptions.getPromptState()) {
      this.showSubscribePrompt = false;
      return;
    }
    if (this.subscriptions.isPromptDismissedForSession()) {
      this.showSubscribePrompt = false;
      return;
    }

    if (this.showSubscribePrompt || this.subscribePromptTimer) return;

    this.subscribePromptTimer = setTimeout(() => {
      this.subscribePromptTimer = null;
      const currentPath = (this.router.url || '/').split('?')[0].split('#')[0];
      if (this.shouldHidePromptForRoute(currentPath)) return;
      if (this.subscriptions.getPromptState()) return;
      if (this.subscriptions.isPromptDismissedForSession()) return;
      this.showSubscribePrompt = true;
    }, this.subscribePromptDelayMs);
  }

  private shouldHidePromptForRoute(pathOnly: string): boolean {
    const path = String(pathOnly || '/');
    return path.startsWith('/notifications');
  }
}
