import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { RedisContent, PageID, PageContentID, BlogPostMetadata } from '../models/redis-content.model';

export type ApiHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type ApiHealth = {
  status: ApiHealthStatus;
  version?: string;
  contentBackend?: string;
  redis?: { status?: string; latencyMs?: number; contentKeys?: number | null; error?: string };
  dynamodb?: { status?: string; latencyMs?: number; error?: string };
  timestamp?: string;
};

@Injectable({
  providedIn: 'root'
})
export class BlogApiService {
  private readonly ENDPOINT_STORAGE_KEY = 'portfolio_api_endpoint';
  private readonly LEGACY_ENDPOINT_STORAGE_KEYS = ['portfolio_redis_api_endpoint'];
  private readonly PROD_DEFAULT_API = 'https://api.grayson-wills.com/api';
  private apiUrl: string = environment.redisApiUrl;
  private headers: HttpHeaders;

  constructor(private http: HttpClient) {
    this.headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });

    const normalizedDefault = this.normalizeUrl(environment.redisApiUrl);
    this.apiUrl = normalizedDefault || this.normalizeUrl(this.PROD_DEFAULT_API);

    // In production builds, lock the API endpoint to the configured URL to avoid
    // accidentally pointing at stale endpoints from localStorage.
    if (environment.production) {
      try {
        localStorage.removeItem(this.ENDPOINT_STORAGE_KEY);
        for (const k of this.LEGACY_ENDPOINT_STORAGE_KEYS) localStorage.removeItem(k);
      } catch {
        // ignore
      }
      return;
    }

    // Persist endpoint across reloads so you can point at remote Redis API servers.
    try {
      const stored =
        localStorage.getItem(this.ENDPOINT_STORAGE_KEY)
        || this.LEGACY_ENDPOINT_STORAGE_KEYS.map((k) => localStorage.getItem(k)).find((v) => v && v.trim())
        || '';

      if (stored && stored.trim()) {
        const normalizedStored = this.normalizeUrl(stored);
        if (normalizedStored) {
          this.apiUrl = normalizedStored;
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * Set Redis API endpoint
   */
  setApiEndpoint(url: string): void {
    if (environment.production) return;
    this.apiUrl = this.normalizeUrl(url);
    try {
      localStorage.setItem(this.ENDPOINT_STORAGE_KEY, this.apiUrl);
      for (const k of this.LEGACY_ENDPOINT_STORAGE_KEYS) localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }

  /**
   * Get current Redis API endpoint
   */
  getApiEndpoint(): string {
    return this.apiUrl;
  }

  /**
   * ──────────────────────────────────────────────────────────────
   * Generic Content CRUD (Portfolio Content Studio)
   * ──────────────────────────────────────────────────────────────
   */

  getAllContent(): Observable<RedisContent[]> {
    return this.http.get<RedisContent[]>(
      `${this.apiUrl}/content`,
      { headers: this.headers }
    ).pipe(catchError(this.handleError));
  }

  getContentByPage(pageId: number): Observable<RedisContent[]> {
    return this.http.get<RedisContent[]>(
      `${this.apiUrl}/content/page/${pageId}`,
      { headers: this.headers }
    ).pipe(catchError(this.handleError));
  }

  getContentById(id: string): Observable<RedisContent> {
    return this.http.get<RedisContent>(
      `${this.apiUrl}/content/${id}`,
      { headers: this.headers }
    ).pipe(catchError(this.handleError));
  }

  createContent(content: Partial<RedisContent>): Observable<RedisContent> {
    return this.http.post<RedisContent>(
      `${this.apiUrl}/content`,
      content,
      { headers: this.headers }
    ).pipe(catchError(this.handleError));
  }

  updateContent(id: string, patch: Partial<RedisContent>): Observable<RedisContent> {
    return this.http.put<RedisContent>(
      `${this.apiUrl}/content/${id}`,
      patch,
      { headers: this.headers }
    ).pipe(catchError(this.handleError));
  }

  deleteContent(id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/content/${id}`,
      { headers: this.headers }
    ).pipe(catchError(this.handleError));
  }

  /**
   * Create a new blog post
   */
  createBlogPost(
    title: string,
    content: string,
    summary: string,
    tags: string[],
    image?: string,
    listItemID?: string,
    publishDate?: Date,
    status?: 'draft' | 'scheduled' | 'published',
    category?: string
  ): Observable<RedisContent[]> {
    const postItems: RedisContent[] = [];
    const itemId = listItemID || `blog-${Date.now()}`;
    const metadata: BlogPostMetadata = {
      title,
      summary,
      tags,
      publishDate: publishDate || new Date(),
      status: status || 'published',
      ...(category ? { category } : {})
    };

    // Blog metadata record (required by portfolio for title/tags/date)
    postItems.push({
      ID: `blog-item-${itemId}`,
      Text: title,
      PageID: PageID.Blog,
      PageContentID: PageContentID.BlogItem,
      ListItemID: itemId,
      Metadata: metadata as any
    } as any);

    // Blog text content
    postItems.push({
      ID: `blog-text-${Date.now()}`,
      Text: content,
      PageID: PageID.Blog,
      PageContentID: PageContentID.BlogText,
      ListItemID: itemId,
      Metadata: metadata as any
    });

    // Blog image content (if provided)
    if (image) {
      postItems.push({
        ID: `blog-image-${Date.now()}`,
        Photo: image,
        PageID: PageID.Blog,
        PageContentID: PageContentID.BlogImage,
        ListItemID: itemId,
        CreatedAt: new Date()
      });
    }

    return this.http.post<RedisContent[]>(`${this.apiUrl}/content/batch`, postItems, { headers: this.headers })
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Update existing blog post
   */
  updateBlogPost(
    listItemID: string,
    title: string,
    content: string,
    summary: string,
    tags: string[],
    image?: string,
    publishDate?: Date,
    status?: 'draft' | 'scheduled' | 'published',
    category?: string
  ): Observable<RedisContent[]> {
    const metadata: BlogPostMetadata = {
      title,
      summary,
      tags,
      publishDate: publishDate || new Date(),
      status: status || 'published',
      ...(category ? { category } : {})
    };

    return new Observable<RedisContent[]>((observer) => {
      this.getBlogPost(listItemID).subscribe({
        next: (items) => {
          const writes: Array<Observable<any>> = [];

          const blogText = items.find((item) => item.PageContentID === PageContentID.BlogText);
          const blogItem = items.find((item) => item.PageContentID === PageContentID.BlogItem);
          const blogImage = items.find((item) => item.PageContentID === PageContentID.BlogImage);

          // Update blog text (always)
          if (blogText?.ID) {
            writes.push(this.updateContent(blogText.ID, { Text: content, Metadata: metadata as any }));
          }

          // Update blog metadata record (if present)
          if (blogItem?.ID) {
            writes.push(this.updateContent(blogItem.ID, { Metadata: metadata as any }));
          } else {
            // Create the BlogItem record if missing (required for portfolio display)
            writes.push(this.createContent({
              ID: `blog-item-${listItemID}`,
              Text: title,
              PageID: PageID.Blog,
              PageContentID: PageContentID.BlogItem,
              ListItemID: listItemID,
              Metadata: metadata as any
            } as any));
          }

          // Update/remove/create image record
          if (image && image.trim()) {
            if (blogImage?.ID) {
              writes.push(this.updateContent(blogImage.ID, { Photo: image }));
            } else {
              writes.push(this.createContent({
                Photo: image,
                PageID: PageID.Blog,
                PageContentID: PageContentID.BlogImage,
                ListItemID: listItemID
              } as any));
            }
          } else if (blogImage?.ID) {
            writes.push(this.deleteContent(blogImage.ID));
          }

          if (writes.length === 0) {
            observer.next(items);
            observer.complete();
            return;
          }

          // Execute writes sequentially to keep behavior predictable
          let completed = 0;
          const results: any[] = [];
          writes.forEach((op) => {
            op.subscribe({
              next: (res) => { results.push(res); },
              error: (err) => {
                observer.error(err);
              },
              complete: () => {
                completed++;
                if (completed === writes.length) {
                  // Return refreshed post group
                  this.getBlogPost(listItemID).subscribe({
                    next: (refreshed) => {
                      observer.next(refreshed);
                      observer.complete();
                    },
                    error: (err) => observer.error(err)
                  });
                }
              }
            });
          });
        },
        error: (err) => observer.error(err)
      });
    }).pipe(catchError(this.handleError));
  }

  /**
   * Get blog post by ListItemID
   */
  getBlogPost(listItemID: string): Observable<RedisContent[]> {
    return this.http.get<RedisContent[]>(
      `${this.apiUrl}/content/list-item/${listItemID}`,
      { headers: this.headers }
    ).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Delete blog post
   */
  deleteBlogPost(listItemID: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/content/list-item/${listItemID}`,
      { headers: this.headers }
    ).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Trigger notification send now for a blog post (admin/auth required).
   */
  sendNotificationNow(listItemID: string, topic: string = 'blog_posts'): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/notifications/send-now`,
      { listItemID, topic },
      { headers: this.headers }
    ).pipe(catchError(this.handleError));
  }

  /**
   * Schedule publish + optional notification send (admin/auth required).
   */
  schedulePublish(listItemID: string, publishAt: Date, sendEmail: boolean, topic: string = 'blog_posts'): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/notifications/schedule`,
      { listItemID, publishAt, sendEmail, topic },
      { headers: this.headers }
    ).pipe(catchError(this.handleError));
  }

  cancelSchedule(scheduleName: string): Observable<any> {
    return this.http.delete<any>(
      `${this.apiUrl}/notifications/schedule/${encodeURIComponent(scheduleName)}`,
      { headers: this.headers }
    ).pipe(catchError(this.handleError));
  }

  /**
   * Get all blog posts
   */
  getAllBlogPosts(): Observable<RedisContent[]> {
    return this.http.get<RedisContent[]>(
      `${this.apiUrl}/content/page/${PageID.Blog}`,
      { headers: this.headers }
    ).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Upload image
   */
  uploadImage(file: File): Observable<string> {
    const formData = new FormData();
    formData.append('image', file);

    return this.http.post<{url: string}>(
      `${this.apiUrl}/upload/image`,
      formData
    ).pipe(
      map((res) => res.url),
      catchError((err) => {
        console.warn('Image upload failed; falling back to base64:', err);
        return this.convertToBase64(file);
      })
    );
  }

  /**
   * Convert file to base64
   */
  private convertToBase64(file: File): Observable<string> {
    return new Observable(observer => {
      const reader = new FileReader();
      reader.onload = () => {
        observer.next(reader.result as string);
        observer.complete();
      };
      reader.onerror = error => {
        observer.error(error);
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Get backend health info (includes content backend such as DynamoDB).
   */
  getHealth(): Observable<ApiHealth> {
    return this.http.get<ApiHealth>(`${this.apiUrl}/health`, { headers: this.headers }).pipe(
      catchError((error) => {
        // If the API returns JSON with a 503 status, keep the body so UIs can show "unhealthy" details.
        if (error?.error && typeof error.error === 'object') {
          return of(error.error as ApiHealth);
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * Basic connectivity check (UI uses getHealth() for details).
   */
  testConnection(): Observable<boolean> {
    return this.getHealth().pipe(
      map((h) => h?.status !== 'unhealthy'),
      catchError(() => of(false))
    );
  }

  /**
   * Error handling
   */
  private handleError(error: any): Observable<never> {
    let errorMessage = 'An unknown error occurred';
    
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error: ${error.error.message}`;
    } else {
      errorMessage = `Error Code: ${error.status}\nMessage: ${error.message}`;
    }

    console.error('Blog API Service Error:', errorMessage);
    return throwError(() => new Error(errorMessage));
  }

  private normalizeUrl(url: string): string {
    return (url || '').trim().replace(/\/+$/, '');
  }
}
