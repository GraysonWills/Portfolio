import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BlogApiService } from '../../services/blog-api.service';
import { TransactionLogService } from '../../services/transaction-log.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { RedisContent, ContentGroup, BlogPostMetadata, PageContentID } from '../../models/redis-content.model';

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
  showSettings: boolean = false;
  showTransactionLog: boolean = false;
  isConnecting: boolean = false;

  // Settings
  redisEndpoint: string = '';
  connectionStatus: 'connected' | 'disconnected' | 'testing' = 'disconnected';

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
    this.redisEndpoint = this.blogApi.getApiEndpoint();
    this.testConnection();
    this.loadBlogPosts();
  }

  /**
   * Test Redis connection
   */
  testConnection(): void {
    this.isConnecting = true;
    this.connectionStatus = 'testing';
    this.blogApi.testConnection().subscribe({
      next: (connected) => {
        this.isConnecting = false;
        if (connected) {
          this.connectionStatus = 'connected';
          this.messageService.add({
            severity: 'success',
            summary: 'Connected',
            detail: 'Successfully connected to Redis'
          });
        } else {
          this.connectionStatus = 'disconnected';
          this.messageService.add({
            severity: 'warn',
            summary: 'Connection Warning',
            detail: 'Could not verify Redis connection'
          });
        }
      },
      error: () => {
        this.isConnecting = false;
        this.connectionStatus = 'disconnected';
        this.messageService.add({
          severity: 'warn',
          summary: 'Connection Warning',
          detail: 'Redis connection endpoint may need configuration'
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
              items: [],
              metadata: post.Metadata as any
            });
          }

          groupedMap.get(listItemID)!.items.push(post);
        });

        this.blogPosts = Array.from(groupedMap.values()).sort(
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
        const imageItem = post.items.find(item => item.Photo);
        const metadata = post.metadata as any;

        this.selectedPost = {
          listItemID: post.listItemID,
          title: metadata?.title || '',
          summary: metadata?.summary || textItem?.Text?.substring(0, 150) || '',
          content: textItem?.Text || '',
          image: imageItem?.Photo || null,
          tags: metadata?.tags || [],
          publishDate: metadata?.publishDate ? new Date(metadata.publishDate) : new Date(),
          status: metadata?.status || 'published',
          category: metadata?.category || ''
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
    if (this.redisEndpoint.trim()) {
      this.blogApi.setApiEndpoint(this.redisEndpoint.trim());
      this.txLog.log('CONFIG', `Redis endpoint changed to: ${this.redisEndpoint.trim()}`);
      this.messageService.add({
        severity: 'info',
        summary: 'Endpoint Updated',
        detail: 'Redis API endpoint has been updated'
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
}
