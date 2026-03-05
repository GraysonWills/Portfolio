import { Component, HostListener, OnInit } from '@angular/core';
import { BlogCardV2, RedisService } from '../../services/redis.service';
import { ContentGroup, BlogPostMetadata } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';
import { SubscriptionService } from '../../services/subscription.service';
import { AnalyticsService } from '../../services/analytics.service';

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

@Component({
  selector: 'app-blog',
  standalone: false,
  templateUrl: './blog.component.html',
  styleUrl: './blog.component.scss'
})
export class BlogComponent implements OnInit {
  blogPosts: ContentGroup[] = [];
  blogCards: BlogPostCard[] = [];
  filteredPosts: BlogPostCard[] = [];
  visiblePosts: BlogPostCard[] = [];
  layout: 'list' | 'grid' = 'list';
  searchQuery: string = '';
  isLoading: boolean = true;
  subscribeEmail: string = '';
  isSubscribing: boolean = false;
  private visibleCount = 0;
  private readonly pageSize = 8;
  private readonly scrollLoadBufferPx = 500;
  private nextToken: string | null = null;
  private isFetchingNextPage = false;
  private hydratedImages = new Set<string>();

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
    private analytics: AnalyticsService
  ) {}

  ngOnInit(): void {
    this.loadBlogPosts();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.isLoading || !this.hasMorePosts) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const viewportBottom = window.scrollY + window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    if ((documentHeight - viewportBottom) <= this.scrollLoadBufferPx) {
      this.loadMorePosts();
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
      limit: 12,
      status: 'published',
      includeFuture: false,
      cacheScope: 'route:/blog:cards'
    }).subscribe({
      next: (response) => {
        const cards = Array.isArray(response?.items) ? response.items : [];
        this.blogCards = cards.map((item) => this.toPostCardFromV2(item));
        this.nextToken = response?.nextToken || null;
        this.filteredPosts = [...this.blogCards];
        this.resetVisiblePosts();
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
        this.filteredPosts = [...this.blogCards];
        this.resetVisiblePosts();
        this.isLoading = false;
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
    if (!this.searchQuery) {
      this.filteredPosts = [...this.blogCards];
      this.resetVisiblePosts();
      this.hydrateVisibleImages();
      return;
    }

    const query = this.searchQuery.toLowerCase();
    this.filteredPosts = this.blogCards.filter((post) => post.searchBlob.includes(query));
    this.resetVisiblePosts();
    this.hydrateVisibleImages();
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
    if (this.redisService.isBlogV2CardsEnabled() && !this.searchQuery.trim()) {
      return this.visiblePosts.length < this.filteredPosts.length || !!this.nextToken;
    }
    return this.visiblePosts.length < this.filteredPosts.length;
  }

  loadMorePosts(): void {
    if (!this.hasMorePosts) return;
    if (this.visiblePosts.length < this.filteredPosts.length) {
      this.visibleCount += this.pageSize;
      this.visiblePosts = this.filteredPosts.slice(0, this.visibleCount);
    }
    this.hydrateVisibleImages();

    if (this.redisService.isBlogV2CardsEnabled()) {
      const nearingEnd = this.visiblePosts.length >= (this.blogCards.length - 2);
      if (nearingEnd) {
        this.fetchNextBlogPage();
      }
    }
  }

  private resetVisiblePosts(): void {
    this.visibleCount = this.pageSize;
    this.visiblePosts = this.filteredPosts.slice(0, this.visibleCount);
  }

  private fetchNextBlogPage(): void {
    if (!this.nextToken || this.isFetchingNextPage) return;
    if (this.searchQuery.trim()) return;

    this.isFetchingNextPage = true;
    this.redisService.getBlogCardsV2({
      limit: 12,
      status: 'published',
      includeFuture: false,
      nextToken: this.nextToken,
      cacheScope: 'route:/blog:cards'
    }).subscribe({
      next: (response) => {
        this.isFetchingNextPage = false;
        this.nextToken = response?.nextToken || null;
        const incoming = (response?.items || []).map((item) => this.toPostCardFromV2(item));
        if (!incoming.length) return;

        const seen = new Set(this.blogCards.map((card) => card.listItemID));
        for (const card of incoming) {
          if (seen.has(card.listItemID)) continue;
          seen.add(card.listItemID);
          this.blogCards.push(card);
        }

        this.blogCards.sort((a, b) => b.publishTimestamp - a.publishTimestamp);
        if (this.searchQuery.trim()) {
          this.filterPosts();
        } else {
          const retainCount = Math.max(this.visibleCount, this.visiblePosts.length, this.pageSize);
          this.filteredPosts = [...this.blogCards];
          this.visibleCount = retainCount;
          this.visiblePosts = this.filteredPosts.slice(0, this.visibleCount);
          this.hydrateVisibleImages();
        }

        this.analytics.track('cards_next_page_loaded', {
          route: '/blog',
          page: 'blog',
          metadata: {
            appended: incoming.length,
            total: this.blogCards.length,
            visible: this.visiblePosts.length,
            hasMore: !!this.nextToken
          }
        });
      },
      error: () => {
        this.isFetchingNextPage = false;
      }
    });
  }

  private hydrateVisibleImages(): void {
    if (!this.redisService.isBlogV2CardsEnabled()) return;
    const idsToHydrate = this.visiblePosts
      .map((post) => post.listItemID)
      .filter((id) => !!id && !this.hydratedImages.has(id));
    if (!idsToHydrate.length) return;

    this.redisService.getBlogCardsMedia(idsToHydrate, {
      cacheScope: 'route:/blog:media'
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

  /**
   * Toggle layout view
   */
  toggleLayout(): void {
    this.layout = this.layout === 'list' ? 'grid' : 'list';
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
}
