import { Component, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { ContentGroup, BlogPostMetadata } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';
import { SubscriptionService } from '../../services/subscription.service';
import { AnalyticsService } from '../../services/analytics.service';

@Component({
  selector: 'app-blog',
  standalone: false,
  templateUrl: './blog.component.html',
  styleUrl: './blog.component.scss'
})
export class BlogComponent implements OnInit {
  blogPosts: ContentGroup[] = [];
  filteredPosts: ContentGroup[] = [];
  layout: 'list' | 'grid' = 'list';
  searchQuery: string = '';
  isLoading: boolean = true;
  subscribeEmail: string = '';
  isSubscribing: boolean = false;

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

  /**
   * Load blog posts from Redis
   */
  private loadBlogPosts(): void {
    this.redisService.getBlogPosts().subscribe({
      next: (posts: ContentGroup[]) => {
        this.blogPosts = posts;
        this.filteredPosts = posts;
        this.sortPostsByDate();
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
   * Sort posts by publish date (newest first)
   */
  private sortPostsByDate(): void {
    this.filteredPosts.sort((a, b) => {
      const aMetadata = a.metadata as BlogPostMetadata | undefined;
      const bMetadata = b.metadata as BlogPostMetadata | undefined;
      const aDate = aMetadata?.publishDate ? new Date(aMetadata.publishDate).getTime() : 0;
      const bDate = bMetadata?.publishDate ? new Date(bMetadata.publishDate).getTime() : 0;
      return bDate - aDate;
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
      this.filteredPosts = this.blogPosts;
      return;
    }

    const query = this.searchQuery.toLowerCase();
    this.filteredPosts = this.blogPosts.filter(post => {
      const metadata = post.metadata as BlogPostMetadata | undefined;
      const title = metadata?.title?.toLowerCase() || '';
      const summary = metadata?.summary?.toLowerCase() || '';
      const text = post.items.find(item => item.Text)?.Text?.toLowerCase() || '';
      const tags = metadata?.tags?.join(' ').toLowerCase() || '';
      
      return title.includes(query) || 
             summary.includes(query) || 
             text.includes(query) || 
             tags.includes(query);
    });
  }

  /**
   * Get blog post data with reading time
   */
  getPostData(post: ContentGroup): any {
    const textItem = post.items.find(item => item.Text);
    const imageItem = post.items.find(item => item.Photo);
    const metadata = post.metadata as BlogPostMetadata | undefined;
    const content = textItem?.Text || '';

    return {
      title: metadata?.title || 'Untitled',
      summary: metadata?.summary || content.substring(0, 150) || '',
      content: content,
      image: imageItem?.Photo,
      publishDate: metadata?.publishDate ? new Date(metadata.publishDate) : null,
      tags: metadata?.tags || [],
      status: metadata?.status || 'published',
      category: metadata?.category || 'General',
      readTime: this.resolveReadTimeMinutes(metadata, content)
    };
  }

  /**
   * TrackBy function for ngFor performance
   */
  trackByPost(index: number, post: ContentGroup): string {
    return post.listItemID || index.toString();
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
