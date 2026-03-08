import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BlogCardV2, RedisService } from '../../services/redis.service';
import { ContentGroup, BlogPostMetadata } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';
import { SubscriptionService } from '../../services/subscription.service';
import { AnalyticsService } from '../../services/analytics.service';
import { firstValueFrom, Subscription } from 'rxjs';
import { RouteViewStateService } from '../../services/route-view-state.service';

interface BlogPostCard {
  source: ContentGroup;
  listItemID: string;
  title: string;
  summary: string;
  content: string;
  image?: string;
  publishDate: Date | null;
  publishTimestamp: number;
  tags: string[];
  status: string;
  category: string;
  readTime: number;
  searchBlob: string;
}

interface BlogViewState extends Record<string, unknown> {
  layout?: 'list' | 'grid';
  layoutPreference?: 'auto' | 'manual';
  searchQuery?: string;
  currentPage?: number;
  scrollY?: number;
  updatedAt?: number;
}

@Component({
  selector: 'app-blog',
  standalone: false,
  templateUrl: './blog.component.html',
  styleUrl: './blog.component.scss'
})
export class BlogComponent implements OnInit, OnDestroy {
  blogPosts: ContentGroup[] = [];
  blogCards: BlogPostCard[] = [];
  filteredPosts: BlogPostCard[] = [];
  visiblePosts: BlogPostCard[] = [];
  layout: 'list' | 'grid' = 'list';
  searchQuery: string = '';
  isLoading: boolean = true;
  subscribeEmail: string = '';
  isSubscribing: boolean = false;
  currentPage: number = 1;
  isPageTransitioning: boolean = false;
  private readonly pageSize = 10;
  private nextToken: string | null = null;
  private isFetchingNextPage = false;
  private hydratedImages = new Set<string>();
  private readonly initialFetchLimit = 10;
  private readonly cardsCacheScope = 'route:/blog:cards';
  private readonly mediaCacheScope = 'route:/blog:media';
  private routePage = 1;
  private queryParamSub?: Subscription;
  private fetchNextPagePromise: Promise<boolean> | null = null;
  private readonly routeKey = '/blog';
  private layoutPreference: 'auto' | 'manual' = 'auto';
  private viewStateRestored = false;
  private initialSavedViewState: BlogViewState | null = null;
  private lastScrollY = 0;

  /**
   * ╔══════════════════════════════════════════════════════════════╗
   * ║  FUTURE: Blog Sectionalization                              ║
   * ║                                                              ║
   * ║  To group posts by category (like Projects accordion):       ║
   * ║  1. Add: categoryGroups: Map<string, ContentGroup[]>         ║
   * ║  2. Add: expandedCategories: Record<string, boolean> = {}    ║
   * ║  3. In loadBlogPosts success handler, call groupByCategory() ║
   * ║  4. groupByCategory() groups filteredPosts by                ║
   * ║     (metadata as BlogPostMetadata).category                  ║
   * ║  5. Template: wrap each group in accordion-section divs      ║
   * ║     (reuse .accordion-header / .accordion-body from projects)║
   * ║  6. Seed data already has `category` field on each post      ║
   * ╚══════════════════════════════════════════════════════════════╝
   */

  constructor(
    private redisService: RedisService,
    private messageService: MessageService,
    private subscriptions: SubscriptionService,
    private analytics: AnalyticsService,
    private route: ActivatedRoute,
    private router: Router,
    private routeViewState: RouteViewStateService
  ) {}

  ngOnInit(): void {
    this.initialSavedViewState = this.routeViewState.getState<BlogViewState>(this.routeKey);
    this.applySavedViewPreferences(this.initialSavedViewState);
    this.syncResponsiveLayout();
    this.queryParamSub = this.route.queryParamMap.subscribe((params) => {
      const pageParam = params.get('page');
      this.routePage = pageParam
        ? this.parsePageParam(pageParam)
        : this.parsePageParam(String(this.initialSavedViewState?.currentPage || 1));
      void this.syncPageFromRoute();
    });
    this.loadBlogPosts();
  }

  ngOnDestroy(): void {
    this.persistViewState();
    this.queryParamSub?.unsubscribe();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.syncResponsiveLayout();
    if (this.layoutPreference === 'auto') {
      this.persistViewState();
    }
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (typeof window !== 'undefined') {
      this.lastScrollY = window.scrollY;
    }
  }

  /**
   * Load blog posts from Redis
   */
  private loadBlogPosts(): void {
    this.isLoading = true;
    this.nextToken = null;
    this.isFetchingNextPage = false;
    this.hydratedImages.clear();
    if (!this.redisService.isBlogV2CardsEnabled()) {
      this.loadLegacyBlogPosts();
      return;
    }

    this.redisService.getBlogCardsV2({
      limit: this.initialFetchLimit,
      status: 'published',
      includeFuture: false,
      cacheScope: this.cardsCacheScope
    }).subscribe({
      next: (response) => {
        const cards = Array.isArray(response?.items) ? response.items : [];
        this.blogCards = cards.map((item) => this.toPostCardFromV2(item));
        this.nextToken = response?.nextToken || null;
        this.rebuildVisibleState();
        this.analytics.track('cards_rendered_initial', {
          route: '/blog',
          page: 'blog',
          metadata: {
            returned: this.blogCards.length,
            visible: this.visiblePosts.length,
            hasMore: !!this.nextToken
          }
        });
        this.hydrateVisibleImages();
        this.isLoading = false;
        void this.syncPageFromRoute();
      },
      error: (error) => {
        console.error('Error loading v2 blog cards:', error);
        this.loadLegacyBlogPosts();
      }
    });
  }

  private loadLegacyBlogPosts(): void {
    this.redisService.getBlogPosts().subscribe({
      next: (posts: ContentGroup[]) => {
        this.blogPosts = posts;
        this.blogCards = posts
          .map((post) => this.toPostCard(post))
          .sort((a, b) => b.publishTimestamp - a.publishTimestamp);
        this.rebuildVisibleState();
        this.isLoading = false;
        void this.syncPageFromRoute();
      },
      error: (error) => {
        console.error('Error loading blog posts:', error);
        this.isLoading = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load blog posts'
        });
      }
    });
  }

  /**
   * Estimate reading time based on word count (~200 words per minute)
   */
  private estimateReadTime(text: string): number {
    if (!text) return 1;
    const words = text.trim().split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 200));
  }

  private resolveReadTimeMinutes(metadata: BlogPostMetadata | undefined, content: string): number {
    const manual = Number((metadata as any)?.readTimeMinutes);
    if (Number.isFinite(manual) && manual > 0) {
      return Math.max(1, Math.round(manual));
    }
    return this.estimateReadTime(content);
  }

  /**
   * Filter blog posts by search query
   */
  filterPosts(): void {
    const query = this.searchQuery.trim().toLowerCase();
    if (query && this.redisService.isBlogV2CardsEnabled() && !!this.nextToken) {
      void this.fetchRemainingBlogPages();
    }

    this.rebuildVisibleState(1);
    void this.syncRouteToPage(1, true);
    this.hydrateVisibleImages();
    this.persistViewState();
  }

  private toPostCard(post: ContentGroup): BlogPostCard {
    const textItem = post.items.find(item => item.Text);
    const imageItem = post.items.find(item => item.Photo);
    const metadata = post.metadata as BlogPostMetadata | undefined;
    const content = textItem?.Text || '';
    const title = metadata?.title || 'Untitled';
    const summary = metadata?.summary || content.substring(0, 150) || '';
    const tags = metadata?.tags || [];
    const publishDate = metadata?.publishDate ? new Date(metadata.publishDate) : null;
    const readTime = this.resolveReadTimeMinutes(metadata, content);
    const status = metadata?.status || 'published';
    const category = metadata?.category || 'General';
    const searchBlob = `${title} ${summary} ${content} ${tags.join(' ')}`.toLowerCase();

    return {
      source: post,
      listItemID: post.listItemID,
      title: metadata?.title || 'Untitled',
      summary,
      content: content,
      image: imageItem?.Photo,
      publishDate,
      publishTimestamp: publishDate ? publishDate.getTime() : 0,
      tags,
      status,
      category,
      readTime,
      searchBlob
    };
  }

  private toPostCardFromV2(post: BlogCardV2): BlogPostCard {
    const publishDate = post.publishDate ? new Date(post.publishDate) : null;
    const searchBlob = `${post.title} ${post.summary} ${(post.tags || []).join(' ')} ${(post.privateSeoTags || []).join(' ')} ${post.category || ''}`.toLowerCase();

    return {
      source: {
        listItemID: post.listItemID,
        items: [],
        metadata: {
          title: post.title,
          summary: post.summary,
          tags: post.tags,
          privateSeoTags: post.privateSeoTags,
          publishDate: publishDate || undefined,
          status: post.status as any,
          category: post.category,
          readTimeMinutes: post.readTimeMinutes
        } as any
      },
      listItemID: post.listItemID,
      title: post.title || 'Untitled',
      summary: post.summary || '',
      content: '',
      image: undefined,
      publishDate,
      publishTimestamp: publishDate ? publishDate.getTime() : 0,
      tags: post.tags || [],
      status: post.status || 'published',
      category: post.category || 'General',
      readTime: Math.max(1, Number(post.readTimeMinutes) || 1),
      searchBlob
    };
  }

  /**
   * TrackBy function for ngFor performance
   */
  trackByPost(index: number, post: BlogPostCard): string {
    return post.listItemID || index.toString();
  }

  trackByTag(index: number, tag: string): string {
    return `${tag}-${index}`;
  }

  get hasMorePosts(): boolean {
    return this.canGoToNextPage;
  }

  loadMorePosts(): void {
    this.goToNextPage();
  }

  get shouldShowPagination(): boolean {
    return this.filteredPosts.length > this.pageSize || (!this.searchQuery.trim() && !!this.nextToken);
  }

  get totalLoadedPages(): number {
    return Math.max(1, Math.ceil(this.filteredPosts.length / this.pageSize));
  }

  get totalDisplayPages(): number {
    return this.totalLoadedPages + ((!this.searchQuery.trim() && this.nextToken) ? 1 : 0);
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalDisplayPages }, (_, index) => index + 1);
  }

  get canGoToPreviousPage(): boolean {
    return this.currentPage > 1;
  }

  get canGoToNextPage(): boolean {
    if (this.isLoading || this.isPageTransitioning) return false;
    if (this.currentPage < this.totalLoadedPages) return true;
    return !this.searchQuery.trim() && !!this.nextToken;
  }

  get paginationRangeLabel(): string {
    if (!this.filteredPosts.length) return '0 posts';
    const start = ((this.currentPage - 1) * this.pageSize) + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.filteredPosts.length);
    const suffix = (!this.searchQuery.trim() && this.nextToken) ? '+' : '';
    return `Showing ${start}-${end} of ${this.filteredPosts.length}${suffix} posts`;
  }

  async goToPage(page: number): Promise<void> {
    const safePage = Math.max(1, Math.floor(page || 1));
    await this.syncRouteToPage(safePage);
  }

  async goToPreviousPage(): Promise<void> {
    if (!this.canGoToPreviousPage) return;
    await this.goToPage(this.currentPage - 1);
  }

  async goToNextPage(): Promise<void> {
    if (!this.canGoToNextPage) return;
    await this.goToPage(this.currentPage + 1);
  }

  private hydrateVisibleImages(): void {
    if (!this.redisService.isBlogV2CardsEnabled()) return;
    const idsToHydrate = this.visiblePosts
      .map((post) => post.listItemID)
      .filter((id) => !!id && !this.hydratedImages.has(id));
    if (!idsToHydrate.length) return;

    this.redisService.getBlogCardsMedia(idsToHydrate, {
      cacheScope: this.mediaCacheScope
    }).subscribe({
      next: (mediaItems) => {
        if (!Array.isArray(mediaItems) || !mediaItems.length) return;
        const mediaMap = new Map(mediaItems.map((item) => [item.listItemID, item.imageUrl]));
        let hydratedNow = 0;

        this.blogCards.forEach((card) => {
          const imageUrl = mediaMap.get(card.listItemID);
          if (!imageUrl) return;
          if (!this.hydratedImages.has(card.listItemID)) {
            hydratedNow += 1;
          }
          card.image = imageUrl;
          this.hydratedImages.add(card.listItemID);
        });

        // Keep visible/filtered arrays in sync with updated card image fields.
        this.filteredPosts = this.filteredPosts.map((post) => {
          const updated = this.blogCards.find((card) => card.listItemID === post.listItemID);
          return updated || post;
        });
        this.visiblePosts = this.visiblePosts.map((post) => {
          const updated = this.blogCards.find((card) => card.listItemID === post.listItemID);
          return updated || post;
        });

        if (hydratedNow > 0) {
          this.analytics.track('cards_images_hydrated', {
            route: '/blog',
            page: 'blog',
            metadata: {
              hydratedNow,
              totalHydrated: this.hydratedImages.size,
              visible: this.visiblePosts.length
            }
          });
        }
      },
      error: () => {
        // Keep text-first cards visible even when media hydration fails.
      }
    });
  }

  private parsePageParam(raw: string | null): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.max(1, Math.floor(parsed));
  }

  private async syncRouteToPage(page: number, replaceUrl: boolean = false): Promise<void> {
    const currentParam = this.parsePageParam(this.route.snapshot.queryParamMap.get('page'));
    if (currentParam === page || (page === 1 && currentParam === 1 && !this.route.snapshot.queryParamMap.has('page'))) {
      this.routePage = page;
      await this.syncPageFromRoute();
      return;
    }

    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page > 1 ? page : null },
      queryParamsHandling: 'merge',
      replaceUrl
    });
  }

  private async syncPageFromRoute(): Promise<void> {
    if (this.isLoading) return;

    const targetPage = Math.max(1, this.routePage);
    if (this.searchQuery.trim() && this.redisService.isBlogV2CardsEnabled() && !!this.nextToken) {
      await this.fetchRemainingBlogPages();
    }
    if (!this.searchQuery.trim() && this.redisService.isBlogV2CardsEnabled()) {
      this.isPageTransitioning = true;
      try {
        await this.ensurePageLoaded(targetPage);
      } finally {
        this.isPageTransitioning = false;
      }
    }

    const maxPage = this.totalDisplayPages;
    this.currentPage = Math.min(Math.max(1, targetPage), Math.max(1, maxPage));
    this.applyVisiblePage();
    this.hydrateVisibleImages();
    this.persistViewState();

    if (!this.viewStateRestored) {
      this.viewStateRestored = true;
      await this.routeViewState.restoreScroll(this.routeKey);
    }
  }

  private rebuildVisibleState(page: number = this.currentPage): void {
    const query = this.searchQuery.trim().toLowerCase();
    this.filteredPosts = query
      ? this.blogCards.filter((post) => post.searchBlob.includes(query))
      : [...this.blogCards];
    this.currentPage = Math.max(1, page);
    this.applyVisiblePage();
  }

  private applyVisiblePage(): void {
    const normalizedPage = Math.max(1, Math.min(this.currentPage, Math.max(1, this.totalDisplayPages)));
    const startIndex = (normalizedPage - 1) * this.pageSize;
    this.currentPage = normalizedPage;
    this.visiblePosts = this.filteredPosts.slice(startIndex, startIndex + this.pageSize);
  }

  private async ensurePageLoaded(page: number): Promise<void> {
    const requiredCount = page * this.pageSize;
    while (this.blogCards.length < requiredCount && !!this.nextToken) {
      const loaded = await this.fetchNextBlogPage();
      if (!loaded) break;
    }
  }

  private async fetchRemainingBlogPages(): Promise<void> {
    while (!!this.nextToken) {
      const loaded = await this.fetchNextBlogPage();
      if (!loaded) break;
    }
  }

  private async fetchNextBlogPage(): Promise<boolean> {
    if (!this.nextToken) return false;
    if (this.fetchNextPagePromise) {
      return this.fetchNextPagePromise;
    }

    this.fetchNextPagePromise = (async () => {
      this.isFetchingNextPage = true;
      try {
        const response = await firstValueFrom(this.redisService.getBlogCardsV2({
          limit: this.initialFetchLimit,
          status: 'published',
          includeFuture: false,
          nextToken: this.nextToken,
          cacheScope: this.cardsCacheScope
        }));

        this.nextToken = response?.nextToken || null;
        const incoming = (response?.items || []).map((item) => this.toPostCardFromV2(item));
        const appended = this.appendIncomingCards(incoming);
        this.rebuildVisibleState(this.currentPage);
        this.hydrateVisibleImages();

        this.analytics.track('cards_next_page_loaded', {
          route: '/blog',
          page: 'blog',
          metadata: {
            appended,
            total: this.blogCards.length,
            visible: this.visiblePosts.length,
            hasMore: !!this.nextToken
          }
        });

        return appended > 0 || !!this.nextToken;
      } catch {
        return false;
      } finally {
        this.isFetchingNextPage = false;
        this.fetchNextPagePromise = null;
      }
    })();

    return this.fetchNextPagePromise;
  }

  private appendIncomingCards(incoming: BlogPostCard[]): number {
    if (!incoming.length) return 0;
    const seen = new Set(this.blogCards.map((card) => card.listItemID));
    let appended = 0;

    for (const card of incoming) {
      if (seen.has(card.listItemID)) continue;
      seen.add(card.listItemID);
      this.blogCards.push(card);
      appended += 1;
    }

    if (appended > 0) {
      this.blogCards.sort((a, b) => b.publishTimestamp - a.publishTimestamp);
    }

    return appended;
  }

  /**
   * Toggle layout view
   */
  toggleLayout(): void {
    this.layout = this.layout === 'list' ? 'grid' : 'list';
    this.layoutPreference = 'manual';
    this.persistViewState();
    this.analytics.track('blog_layout_toggled', {
      route: '/blog',
      page: 'blog',
      metadata: { layout: this.layout }
    });
  }

  trackPostOpen(post: ContentGroup): void {
    const metadata = post.metadata as BlogPostMetadata | undefined;
    this.analytics.track('blog_post_open_clicked', {
      route: '/blog',
      page: 'blog',
      metadata: {
        listItemID: post.listItemID,
        title: metadata?.title || 'Untitled',
        category: metadata?.category || 'General'
      }
    });
  }

  subscribe(): void {
    const email = (this.subscribeEmail || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.analytics.track('blog_subscribe_invalid_email', {
        route: '/blog',
        page: 'blog',
        metadata: { source: 'blog-list' }
      });
      this.messageService.add({
        severity: 'warn',
        summary: 'Invalid Email',
        detail: 'Please enter a valid email address.'
      });
      return;
    }

    if (this.isSubscribing) return;
    this.isSubscribing = true;
    this.analytics.track('blog_subscribe_attempt', {
      route: '/blog',
      page: 'blog',
      metadata: { source: 'blog-list' }
    });

    this.subscriptions.request(email, ['blog_posts'], 'blog-list').subscribe({
      next: (result) => {
        this.isSubscribing = false;

        const status = String(result?.status || '').toUpperCase();
        if (status === 'ALREADY_SUBSCRIBED' || result?.alreadySubscribed) {
          this.analytics.track('blog_subscribe_already_subscribed', {
            route: '/blog',
            page: 'blog',
            metadata: { source: 'blog-list' }
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
          this.analytics.track('blog_subscribe_already_pending', {
            route: '/blog',
            page: 'blog',
            metadata: { source: 'blog-list' }
          });
          this.subscriptions.setPromptState('requested');
          this.messageService.add({
            severity: 'info',
            summary: 'Check Your Email',
            detail: 'You already requested access. Please confirm from your inbox.'
          });
          return;
        }

        this.subscribeEmail = '';
        this.subscriptions.setPromptState('requested');
        this.analytics.track('blog_subscribe_requested', {
          route: '/blog',
          page: 'blog',
          metadata: { source: 'blog-list' }
        });
        this.messageService.add({
          severity: 'success',
          summary: 'Almost Done',
          detail: 'Check your email to confirm your subscription.'
        });
      },
      error: (err) => {
        this.isSubscribing = false;
        this.analytics.track('blog_subscribe_error', {
          route: '/blog',
          page: 'blog',
          metadata: {
            source: 'blog-list',
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

  private applySavedViewPreferences(state: BlogViewState | null): void {
    if (!state) return;

    const savedLayout = state.layout === 'grid' ? 'grid' : 'list';
    this.layoutPreference = state.layoutPreference === 'manual' ? 'manual' : 'auto';
    this.searchQuery = String(state.searchQuery || '');

    if (this.layoutPreference === 'manual') {
      this.layout = savedLayout;
    }
  }

  private syncResponsiveLayout(): void {
    if (typeof window === 'undefined' || this.layoutPreference === 'manual') return;

    const isLandscape = window.innerWidth > window.innerHeight;
    this.layout = (window.innerWidth >= 960 || (isLandscape && window.innerWidth >= 768))
      ? 'grid'
      : 'list';
  }

  private persistViewState(): void {
    this.routeViewState.setState<BlogViewState>(this.routeKey, {
      layout: this.layout,
      layoutPreference: this.layoutPreference,
      searchQuery: this.searchQuery,
      currentPage: this.currentPage,
      scrollY: typeof window !== 'undefined' ? this.lastScrollY || window.scrollY : 0
    });
  }
}
