import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BlogApiService } from '../../services/blog-api.service';
import { MessageService } from 'primeng/api';
import { RedisContent, ContentGroup, BlogPostMetadata } from '../../models/redis-content.model';

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
  isConnecting: boolean = false;

  constructor(
    private authService: AuthService,
    private blogApi: BlogApiService,
    private messageService: MessageService,
    private router: Router
  ) {}

  ngOnInit(): void {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }
    this.testConnection();
    this.loadBlogPosts();
  }

  /**
   * Test Redis connection
   */
  testConnection(): void {
    this.isConnecting = true;
    this.blogApi.testConnection().subscribe({
      next: (connected) => {
        this.isConnecting = false;
        if (connected) {
          this.messageService.add({
            severity: 'success',
            summary: 'Connected',
            detail: 'Successfully connected to Redis'
          });
        } else {
          this.messageService.add({
            severity: 'warn',
            summary: 'Connection Warning',
            detail: 'Could not verify Redis connection'
          });
        }
      },
      error: () => {
        this.isConnecting = false;
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
        // Group posts by ListItemID
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
        
        this.blogPosts = Array.from(groupedMap.values());
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

  /**
   * Edit existing blog post
   */
  editPost(post: ContentGroup): void {
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

  /**
   * Delete blog post
   */
  deletePost(post: ContentGroup): void {
    if (confirm('Are you sure you want to delete this blog post?')) {
      this.blogApi.deleteBlogPost(post.listItemID).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Blog post deleted successfully'
          });
          this.loadBlogPosts();
        },
        error: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to delete blog post'
          });
        }
      });
    }
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
   * Logout
   */
  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  /**
   * Get post title
   */
  getPostTitle(post: ContentGroup): string {
    const metadata = post.metadata as BlogPostMetadata;
    return metadata?.title || 'Untitled Post';
  }

  /**
   * Get post summary
   */
  getPostSummary(post: ContentGroup): string {
    const metadata = post.metadata as BlogPostMetadata;
    if (metadata?.summary) {
      return metadata.summary;
    }
    const textItem = post.items.find(item => item.Text);
    return textItem?.Text?.substring(0, 150) || 'No summary available';
  }

  /**
   * Get post status
   */
  getPostStatus(post: ContentGroup): string {
    const metadata = post.metadata as BlogPostMetadata;
    return metadata?.status || 'published';
  }

  /**
   * Get status severity for PrimeNG tag
   */
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

  /**
   * Get post tags
   */
  getPostTags(post: ContentGroup): string[] {
    const metadata = post.metadata as BlogPostMetadata;
    return metadata?.tags || [];
  }

  /**
   * Get post date
   */
  getPostDate(post: ContentGroup): Date {
    const metadata = post.metadata as BlogPostMetadata;
    if (metadata?.publishDate) {
      return new Date(metadata.publishDate);
    }
    const textItem = post.items.find(item => item.CreatedAt);
    return textItem?.CreatedAt ? new Date(textItem.CreatedAt) : new Date();
  }
}
