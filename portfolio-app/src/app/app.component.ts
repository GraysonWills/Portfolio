import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd, ActivatedRoute, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';
import { RedisService } from './services/redis.service';
import { SeoService } from './services/seo.service';
import { environment } from '../environments/environment';
import { routeTransition } from './animations/route-animations';

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
  private readonly previewStorageKey = 'portfolio_preview_token_v1';

  constructor(
    private redisService: RedisService,
    private seo: SeoService,
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
    });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
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
}
