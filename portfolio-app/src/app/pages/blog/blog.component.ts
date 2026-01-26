import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RedisService } from '../../services/redis.service';
import { MailchimpService } from '../../services/mailchimp.service';
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
  subscriptionForm: FormGroup;
  isSubmitting: boolean = false;

  constructor(
    private redisService: RedisService,
    private mailchimpService: MailchimpService,
    private messageService: MessageService,
    private fb: FormBuilder
  ) {
    this.subscriptionForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      firstName: [''],
      lastName: ['']
    });
  }

  ngOnInit(): void {
    this.loadBlogPosts();
    this.mailchimpService.loadMailchimpScript();
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
   * Sort posts by publish date
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
   * Get blog post data
   */
  getPostData(post: ContentGroup): any {
    const textItem = post.items.find(item => item.Text);
    const imageItem = post.items.find(item => item.Photo);
    const metadata = post.metadata as BlogPostMetadata | undefined;
    
    return {
      title: metadata?.title || 'Untitled',
      summary: metadata?.summary || textItem?.Text?.substring(0, 150) || '',
      content: textItem?.Text || '',
      image: imageItem?.Photo,
      publishDate: metadata?.publishDate ? new Date(metadata.publishDate) : null,
      tags: metadata?.tags || [],
      status: metadata?.status || 'published'
    };
  }

  /**
   * Toggle layout view
   */
  toggleLayout(): void {
    this.layout = this.layout === 'list' ? 'grid' : 'list';
  }

  /**
   * Subscribe to newsletter
   */
  subscribe(): void {
    if (this.subscriptionForm.valid && !this.isSubmitting) {
      this.isSubmitting = true;
      const formValue = this.subscriptionForm.value;
      
      this.mailchimpService.subscribe(
        formValue.email,
        formValue.firstName,
        formValue.lastName
      ).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Successfully subscribed to newsletter!'
          });
          this.subscriptionForm.reset();
          this.isSubmitting = false;
        },
        error: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to subscribe. Please try again.'
          });
          this.isSubmitting = false;
        }
      });
    }
  }

  /**
   * Expand/collapse blog post
   */
  togglePost(post: ContentGroup): void {
    // Implementation for expand/collapse functionality
  }
}
