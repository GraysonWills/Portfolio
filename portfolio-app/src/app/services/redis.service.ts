/**
 * Redis Service
 * Handles all Redis database operations including CRUD operations,
 * content filtering by PageID and PageContentID, and list aggregation.
 *
 * Enhancements:
 *  - Retry logic with exponential backoff (retry 2x before failing)
 *  - shareReplay caching for read-heavy endpoints (header, footer)
 *  - Structured error logging
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Observable, combineLatest, of, throwError, timer } from 'rxjs';
import { catchError, map, retry, shareReplay, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { RedisContent, PageID, PageContentID, ContentGroup } from '../models/redis-content.model';

type PreviewSessionPayload = {
  upserts?: Partial<RedisContent>[];
  deleteIds?: string[];
  deleteListItemIds?: string[];
  forceVisibleListItemIds?: string[];
};

@Injectable({
  providedIn: 'root'
})
export class RedisService {
  private apiUrl: string;
  private headers: HttpHeaders;

  // Cached observables for data that rarely changes
  private allContent$: Observable<RedisContent[]> | null = null;
  private previewToken: string | null = null;
  private previewSession$: Observable<PreviewSessionPayload | null> | null = null;
  private previewSessionSnapshot: PreviewSessionPayload | null = null;

  constructor(private http: HttpClient) {
    this.apiUrl = environment.redisApiUrl || '';
    this.headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });
  }

  /**
   * Set Redis API endpoint (override from environment)
   */
  setApiEndpoint(url: string): void {
    this.apiUrl = url;
    this.invalidateCache();
  }

  setPreviewSessionToken(token: string | null): void {
    const normalized = (token || '').trim() || null;
    if (this.previewToken === normalized) return;
    this.previewToken = normalized;
    this.previewSession$ = null;
    this.previewSessionSnapshot = null;
    this.invalidateCache();
  }

  clearPreviewSessionToken(): void {
    this.setPreviewSessionToken(null);
  }

  isPreviewModeActive(): boolean {
    return !!this.previewToken;
  }

  isPreviewListItemForcedVisible(listItemId: string): boolean {
    const value = String(listItemId || '').trim();
    if (!value) return false;
    const forced = this.previewSessionSnapshot?.forceVisibleListItemIds || [];
    return forced.includes(value);
  }

  /**
   * Invalidate cached observables (call after writes)
   */
  invalidateCache(): void {
    this.allContent$ = null;
  }

  /**
   * Get all content from Redis (with shareReplay cache)
   */
  getAllContent(): Observable<RedisContent[]> {
    if (!this.allContent$) {
      this.allContent$ = this.http
        .get<RedisContent[]>(`${this.apiUrl}/content`, { headers: this.headers })
        .pipe(
          retry({ count: 2, delay: (err, retryCount) => timer(retryCount * 500) }),
          shareReplay({ bufferSize: 1, refCount: true, windowTime: 60_000 }),
          catchError(this.handleError)
        );
    }

    if (!this.previewToken) {
      return this.allContent$;
    }

    return combineLatest([this.allContent$, this.getPreviewSession()]).pipe(
      map(([content, session]) => this.applyPreviewOverlay(content, session))
    );
  }

  /**
   * Get content by ID
   */
  getContentById(id: string): Observable<RedisContent> {
    if (this.previewToken) {
      return this.getAllContent().pipe(
        map((items) => items.find((item) => item.ID === id) || null),
        switchMap((found) => {
          if (found) return of(found);
          return this.http.get<RedisContent>(`${this.apiUrl}/content/${id}`, { headers: this.headers }).pipe(
            retry({ count: 2, delay: (err, retryCount) => timer(retryCount * 500) })
          );
        }),
        catchError(this.handleError)
      );
    }

    return this.http.get<RedisContent>(`${this.apiUrl}/content/${id}`, { headers: this.headers })
      .pipe(
        retry({ count: 2, delay: (err, retryCount) => timer(retryCount * 500) }),
        catchError(this.handleError)
      );
  }

  /**
   * Get content filtered by PageID
   */
  getContentByPageID(pageID: PageID): Observable<RedisContent[]> {
    return this.getAllContent().pipe(
      map((content: RedisContent[]) => content.filter((item) => item.PageID === pageID)),
      catchError(this.handleError)
    );
  }

  /**
   * Get content filtered by PageID and PageContentID
   */
  getContentByPageAndContentID(pageID: PageID, pageContentID: PageContentID): Observable<RedisContent[]> {
    return this.getAllContent().pipe(
      map((content: RedisContent[]) =>
        content.filter((item) => item.PageID === pageID && item.PageContentID === pageContentID)
      ),
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
            });
          }

          groupedMap.get(listItemID)!.items.push(item);
        });

        const normalizeMetadata = (value: unknown): unknown => {
          if (!value) return undefined;
          if (typeof value === 'string') {
            try {
              return JSON.parse(value);
            } catch {
              return undefined;
            }
          }
          return value;
        };

        const groups = Array.from(groupedMap.values());

        // Group-level metadata is not guaranteed to be on the first item returned from the API.
        // For blog posts, it lives on the BlogItem entry (PageContentID.BlogItem).
        groups.forEach(group => {
          let metaCandidate: RedisContent | undefined;

          if (pageID === PageID.Blog) {
            metaCandidate = group.items.find(
              i => i.PageContentID === PageContentID.BlogItem && i.Metadata
            ) || group.items.find(i => i.Metadata);
          } else {
            metaCandidate = group.items.find(i => i.Metadata);
          }

          const normalized = normalizeMetadata(metaCandidate?.Metadata);
          if (normalized && typeof normalized === 'object') {
            group.metadata = normalized as any;
          }
        });

        return groups;
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
        map(result => { this.invalidateCache(); return result; }),
        catchError(this.handleError)
      );
  }

  /**
   * Update existing content in Redis
   */
  updateContent(id: string, content: Partial<RedisContent>): Observable<RedisContent> {
    return this.http.put<RedisContent>(`${this.apiUrl}/content/${id}`, content, { headers: this.headers })
      .pipe(
        map(result => { this.invalidateCache(); return result; }),
        catchError(this.handleError)
      );
  }

  /**
   * Delete content from Redis
   */
  deleteContent(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/content/${id}`, { headers: this.headers })
      .pipe(
        map(result => { this.invalidateCache(); return result; }),
        catchError(this.handleError)
      );
  }

  /**
   * Batch create content
   */
  batchCreateContent(contentArray: RedisContent[]): Observable<RedisContent[]> {
    return this.http.post<RedisContent[]>(`${this.apiUrl}/content/batch`, contentArray, { headers: this.headers })
      .pipe(
        map(result => { this.invalidateCache(); return result; }),
        catchError(this.handleError)
      );
  }

  /**
   * Get content for blog posts (PageID: 3)
   */
  getBlogPosts(): Observable<ContentGroup[]> {
    return this.getContentGroupedByListItemID(PageID.Blog).pipe(
      map((groups: ContentGroup[]) => {
        const now = Date.now();
        return groups.filter((g) => {
          const meta: any = g.metadata || {};
          const status = meta?.status || 'published';
          const publishDate = meta?.publishDate ? new Date(meta.publishDate).getTime() : null;
          const bypassVisibility = !!meta?.previewBypassVisibility || this.isPreviewListItemForcedVisible(g.listItemID);
          const hasContent = g.items.some((i) =>
            (i.PageContentID === PageContentID.BlogBody || i.PageContentID === PageContentID.BlogText) &&
            typeof i.Text === 'string' &&
            i.Text.trim().length > 0
          );

          if (!bypassVisibility && status !== 'published') return false;
          if (!bypassVisibility && publishDate && publishDate > now) return false;
          if (!hasContent) return false;
          return true;
        });
      })
    );
  }

  /**
   * Get a single blog post by ListItemID (all related content items)
   */
  getBlogPostByListItemId(listItemId: string): Observable<RedisContent[]> {
    if (this.previewToken) {
      return this.getAllContent().pipe(
        map((items) => items.filter((item) => item.ListItemID === listItemId)),
        catchError(this.handleError)
      );
    }

    return this.http.get<RedisContent[]>(
      `${this.apiUrl}/content/list-item/${listItemId}`,
      { headers: this.headers }
    ).pipe(
      retry({ count: 2, delay: (err, retryCount) => timer(retryCount * 500) }),
      catchError(this.handleError)
    );
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
   * Get header content (uses cached allContent for efficiency)
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
   * Get footer content (uses cached allContent for efficiency)
   */
  getFooterContent(): Observable<RedisContent[]> {
    return this.getAllContent().pipe(
      map((content: RedisContent[]) => 
        content.filter(item => item.PageContentID === PageContentID.FooterIcon)
      )
    );
  }

  /**
   * Structured error handling with retry awareness
   */
  private handleError(error: HttpErrorResponse): Observable<never> {
    let userMessage: string;

    if (error.status === 0) {
      userMessage = 'Unable to reach the server. Please check your connection.';
    } else if (error.status === 429) {
      userMessage = 'Too many requests. Please try again in a moment.';
    } else if (error.status >= 500) {
      userMessage = 'Server error. Please try again later.';
    } else {
      userMessage = error.error?.error || error.message || 'An unexpected error occurred.';
    }

    console.error(`[RedisService] ${error.status} ${error.url}: ${error.message}`);
    return throwError(() => new Error(userMessage));
  }

  private getPreviewSession(): Observable<PreviewSessionPayload | null> {
    if (!this.previewToken) return of(null);
    if (!this.previewSession$) {
      this.previewSession$ = this.http.get<PreviewSessionPayload>(
        `${this.apiUrl}/content/preview/${encodeURIComponent(this.previewToken)}`,
        { headers: this.headers }
      ).pipe(
        map((session) => {
          this.previewSessionSnapshot = session || null;
          return this.previewSessionSnapshot;
        }),
        catchError(() => {
          this.previewSessionSnapshot = null;
          return of(null);
        }),
        shareReplay({ bufferSize: 1, refCount: true, windowTime: 60_000 })
      );
    }
    return this.previewSession$;
  }

  private applyPreviewOverlay(content: RedisContent[], preview: PreviewSessionPayload | null): RedisContent[] {
    if (!preview) return content;

    const deleteIds = new Set((preview.deleteIds || []).map((value) => String(value || '').trim()).filter(Boolean));
    const deleteListItemIds = new Set((preview.deleteListItemIds || []).map((value) => String(value || '').trim()).filter(Boolean));
    const byId = new Map<string, RedisContent>();

    for (const item of content) {
      if (!item?.ID) continue;
      if (deleteIds.has(item.ID)) continue;
      if (item.ListItemID && deleteListItemIds.has(item.ListItemID)) continue;
      byId.set(item.ID, { ...item });
    }

    const upserts = Array.isArray(preview.upserts) ? preview.upserts : [];
    for (const patch of upserts) {
      if (!patch || typeof patch !== 'object') continue;
      const id = String(patch.ID || '').trim();
      if (!id) continue;

      const existing = byId.get(id);
      const merged: RedisContent = {
        ...(existing || {} as RedisContent),
        ...(patch as RedisContent),
        ID: id,
      };

      if (merged.ListItemID && deleteListItemIds.has(merged.ListItemID)) {
        byId.delete(id);
        continue;
      }

      byId.set(id, merged);
    }

    return Array.from(byId.values());
  }
}
