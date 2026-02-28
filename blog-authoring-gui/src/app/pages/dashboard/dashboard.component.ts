import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ApiHealth, BlogApiService } from '../../services/blog-api.service';
import { TransactionLogService } from '../../services/transaction-log.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { RedisContent, ContentGroup, BlogPostMetadata, PageContentID, PageID } from '../../models/redis-content.model';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  standalone: false
})
export class DashboardComponent implements OnInit {
  blogPosts: ContentGroup[] = [];
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

  constructor(
    private authService: AuthService,
    private blogApi: BlogApiService,
    public txLog: TransactionLogService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private router: Router
  ) {}

  ngOnInit(): void {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }
    this.apiEndpoint = this.blogApi.getApiEndpoint();
    this.appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    this.testConnection();
    this.loadBlogPosts();
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

  /**
   * Edit existing blog post — with confirmation
   */
  editPost(post: ContentGroup): void {
    this.confirmationService.confirm({
      message: `Open "${this.getPostTitle(post)}" for editing?`,
      header: 'Edit Post',
      icon: 'pi pi-pencil',
      acceptLabel: 'Edit',
      rejectLabel: 'Cancel',
      accept: () => {
        const textItem = post.items.find(item => item.Text);
        const textRecord = post.items.find((item) => item.PageContentID === PageContentID.BlogText && !!item.Text) || textItem;
        const imageItem = post.items.find((item) => item.PageContentID === PageContentID.BlogImage && !!item.Photo) || post.items.find(item => item.Photo);
        const metadata = post.metadata as any;

        this.selectedPost = {
          listItemID: post.listItemID,
          title: metadata?.title || '',
          summary: metadata?.summary || textRecord?.Text?.substring(0, 150) || '',
          content: textRecord?.Text || '',
          image: imageItem?.Photo || null,
          tags: metadata?.tags || [],
          privateSeoTags: metadata?.privateSeoTags || [],
          readTimeMinutes: Number.isFinite(Number(metadata?.readTimeMinutes))
            ? Math.max(1, Math.round(Number(metadata?.readTimeMinutes)))
            : null,
          publishDate: metadata?.publishDate ? new Date(metadata.publishDate) : new Date(),
          status: metadata?.status || 'published',
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
      }
    });
  }

  /**
   * Delete blog post — with confirmation
   */
  deletePost(post: ContentGroup): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to permanently delete "${this.getPostTitle(post)}"? This action cannot be undone.`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.blogApi.deleteBlogPost(post.listItemID).subscribe({
          next: () => {
            this.txLog.log('DELETE', `Deleted blog post: ${this.getPostTitle(post)} (${post.listItemID})`);
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Blog post deleted successfully'
            });
            this.loadBlogPosts();
          },
          error: (error) => {
            this.txLog.log('DELETE_FAILED', `Failed to delete: ${this.getPostTitle(post)} — ${error.message}`);
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

  openPreview(post: ContentGroup, mode: 'card' | 'full' = 'card'): void {
    this.previewPost = post;
    this.previewMode = mode;
    this.showPreviewDialog = true;
  }

  setPreviewMode(mode: 'card' | 'full'): void {
    this.previewMode = mode;
  }

  closePreview(): void {
    this.showPreviewDialog = false;
    this.previewPost = null;
  }

  openPortfolioPreview(post: ContentGroup, target: 'list' | 'post' = 'post'): void {
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
    return metadata?.status || 'published';
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
    return this.blogPosts.filter((post) => this.getPostStatus(post) === status).length;
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
