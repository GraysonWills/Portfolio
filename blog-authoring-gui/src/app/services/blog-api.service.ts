import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { RedisContent, PageID, PageContentID, BlogPostMetadata } from '../models/redis-content.model';

@Injectable({
  providedIn: 'root'
})
export class BlogApiService {
  private apiUrl: string = environment.redisApiUrl;
  private headers: HttpHeaders;

  constructor(private http: HttpClient) {
    this.headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });
  }

  /**
   * Set Redis API endpoint
   */
  setApiEndpoint(url: string): void {
    this.apiUrl = url;
  }

  /**
   * Get current Redis API endpoint
   */
  getApiEndpoint(): string {
    return this.apiUrl;
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
    listItemID?: string
  ): Observable<RedisContent[]> {
    const postItems: RedisContent[] = [];
    const itemId = listItemID || `blog-${Date.now()}`;
    const metadata: BlogPostMetadata = {
      title,
      summary,
      tags,
      publishDate: new Date(),
      status: 'published'
    };

    // Blog text content
    postItems.push({
      ID: `blog-text-${Date.now()}`,
      Text: content,
      PageID: PageID.Blog,
      PageContentID: PageContentID.BlogText,
      ListItemID: itemId,
      Metadata: metadata as any,
      CreatedAt: new Date()
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
    image?: string
  ): Observable<RedisContent[]> {
    // First, get existing post
    return this.getBlogPost(listItemID).pipe(
      // Then update it
      catchError(this.handleError)
    );
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
      catchError(this.handleError),
      // Map response to URL string
      catchError(() => {
        // If upload endpoint doesn't exist, convert to base64
        return this.convertToBase64(file);
      })
    ) as Observable<string>;
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
   * Test Redis connection
   */
  testConnection(): Observable<boolean> {
    return new Observable<boolean>(observer => {
      this.http.get<any>(`${this.apiUrl}/health`, { headers: this.headers }).subscribe({
        next: () => {
          observer.next(true);
          observer.complete();
        },
        error: () => {
          observer.next(false);
          observer.complete();
        }
      });
    });
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
}
