import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ApiHealth, BlogApiService, BlogCardV2 } from '../../services/blog-api.service';
import { TransactionLogService } from '../../services/transaction-log.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { RedisContent, ContentGroup, BlogPostMetadata, PageContentID, PageID } from '../../models/redis-content.model';
import { environment } from '../../../environments/environment';
import { HotkeysService } from '../../services/hotkeys.service';

interface DashboardPostView {
  source: ContentGroup | null;
  listItemID: string;
  title: string;
  summary: string;
  image: string | null;
  status: string;
  tags: string[];
  publishDate: Date;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  standalone: false
})
export class DashboardComponent implements OnInit, OnDestroy {
  blogPosts: ContentGroup[] = [];
  postViews: DashboardPostView[] = [];
  visiblePostViews: DashboardPostView[] = [];
  isEditing: boolean = false;
  selectedPost: any = null;
  showEditor: boolean = false;
  showPreviewDialog: boolean = false;
  previewMode: 'card' | 'full' = 'card';
  previewPost: ContentGroup | null = null;
  showSettings: boolean = false;
  showTransactionLog: boolean = false;
  isConnecting: boolean = false;

  // Settings
  apiEndpoint: string = '';
  connectionStatus: 'connected' | 'disconnected' | 'testing' = 'disconnected';
  apiHealth: ApiHealth | null = null;
  appOrigin: string = '';
  readonly isProd = environment.production;
  private cleanupHotkeys: (() => void) | null = null;
  private visiblePostCount = 0;
  private readonly postPageSize = 12;
  private readonly scrollLoadBufferPx = 500;
  private nextToken: string | null = null;
  private isFetchingNextPage = false;
  private hydratedImages = new Set<string>();
  private statusCounts: Record<string, number> = {
    draft: 0,
    scheduled: 0,
    published: 0
  };

  private getEffectiveStatus(rawStatus: unknown, publishDate: unknown): string {
    const normalized = String(rawStatus || 'published').trim().toLowerCase() || 'published';
    if (normalized !== 'published') {
      return normalized;
    }

    const publishTs = publishDate ? new Date(publishDate as any).getTime() : Number.NaN;
    if (Number.isFinite(publishTs) && publishTs > Date.now()) {
      return 'scheduled';
    }

    return 'published';
  }

  constructor(
    private authService: AuthService,
    private blogApi: BlogApiService,
    public txLog: TransactionLogService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private router: Router,
    private hotkeys: HotkeysService
  ) {}

  ngOnInit(): void {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }
    this.apiEndpoint = this.blogApi.getApiEndpoint();
    this.appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    this.connectionStatus = 'connected';
    this.loadBlogPosts();
    this.registerHotkeys();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.showEditor || !this.hasMorePosts) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const viewportBottom = window.scrollY + window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    if ((documentHeight - viewportBottom) <= this.scrollLoadBufferPx) {
      this.loadMorePosts();
    }
  }

  ngOnDestroy(): void {
    this.cleanupHotkeys?.();
    this.cleanupHotkeys = null;
  }

  /**
   * Test API connection (and surface backend store info).
   */
  testConnection(): void {
    this.isConnecting = true;
    this.connectionStatus = 'testing';
    this.blogApi.getHealth().subscribe({
      next: (health) => {
        this.isConnecting = false;
        this.apiHealth = health;

        const ok = health?.status !== 'unhealthy';
        this.connectionStatus = ok ? 'connected' : 'disconnected';

        if (ok && health.status === 'degraded') {
          this.messageService.add({
            severity: 'warn',
            summary: 'Connected (Degraded)',
            detail: `API reachable, but backend is degraded (${health.contentBackend || 'unknown'}).`
          });
          return;
        }

        if (ok) {
          this.messageService.add({
            severity: 'success',
            summary: 'Connected',
            detail: `Connected to API (${health.contentBackend || 'unknown'}).`
          });
          return;
        }

        this.messageService.add({
          severity: 'error',
          summary: 'Connection Failed',
          detail: 'API is reporting unhealthy.'
        });
      },
      error: () => {
        this.isConnecting = false;
        this.connectionStatus = 'disconnected';
        this.messageService.add({
          severity: 'warn',
          summary: 'Connection Warning',
          detail: 'API endpoint may need configuration'
        });
      }
    });
  }

  /**
   * Load all blog posts
   */
  loadBlogPosts(): void {
    this.nextToken = null;
    this.isFetchingNextPage = false;
    this.hydratedImages.clear();
    if (this.blogApi.isBlogV2CardsEnabled()) {
      this.loadBlogPostsV2();
      return;
    }

    this.blogApi.getAllBlogPosts().subscribe({
      next: (posts: RedisContent[]) => {
        const groupedMap = new Map<string, ContentGroup>();

        posts.forEach((post: RedisContent) => {
          const listItemID = post.ListItemID || `default-${post.ID}`;

          if (!groupedMap.has(listItemID)) {
            groupedMap.set(listItemID, {
              listItemID: listItemID,
              items: []
            });
          }

          groupedMap.get(listItemID)!.items.push(post);
        });

        const groups = Array.from(groupedMap.values());

        // Ensure metadata is pulled from the BlogItem record (required for portfolio display).
        groups.forEach((g) => {
          const metaItem = g.items.find((i) => i.PageContentID === PageContentID.BlogItem && !!i.Metadata)
            || g.items.find((i) => !!i.Metadata);
          g.metadata = (metaItem?.Metadata as any) || undefined;
        });

        const usable = groups.filter((g) =>
          g.items.some((i) => i.PageContentID === PageContentID.BlogText && !!i.Text && i.Text.trim().length > 0)
        );

        this.blogPosts = usable.sort(
          (a, b) => this.getPostDate(b).getTime() - this.getPostDate(a).getTime()
        );
        this.postViews = this.blogPosts.map((post) => this.toPostView(post));
        this.recalculateStatusCounts();
        this.resetVisiblePosts();
      },
      error: (error) => {
        console.error('Error loading blog posts:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load blog posts'
        });
      }
    });
  }

  private loadBlogPostsV2(nextToken?: string | null): void {
    this.isFetchingNextPage = true;
    this.blogApi.getAdminDashboardV3({
      limit: 20,
      nextToken: nextToken || null,
      cacheScope: 'route:/dashboard'
    }).subscribe({
      next: (response) => {
        this.isFetchingNextPage = false;
        this.nextToken = response?.nextToken || null;
        const incoming = (response?.items || []).map((card) => this.toPostViewFromCard(card));
        this.statusCounts = { ...(response?.counts || { draft: 0, scheduled: 0, published: 0 }) };

        if (!nextToken) {
          this.postViews = incoming;
        } else if (incoming.length) {
          const seen = new Set(this.postViews.map((item) => item.listItemID));
          for (const view of incoming) {
            if (seen.has(view.listItemID)) continue;
            seen.add(view.listItemID);
            this.postViews.push(view);
          }
        }

        this.postViews.sort((a, b) => b.publishDate.getTime() - a.publishDate.getTime());
        if (!response?.counts) {
          this.recalculateStatusCounts();
        }
        if (!nextToken) {
          this.resetVisiblePosts();
        } else {
          const retainCount = Math.max(this.visiblePostCount, this.visiblePostViews.length, this.postPageSize);
          this.visiblePostCount = retainCount;
          this.visiblePostViews = this.postViews.slice(0, this.visiblePostCount);
        }
        this.hydrateVisiblePostImages();
      },
      error: (error) => {
        this.isFetchingNextPage = false;
        console.error('Error loading v2 blog cards:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load blog posts'
        });
      }
    });
  }

  /**
   * Create new blog post
   */
  createNewPost(): void {
    this.selectedPost = null;
    this.isEditing = false;
    this.showEditor = true;
  }

  goToContentStudio(): void {
    this.router.navigate(['/content']);
  }

  goToSubscribers(): void {
    this.router.navigate(['/subscribers']);
  }

  goToCollections(): void {
    this.router.navigate(['/collections']);
  }

  /**
   * Edit existing blog post — with confirmation
   */
  editPost(view: DashboardPostView): void {
    this.confirmationService.confirm({
      message: `Open "${view.title}" for editing?`,
      header: 'Edit Post',
      icon: 'pi pi-pencil',
      acceptLabel: 'Edit',
      rejectLabel: 'Cancel',
      accept: () => {
        this.resolvePostGroup(view, (post) => {
        const textItem = post.items.find(item => item.Text);
        const textRecord = post.items.find((item) => item.PageContentID === PageContentID.BlogText && !!item.Text) || textItem;
        const imageItem = post.items.find((item) => item.PageContentID === PageContentID.BlogImage && !!item.Photo) || post.items.find(item => item.Photo);
        const metadata = post.metadata as any;

        this.selectedPost = {
          listItemID: post.listItemID,
          title: metadata?.title || '',
          summary: metadata?.summary || textRecord?.Text?.substring(0, 150) || '',
          content: this.getEditableContent(post),
          image: imageItem?.Photo || null,
          tags: metadata?.tags || [],
          privateSeoTags: metadata?.privateSeoTags || [],
          readTimeMinutes: Number.isFinite(Number(metadata?.readTimeMinutes))
            ? Math.max(1, Math.round(Number(metadata?.readTimeMinutes)))
            : null,
          publishDate: metadata?.publishDate ? new Date(metadata.publishDate) : new Date(),
          status: this.getEffectiveStatus(metadata?.status, metadata?.publishDate),
          category: metadata?.category || '',
          signatureId: metadata?.signatureId || metadata?.signatureSnapshot?.id || '',
          signatureSnapshot: metadata?.signatureSnapshot || null,
          scheduleName: metadata?.scheduleName || null,
          sendEmailUpdate: metadata?.notifyEmail ?? true,
          blogItemId: post.items.find((item) => item.PageContentID === PageContentID.BlogItem)?.ID || null,
          blogTextId: post.items.find((item) => item.PageContentID === PageContentID.BlogText)?.ID || null,
          blogBodyId: post.items.find((item) => item.PageContentID === PageContentID.BlogBody)?.ID || null,
          blogImageId: post.items.find((item) => item.PageContentID === PageContentID.BlogImage)?.ID || null
        };

        this.isEditing = true;
        this.showEditor = true;
        });
      }
    });
  }

  private getEditableContent(post: ContentGroup): string {
    const bodyRecord = post.items.find((item) => item.PageContentID === PageContentID.BlogBody && !!item.Text);
    const textRecord = post.items.find((item) => item.PageContentID === PageContentID.BlogText && !!item.Text)
      || post.items.find((item) => !!item.Text);

    const rawBody = String(bodyRecord?.Text || '').trim();
    if (!rawBody) {
      return String(textRecord?.Text || '');
    }

    try {
      const parsed = JSON.parse(rawBody);
      if (!Array.isArray(parsed)) return rawBody;

      return parsed.map((block: any) => {
        const type = String(block?.type || '').toLowerCase();
        if (type === 'heading') {
          const level = [2, 3, 4].includes(Number(block?.level)) ? Number(block.level) : 2;
          return `<h${level}>${String(block?.content || '')}</h${level}>`;
        }
        if (type === 'quote') {
          return `<blockquote>${String(block?.content || '')}</blockquote>`;
        }
        if (type === 'image') {
          const url = String(block?.url || '').trim();
          if (!url) return '';
          const alt = String(block?.alt || '').trim();
          return `<p class="post-media-row"><img class="post-inline-image" src="${url}" alt="${alt}"></p>`;
        }
        if (type === 'carousel') {
          const images = Array.isArray(block?.images) ? block.images : [];
          if (!images.length) return '';
          const inner = images.map((img: any) => {
            const url = String(img?.url || '').trim();
            if (!url) return '';
            const alt = String(img?.alt || '').trim();
            return `<img class="post-inline-image post-carousel-image" src="${url}" alt="${alt}">`;
          }).join('');
          return `<div class="post-carousel" data-post-carousel="true">${inner}</div>`;
        }
        return String(block?.content || '');
      }).join('\n');
    } catch {
      return rawBody;
    }
  }

  /**
   * Delete blog post — with confirmation
   */
  deletePost(view: DashboardPostView): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to permanently delete "${view.title}"? This action cannot be undone.`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.blogApi.deleteBlogPost(view.listItemID).subscribe({
          next: () => {
            this.txLog.log('DELETE', `Deleted blog post: ${view.title} (${view.listItemID})`);
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Blog post deleted successfully'
            });
            this.loadBlogPosts();
          },
          error: (error) => {
            this.txLog.log('DELETE_FAILED', `Failed to delete: ${view.title} — ${error.message}`);
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: 'Failed to delete blog post'
            });
          }
        });
      }
    });
  }

  /**
   * Handle editor save
   */
  onEditorSaved(): void {
    this.showEditor = false;
    this.loadBlogPosts();
  }

  /**
   * Handle editor cancel
   */
  onEditorCancelled(): void {
    this.showEditor = false;
    this.selectedPost = null;
    this.isEditing = false;
  }

  openPreview(view: DashboardPostView, mode: 'card' | 'full' = 'card'): void {
    this.resolvePostGroup(view, (post) => {
      this.previewPost = post;
      this.previewMode = mode;
      this.showPreviewDialog = true;
    });
  }

  setPreviewMode(mode: 'card' | 'full'): void {
    this.previewMode = mode;
  }

  closePreview(): void {
    this.showPreviewDialog = false;
    this.previewPost = null;
  }

  openPortfolioPreview(view: DashboardPostView, target: 'list' | 'post' = 'post'): void {
    this.resolvePostGroup(view, (post) => {
    const listItemID = (post.listItemID || '').trim();
    if (!listItemID) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Preview Unavailable',
        detail: 'This post is missing a ListItemID.'
      });
      return;
    }

    const blogItem = post.items.find((item) => item.PageContentID === PageContentID.BlogItem);
    const textItem = post.items.find((item) => item.PageContentID === PageContentID.BlogText);
    const bodyItem = post.items.find((item) => item.PageContentID === PageContentID.BlogBody);
    const imageItem = post.items.find((item) => item.PageContentID === PageContentID.BlogImage);
    const metadata = { ...((post.metadata as any) || {}), previewBypassVisibility: true };
    const nowIso = new Date().toISOString();

    const upserts: Partial<RedisContent>[] = [];

    upserts.push({
      ID: blogItem?.ID || `blog-item-${listItemID}`,
      PageID: PageID.Blog,
      PageContentID: PageContentID.BlogItem,
      ListItemID: listItemID,
      Text: metadata.title || this.getPostTitle(post),
      Metadata: metadata,
      UpdatedAt: nowIso as any
    });

    if (textItem?.Text || this.getPostSummary(post)) {
      upserts.push({
        ID: textItem?.ID || `blog-text-${listItemID}`,
        PageID: PageID.Blog,
        PageContentID: PageContentID.BlogText,
        ListItemID: listItemID,
        Text: textItem?.Text || this.getPostSummary(post),
        Metadata: metadata,
        UpdatedAt: nowIso as any
      });
    }

    const fallbackBody = textItem?.Text || this.getPostSummary(post);
    if (bodyItem?.Text || fallbackBody) {
      upserts.push({
        ID: bodyItem?.ID || `blog-body-${listItemID}`,
        PageID: PageID.Blog,
        PageContentID: PageContentID.BlogBody,
        ListItemID: listItemID,
        Text: bodyItem?.Text || JSON.stringify([{ type: 'paragraph', content: fallbackBody }]),
        Metadata: { previewBypassVisibility: true },
        UpdatedAt: nowIso as any
      });
    }

    if (imageItem?.Photo) {
      upserts.push({
        ID: imageItem.ID,
        PageID: PageID.Blog,
        PageContentID: PageContentID.BlogImage,
        ListItemID: listItemID,
        Photo: imageItem.Photo,
        Metadata: { ...(imageItem.Metadata || {}), previewBypassVisibility: true },
        UpdatedAt: nowIso as any
      });
    }

    const path = target === 'list' ? '/blog' : `/blog/${encodeURIComponent(listItemID)}`;
    this.blogApi.createPreviewSession({
      upserts,
      forceVisibleListItemIds: [listItemID],
      source: 'blog-dashboard'
    }).subscribe({
      next: (session) => {
        const url = this.blogApi.buildPortfolioPreviewUrl(session.token, path);
        window.open(url, '_blank', 'noopener,noreferrer');
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Preview Failed',
          detail: 'Could not create a cloud preview session.'
        });
      }
    });
    });
  }

  /**
   * Toggle settings panel
   */
  toggleSettings(): void {
    this.showSettings = !this.showSettings;
  }

  /**
   * Save Redis endpoint setting
   */
  saveEndpoint(): void {
    if (this.apiEndpoint.trim()) {
      this.blogApi.setApiEndpoint(this.apiEndpoint.trim());
      this.txLog.log('CONFIG', `API endpoint changed to: ${this.apiEndpoint.trim()}`);
      this.messageService.add({
        severity: 'info',
        summary: 'Endpoint Updated',
        detail: 'API endpoint has been updated'
      });
      this.testConnection();
    }
  }

  /**
   * Toggle transaction log panel
   */
  toggleTransactionLog(): void {
    this.showTransactionLog = !this.showTransactionLog;
  }

  /**
   * Clear transaction log
   */
  clearTransactionLog(): void {
    this.txLog.clear();
  }

  /**
   * Logout
   */
  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  private registerHotkeys(): void {
    this.cleanupHotkeys?.();
    this.cleanupHotkeys = this.hotkeys.register('dashboard', [
      {
        combo: 'mod+alt+n',
        description: 'Create new blog post',
        action: () => this.createNewPost(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+r',
        description: 'Refresh blog posts',
        action: () => this.loadBlogPosts(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+t',
        description: 'Toggle transaction log panel',
        action: () => this.toggleTransactionLog(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+s',
        description: 'Toggle dashboard settings',
        action: () => this.toggleSettings(),
        allowInInputs: true
      }
    ]);
  }

  private toPostView(post: ContentGroup): DashboardPostView {
    return {
      source: post,
      listItemID: post.listItemID,
      title: this.getPostTitle(post),
      summary: this.getPostSummary(post),
      image: this.getPostImage(post),
      status: this.getPostStatus(post),
      tags: this.getPostTags(post),
      publishDate: this.getPostDate(post)
    };
  }

  private toPostViewFromCard(card: BlogCardV2): DashboardPostView {
    return {
      source: null,
      listItemID: card.listItemID,
      title: card.title || 'Untitled Post',
      summary: card.summary || '',
      image: null,
      status: this.getEffectiveStatus(card.status, card.publishDate),
      tags: card.tags || [],
      publishDate: card.publishDate ? new Date(card.publishDate) : new Date()
    };
  }

  private recalculateStatusCounts(): void {
    const counts: Record<string, number> = { draft: 0, scheduled: 0, published: 0 };
    for (const post of this.postViews) {
      const key = String(post.status || '').toLowerCase();
      if (counts[key] === undefined) {
        counts[key] = 0;
      }
      counts[key] += 1;
    }
    this.statusCounts = counts;
  }

  get hasMorePosts(): boolean {
    if (this.blogApi.isBlogV2CardsEnabled()) {
      return this.visiblePostViews.length < this.postViews.length || !!this.nextToken;
    }
    return this.visiblePostViews.length < this.postViews.length;
  }

  loadMorePosts(): void {
    if (!this.hasMorePosts) return;
    if (this.visiblePostViews.length < this.postViews.length) {
      this.visiblePostCount += this.postPageSize;
      this.visiblePostViews = this.postViews.slice(0, this.visiblePostCount);
    }
    this.hydrateVisiblePostImages();
    if (this.blogApi.isBlogV2CardsEnabled()) {
      const nearingEnd = this.visiblePostViews.length >= (this.postViews.length - 2);
      if (nearingEnd) {
        this.fetchNextPageIfNeeded();
      }
    }
  }

  private resetVisiblePosts(): void {
    this.visiblePostCount = this.postPageSize;
    this.visiblePostViews = this.postViews.slice(0, this.visiblePostCount);
  }

  private fetchNextPageIfNeeded(): void {
    if (!this.nextToken || this.isFetchingNextPage) return;
    this.loadBlogPostsV2(this.nextToken);
  }

  private hydrateVisiblePostImages(): void {
    if (!this.blogApi.isBlogV2CardsEnabled()) return;
    const ids = this.visiblePostViews
      .map((post) => post.listItemID)
      .filter((id) => !!id && !this.hydratedImages.has(id));
    if (!ids.length) return;

    this.blogApi.getBlogCardsMedia(ids, {
      cacheScope: 'route:/dashboard:media'
    }).subscribe({
      next: (mediaRows) => {
        const map = new Map(mediaRows.map((row) => [row.listItemID, row.imageUrl]));
        this.postViews = this.postViews.map((post) => {
          const image = map.get(post.listItemID);
          if (!image) return post;
          this.hydratedImages.add(post.listItemID);
          return { ...post, image };
        });
        this.visiblePostViews = this.visiblePostViews.map((post) => {
          const image = map.get(post.listItemID);
          if (!image) return post;
          return { ...post, image };
        });
      },
      error: () => {}
    });
  }

  private resolvePostGroup(view: DashboardPostView, done: (group: ContentGroup) => void): void {
    if (view.source && view.source.items.length) {
      done(view.source);
      return;
    }

    this.blogApi.getBlogPost(view.listItemID).subscribe({
      next: (items) => {
        if (!Array.isArray(items) || items.length === 0) {
          this.messageService.add({
            severity: 'warn',
            summary: 'Post Not Found',
            detail: 'Unable to load full post details.'
          });
          return;
        }
        const group = this.groupBlogItems(view.listItemID, items);
        view.source = group;
        done(group);
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Load Failed',
          detail: 'Could not load post details.'
        });
      }
    });
  }

  private groupBlogItems(listItemID: string, items: RedisContent[]): ContentGroup {
    const groupItems = Array.isArray(items) ? items : [];
    const metadataItem = groupItems.find((item) => item.PageContentID === PageContentID.BlogItem && !!item.Metadata)
      || groupItems.find((item) => !!item.Metadata);
    return {
      listItemID,
      items: groupItems,
      metadata: (metadataItem?.Metadata as any) || undefined
    };
  }

  trackByPost(index: number, post: DashboardPostView): string {
    return post.listItemID || `${index}`;
  }

  trackByTag(index: number, tag: string): string {
    return `${tag}-${index}`;
  }

  // -- Display helpers --

  getPostTitle(post: ContentGroup): string {
    const metadata = post.metadata as BlogPostMetadata;
    return metadata?.title || 'Untitled Post';
  }

  getPostSummary(post: ContentGroup): string {
    const metadata = post.metadata as BlogPostMetadata;
    if (metadata?.summary) {
      return metadata.summary;
    }
    const textItem = post.items.find(item => item.Text);
    return textItem?.Text?.substring(0, 150) || 'No summary available';
  }

  getPostImage(post: ContentGroup): string | null {
    const imageItem = post.items.find(
      (item) => item.PageContentID === PageContentID.BlogImage && !!item.Photo
    ) || post.items.find((item) => !!item.Photo);
    return imageItem?.Photo || null;
  }

  getPostStatus(post: ContentGroup): string {
    const metadata = post.metadata as BlogPostMetadata;
    return this.getEffectiveStatus(metadata?.status, metadata?.publishDate);
  }

  getStatusSeverity(status: string): 'success' | 'info' | 'warning' | 'danger' {
    switch (status) {
      case 'published':
        return 'success';
      case 'scheduled':
        return 'info';
      case 'draft':
        return 'warning';
      default:
        return 'info';
    }
  }

  getPostTags(post: ContentGroup): string[] {
    const metadata = post.metadata as BlogPostMetadata;
    return metadata?.tags || [];
  }

  getPostDate(post: ContentGroup): Date {
    const metadata = post.metadata as BlogPostMetadata;
    if (metadata?.publishDate) {
      return new Date(metadata.publishDate);
    }
    const textItem = post.items.find(item => item.CreatedAt);
    return textItem?.CreatedAt ? new Date(textItem.CreatedAt) : new Date();
  }

  getConnectionStatusIcon(): string {
    switch (this.connectionStatus) {
      case 'connected': return 'pi pi-check-circle';
      case 'testing': return 'pi pi-spin pi-spinner';
      default: return 'pi pi-times-circle';
    }
  }

  getConnectionStatusClass(): string {
    switch (this.connectionStatus) {
      case 'connected': return 'status-connected';
      case 'testing': return 'status-testing';
      default: return 'status-disconnected';
    }
  }

  getPostCountByStatus(status: string): number {
    return this.statusCounts[String(status || '').toLowerCase()] || 0;
  }

  getPreviewContentHtml(post: ContentGroup | null): string {
    if (!post) return '<p>No post selected.</p>';
    const body = post.items.find((item) => item.PageContentID === PageContentID.BlogBody && item.Text)
      || post.items.find((item) => item.PageContentID === PageContentID.BlogText && item.Text);

    const raw = String(body?.Text || '').trim();
    if (!raw) return '<p>No content available.</p>';
    if (raw.includes('<')) return raw;
    return raw
      .split(/\n+/)
      .map((line) => `<p>${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
      .join('');
  }

  getPreviewReadTime(post: ContentGroup | null): number {
    if (!post) return 1;
    const raw = this.getPreviewContentHtml(post);
    const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const words = text ? text.split(/\s+/).length : 0;
    return Math.max(1, Math.ceil(words / 200));
  }
}
