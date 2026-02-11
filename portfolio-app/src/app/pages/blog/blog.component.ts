import { Component, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { ContentGroup, BlogPostMetadata } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';

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
    private messageService: MessageService
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
      readTime: this.estimateReadTime(content)
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
  }
}
