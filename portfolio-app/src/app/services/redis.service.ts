/**
 * Redis Service
 * Handles all Redis database operations including CRUD operations,
 * content filtering by PageID and PageContentID, and list aggregation
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { RedisContent, PageID, PageContentID, ContentGroup } from '../models/redis-content.model';

@Injectable({
  providedIn: 'root'
})
export class RedisService {
  private apiUrl: string = '';
  private headers: HttpHeaders;

  constructor(private http: HttpClient) {
    this.headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });
    // API URL will be set from environment configuration
    this.loadConfiguration();
  }

  /**
   * Load Redis endpoint configuration from environment
   */
  private loadConfiguration(): void {
    // Will be set from environment.ts in app initialization
  }

  /**
   * Set Redis API endpoint
   */
  setApiEndpoint(url: string): void {
    this.apiUrl = url;
  }

  /**
   * Get all content from Redis
   */
  getAllContent(): Observable<RedisContent[]> {
    return this.http.get<RedisContent[]>(`${this.apiUrl}/content`, { headers: this.headers })
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Get content by ID
   */
  getContentById(id: string): Observable<RedisContent> {
    return this.http.get<RedisContent>(`${this.apiUrl}/content/${id}`, { headers: this.headers })
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Get content filtered by PageID
   */
  getContentByPageID(pageID: PageID): Observable<RedisContent[]> {
    return this.http.get<RedisContent[]>(`${this.apiUrl}/content/page/${pageID}`, { headers: this.headers })
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Get content filtered by PageID and PageContentID
   */
  getContentByPageAndContentID(pageID: PageID, pageContentID: PageContentID): Observable<RedisContent[]> {
    return this.http.get<RedisContent[]>(
      `${this.apiUrl}/content/page/${pageID}/content/${pageContentID}`,
      { headers: this.headers }
    ).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Get content grouped by ListItemID for list rendering
   */
  getContentGroupedByListItemID(pageID: PageID): Observable<ContentGroup[]> {
    return this.getContentByPageID(pageID).pipe(
      map((content: RedisContent[]) => {
        const groupedMap = new Map<string, ContentGroup>();

        content.forEach((item: RedisContent) => {
          const listItemID = item.ListItemID || `default-${item.ID}`;
          
          if (!groupedMap.has(listItemID)) {
            groupedMap.set(listItemID, {
              listItemID: listItemID,
              items: [],
              metadata: item.Metadata as any
            });
          }

          groupedMap.get(listItemID)!.items.push(item);
        });

        return Array.from(groupedMap.values());
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Create new content in Redis
   */
  createContent(content: RedisContent): Observable<RedisContent> {
    return this.http.post<RedisContent>(`${this.apiUrl}/content`, content, { headers: this.headers })
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Update existing content in Redis
   */
  updateContent(id: string, content: Partial<RedisContent>): Observable<RedisContent> {
    return this.http.put<RedisContent>(`${this.apiUrl}/content/${id}`, content, { headers: this.headers })
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Delete content from Redis
   */
  deleteContent(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/content/${id}`, { headers: this.headers })
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Batch create content
   */
  batchCreateContent(contentArray: RedisContent[]): Observable<RedisContent[]> {
    return this.http.post<RedisContent[]>(`${this.apiUrl}/content/batch`, contentArray, { headers: this.headers })
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Get content for blog posts (PageID: 3, PageContentID: 3, 4, 5)
   */
  getBlogPosts(): Observable<ContentGroup[]> {
    return this.getContentGroupedByListItemID(PageID.Blog);
  }

  /**
   * Get landing page content (PageID: 0)
   */
  getLandingPageContent(): Observable<RedisContent[]> {
    return this.getContentByPageID(PageID.Landing);
  }

  /**
   * Get work page content (PageID: 1)
   */
  getWorkPageContent(): Observable<RedisContent[]> {
    return this.getContentByPageID(PageID.Work);
  }

  /**
   * Get projects page content (PageID: 2)
   */
  getProjectsPageContent(): Observable<RedisContent[]> {
    return this.getContentByPageID(PageID.Projects);
  }

  /**
   * Get header content (PageContentID: 0, 1)
   */
  getHeaderContent(): Observable<RedisContent[]> {
    return this.getAllContent().pipe(
      map((content: RedisContent[]) => 
        content.filter(item => 
          item.PageContentID === PageContentID.HeaderText || 
          item.PageContentID === PageContentID.HeaderIcon
        )
      )
    );
  }

  /**
   * Get footer content (PageContentID: 2)
   */
  getFooterContent(): Observable<RedisContent[]> {
    return this.getAllContent().pipe(
      map((content: RedisContent[]) => 
        content.filter(item => item.PageContentID === PageContentID.FooterIcon)
      )
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

    console.error('Redis Service Error:', errorMessage);
    return throwError(() => new Error(errorMessage));
  }
}
