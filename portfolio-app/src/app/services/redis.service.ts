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
import { Observable, combineLatest, forkJoin, of, throwError, timer } from 'rxjs';
import { catchError, map, retry, shareReplay, switchMap, tap, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { RedisContent, PageID, PageContentID, ContentGroup } from '../models/redis-content.model';

type PreviewSessionPayload = {
  upserts?: Partial<RedisContent>[];
  deleteIds?: string[];
  deleteListItemIds?: string[];
  forceVisibleListItemIds?: string[];
};

export type ContentV2PageRequest = {
  limit?: number;
  nextToken?: string | null;
  contentIds?: number[];
  fields?: 'minimal' | 'standard' | 'full';
  sort?: 'updated_desc' | 'updated_asc' | 'id_asc';
  cacheScope?: string;
};

export type ContentV2PageResponse = {
  items: RedisContent[];
  nextToken: string | null;
  page: {
    pageId: number;
    limit: number;
    returned: number;
    hasMore: boolean;
    sort: 'updated_desc' | 'updated_asc' | 'id_asc';
  };
};

export type BlogCardV2 = {
  listItemID: string;
  title: string;
  summary: string;
  publishDate: string | null;
  status: 'draft' | 'scheduled' | 'published' | string;
  tags: string[];
  privateSeoTags: string[];
  readTimeMinutes: number;
  category: string;
};

export type BlogCardsV2Request = {
  limit?: number;
  nextToken?: string | null;
  status?: 'published' | 'draft' | 'scheduled' | 'all';
  includeFuture?: boolean;
  q?: string;
  category?: string;
  cacheScope?: string;
};

export type BlogCardsV2Response = {
  items: BlogCardV2[];
  nextToken: string | null;
  page: {
    limit: number;
    returned: number;
    hasMore: boolean;
  };
};

export type BlogCardMediaItem = {
  listItemID: string;
  imageUrl: string;
};

export type SiteChromeV3Response = {
  header: { items: RedisContent[] };
  footer: { items: RedisContent[] };
};

export type LandingV3Response = {
  summary: string;
  heroSlides: Array<{ photo: string; alt: string; order: number }>;
};

export type WorkV3Response = {
  metrics: RedisContent[];
  timeline: {
    items: RedisContent[];
    nextToken: string | null;
    hasMore: boolean;
  };
};

export type ProjectsCategoryV3 = {
  listItemID: string;
  name: string;
  description?: string;
  categoryPhoto?: string | null;
  order: number;
};

export type ProjectsCategoriesV3Response = {
  items: ProjectsCategoryV3[];
  nextToken: string | null;
  page: {
    limit: number;
    returned: number;
    hasMore: boolean;
  };
};

export type ProjectsItemsV3Response = {
  itemsByCategoryId: Record<string, RedisContent[]>;
};

export type BlogPostDetailV3Response = {
  listItemID: string;
  title: string;
  summary: string;
  coverImage: string;
  coverAlt: string;
  publishDate: string | null;
  status: string;
  tags: string[];
  privateSeoTags: string[];
  category: string;
  readTimeMinutes: number;
  signature: any | null;
  bodyBlocks: any[];
};

export type RouteCacheOptions = {
  cacheScope?: string;
};

@Injectable({
  providedIn: 'root'
})
export class RedisService {
  private readonly mediaCdnBaseUrl = 'https://d10d6kv3med0wp.cloudfront.net';
  private readonly managedMediaPrefixes = ['uploads/', 'photo-assets/'];
  private readonly readTimeoutMs = 8000;
  private readonly useContentV2Stream = !!environment.useContentV2Stream;
  private readonly useBlogV2Cards = !!environment.useBlogV2Cards;
  private readonly snapshotStorageKey = 'portfolio_content_snapshot_v1';
  private readonly pageSnapshotStorageKeyPrefix = 'portfolio_content_page_snapshot_v1_';
  private readonly routeCacheStorageKeyPrefix = 'portfolio_route_cache_v2_';
  private readonly snapshotMaxAgeMs = 30 * 60_000;
  private readonly pageCacheTtlMs = 5 * 60_000;
  private readonly allContentCacheTtlMs = 2 * 60_000;
  private readonly v2ReadCacheTtlMs = 60_000;
  private readonly mediaItemCacheTtlMs = 10 * 60_000;
  private apiUrl: string;
  private headers: HttpHeaders;

  // Cached observables for data that rarely changes
  private allContent$: Observable<RedisContent[]> | null = null;
  private allContentCachedAt = 0;
  private pageContentCache = new Map<number, { cachedAt: number; stream$: Observable<RedisContent[]> }>();
  private contentPageV2Cache = new Map<string, { cachedAt: number; stream$: Observable<ContentV2PageResponse> }>();
  private blogCardsV2Cache = new Map<string, { cachedAt: number; stream$: Observable<BlogCardsV2Response> }>();
  private blogMediaBatchCache = new Map<string, { cachedAt: number; stream$: Observable<BlogCardMediaItem[]> }>();
  private listItemsBatchV2Cache = new Map<string, { cachedAt: number; stream$: Observable<Record<string, RedisContent[]>> }>();
  private siteChromeV3$?: Observable<SiteChromeV3Response>;
  private siteChromeV3CachedAt = 0;
  private landingV3$?: Observable<LandingV3Response>;
  private landingV3CachedAt = 0;
  private workV3Cache = new Map<string, { cachedAt: number; stream$: Observable<WorkV3Response> }>();
  private projectsCategoriesV3Cache = new Map<string, { cachedAt: number; stream$: Observable<ProjectsCategoriesV3Response> }>();
  private projectItemsV3Cache = new Map<string, { cachedAt: number; stream$: Observable<Record<string, RedisContent[]>> }>();
  private blogDetailV3Cache = new Map<string, { cachedAt: number; stream$: Observable<BlogPostDetailV3Response> }>();
  private mediaItemsCache = new Map<string, { cachedAt: number; imageUrl: string }>();
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

  isContentV2StreamingEnabled(): boolean {
    return this.useContentV2Stream && !this.previewToken;
  }

  isBlogV2CardsEnabled(): boolean {
    return this.useBlogV2Cards && !this.previewToken;
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
    this.allContentCachedAt = 0;
    this.pageContentCache.clear();
    this.contentPageV2Cache.clear();
    this.blogCardsV2Cache.clear();
    this.blogMediaBatchCache.clear();
    this.listItemsBatchV2Cache.clear();
    this.siteChromeV3$ = undefined;
    this.siteChromeV3CachedAt = 0;
    this.landingV3$ = undefined;
    this.landingV3CachedAt = 0;
    this.workV3Cache.clear();
    this.projectsCategoriesV3Cache.clear();
    this.projectItemsV3Cache.clear();
    this.blogDetailV3Cache.clear();
    this.mediaItemsCache.clear();
    this.clearRouteCacheSnapshots();
  }

  /**
   * Get all content from Redis (with shareReplay cache)
   */
  getAllContent(): Observable<RedisContent[]> {
    const now = Date.now();
    const stale = !this.allContent$ || (now - this.allContentCachedAt) > this.allContentCacheTtlMs;

    if (stale) {
      this.allContentCachedAt = now;
      this.allContent$ = this.readRequest(
        this.http.get<RedisContent[]>(`${this.apiUrl}/content`, { headers: this.headers })
      )
        .pipe(
          tap((content) => this.persistContentSnapshot(content)),
          catchError((error) => {
            const fallback = this.readContentSnapshot();
            if (fallback) {
              console.warn('[RedisService] Falling back to cached content snapshot due to read error.');
              return of(fallback);
            }
            return this.handleError(error);
          }),
          shareReplay({ bufferSize: 1, refCount: false })
        );
    }

    const allContentStream = this.allContent$;
    if (!allContentStream) {
      return throwError(() => new Error('Content cache stream is not initialized.'));
    }

    if (!this.previewToken) {
      return allContentStream;
    }

    return combineLatest([allContentStream, this.getPreviewSession()]).pipe(
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
          return this.readRequest(
            this.http.get<RedisContent>(`${this.apiUrl}/content/${id}`, { headers: this.headers })
          );
        }),
        catchError(this.handleError)
      );
    }

    return this.readRequest(
      this.http.get<RedisContent>(`${this.apiUrl}/content/${id}`, { headers: this.headers })
    ).pipe(catchError(this.handleError));
  }

  /**
   * Get content filtered by PageID
   */
  getContentByPageID(pageID: PageID): Observable<RedisContent[]> {
    // Preview mode overlays unpublished draft edits across pages and therefore
    // must resolve from the full content set.
    if (this.previewToken) {
      return this.getAllContent().pipe(
        map((content: RedisContent[]) => content.filter((item) => item.PageID === pageID)),
        catchError(this.handleError)
      );
    }

    const cached = this.pageContentCache.get(pageID);
    const now = Date.now();
    if (cached && (now - cached.cachedAt) <= this.pageCacheTtlMs) {
      return cached.stream$;
    }

    const stream$ = this.readRequest(
      this.http.get<RedisContent[]>(
        `${this.apiUrl}/content/page/${pageID}`,
        { headers: this.headers }
      )
    ).pipe(
      tap((content) => this.persistPageSnapshot(pageID, content)),
      catchError((error) => {
        const pageFallback = this.readPageSnapshot(pageID);
        if (pageFallback) {
          console.warn(`[RedisService] Falling back to cached page snapshot for page ${pageID}.`);
          return of(pageFallback);
        }

        const fullFallback = this.readContentSnapshot();
        if (fullFallback) {
          console.warn('[RedisService] Falling back to full cached content snapshot for page read.');
          return of(fullFallback.filter((item) => item.PageID === pageID));
        }

        return this.handleError(error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.pageContentCache.set(pageID, { cachedAt: now, stream$ });
    return stream$;
  }

  /**
   * Get content filtered by PageID and PageContentID
   */
  getContentByPageAndContentID(pageID: PageID, pageContentID: PageContentID): Observable<RedisContent[]> {
    return this.getContentByPageID(pageID).pipe(
      map((content: RedisContent[]) =>
        content.filter((item) => item.PageContentID === pageContentID)
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

  getContentPageV2(pageID: PageID, request: ContentV2PageRequest = {}): Observable<ContentV2PageResponse> {
    if (!this.isContentV2StreamingEnabled()) {
      return this.getContentPageV2Legacy(pageID, request);
    }

    const now = Date.now();
    const cacheScope = this.normalizeCacheScope(request.cacheScope, `page-${pageID}`);
    const cacheKey = this.buildCacheKey('v2-page', cacheScope, {
      pageID,
      limit: request.limit,
      nextToken: request.nextToken || null,
      contentIds: request.contentIds || [],
      fields: request.fields || 'standard',
      sort: request.sort || 'updated_desc'
    });
    const cached = this.contentPageV2Cache.get(cacheKey);
    if (cached && (now - cached.cachedAt) <= this.v2ReadCacheTtlMs) {
      return cached.stream$;
    }

    const routeCached = this.readRouteCache<ContentV2PageResponse>(cacheKey, this.isContentPageV2Response);
    if (routeCached) {
      const stream$ = of(routeCached).pipe(shareReplay({ bufferSize: 1, refCount: false }));
      this.contentPageV2Cache.set(cacheKey, { cachedAt: now, stream$ });
      return stream$;
    }

    const params = new URLSearchParams();
    if (request.limit) params.set('limit', String(request.limit));
    if (request.nextToken) params.set('nextToken', request.nextToken);
    if (Array.isArray(request.contentIds) && request.contentIds.length > 0) {
      params.set('contentIds', request.contentIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)).join(','));
    }
    if (request.fields) params.set('fields', request.fields);
    if (request.sort) params.set('sort', request.sort);
    const query = params.toString();
    const url = `${this.apiUrl}/content/v2/page/${pageID}${query ? `?${query}` : ''}`;

    const stream$ = this.readRequest(
      this.http.get<ContentV2PageResponse>(url, { headers: this.headers })
    ).pipe(
      tap((response) => this.writeRouteCache(cacheKey, response)),
      catchError((error) => {
        console.warn('[RedisService] Falling back to legacy page read for v2/page:', error?.message || error);
        return this.getContentPageV2Legacy(pageID, request);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.contentPageV2Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  getBlogCardsV2(request: BlogCardsV2Request = {}): Observable<BlogCardsV2Response> {
    if (!this.isBlogV2CardsEnabled()) {
      return this.getBlogCardsV2Legacy(request);
    }

    const now = Date.now();
    const cacheScope = this.normalizeCacheScope(request.cacheScope, 'blog-cards');
    const cacheKey = this.buildCacheKey('v2-blog-cards', cacheScope, {
      limit: request.limit,
      nextToken: request.nextToken || null,
      status: request.status || 'published',
      includeFuture: request.includeFuture ?? false,
      q: request.q || '',
      category: request.category || ''
    });
    const cached = this.blogCardsV2Cache.get(cacheKey);
    if (cached && (now - cached.cachedAt) <= this.v2ReadCacheTtlMs) {
      return cached.stream$;
    }

    const routeCached = this.readRouteCache<BlogCardsV2Response>(cacheKey, this.isBlogCardsV2Response);
    if (routeCached) {
      const stream$ = of(routeCached).pipe(shareReplay({ bufferSize: 1, refCount: false }));
      this.blogCardsV2Cache.set(cacheKey, { cachedAt: now, stream$ });
      return stream$;
    }

    const params = new URLSearchParams();
    if (request.limit) params.set('limit', String(request.limit));
    if (request.nextToken) params.set('nextToken', request.nextToken);
    if (request.status) params.set('status', request.status);
    if (typeof request.includeFuture === 'boolean') {
      params.set('includeFuture', request.includeFuture ? 'true' : 'false');
    }
    if (request.q) params.set('q', request.q);
    if (request.category) params.set('category', request.category);

    const stream$ = this.readRequest(
      this.http.get<BlogCardsV2Response>(
        `${this.apiUrl}/content/v2/blog/cards?${params.toString()}`,
        { headers: this.headers }
      )
    ).pipe(
      tap((response) => this.writeRouteCache(cacheKey, response)),
      catchError((error) => {
        console.warn('[RedisService] Falling back to legacy blog cards for v2/blog/cards:', error?.message || error);
        return this.getBlogCardsV2Legacy(request);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.blogCardsV2Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  getBlogCardsMedia(listItemIDs: string[], options: RouteCacheOptions = {}): Observable<BlogCardMediaItem[]> {
    const ids = Array.from(
      new Set(
        (Array.isArray(listItemIDs) ? listItemIDs : [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );

    if (!ids.length) {
      return of([]);
    }

    if (!this.isBlogV2CardsEnabled()) {
      return this.getBlogCardsMediaLegacy(ids);
    }

    const cachedItems: BlogCardMediaItem[] = [];
    const missingIds: string[] = [];
    for (const id of ids) {
      const cached = this.mediaItemsCache.get(id);
      if (cached && (Date.now() - cached.cachedAt) <= this.mediaItemCacheTtlMs) {
        cachedItems.push({ listItemID: id, imageUrl: cached.imageUrl });
      } else {
        missingIds.push(id);
      }
    }
    if (!missingIds.length) {
      return of(cachedItems);
    }

    const cacheScope = this.normalizeCacheScope(options.cacheScope, 'blog-media');
    const chunks = this.chunkArray(missingIds, 50);
    const requests = chunks.map((chunk) => this.getBlogCardsMediaChunkV2(chunk, cacheScope));

    return forkJoin(requests).pipe(
      map((chunkRows) => this.mergeMediaRows(ids, cachedItems, chunkRows.reduce((acc, rows) => acc.concat(rows), [] as BlogCardMediaItem[])))
    );
  }

  getListItemsBatchV2(
    listItemIDs: string[],
    contentIds?: number[],
    options: RouteCacheOptions = {}
  ): Observable<Record<string, RedisContent[]>> {
    const ids = Array.from(
      new Set(
        (Array.isArray(listItemIDs) ? listItemIDs : [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );

    if (!ids.length) {
      return of({});
    }

    if (!this.isContentV2StreamingEnabled()) {
      return this.getListItemsBatchV2Legacy(ids, contentIds);
    }

    const cacheScope = this.normalizeCacheScope(options.cacheScope, 'list-items');
    const chunks = this.chunkArray(ids, 50);
    const requests = chunks.map((chunk) => this.getListItemsBatchChunkV2(chunk, contentIds, cacheScope));

    return forkJoin(requests).pipe(
      map((parts) => this.mergeListItemGroups(parts))
    );
  }

  private getBlogCardsMediaChunkV2(
    missingIds: string[],
    cacheScope: string
  ): Observable<BlogCardMediaItem[]> {
    if (!missingIds.length) return of([]);

    const now = Date.now();
    const cacheKey = this.buildCacheKey('v2-blog-media', cacheScope, { ids: missingIds });
    const cachedBatch = this.blogMediaBatchCache.get(cacheKey);
    if (cachedBatch && (now - cachedBatch.cachedAt) <= this.v2ReadCacheTtlMs) {
      return cachedBatch.stream$;
    }

    const routeCached = this.readRouteCache<BlogCardMediaItem[]>(cacheKey, this.isBlogCardMediaList);
    if (routeCached) {
      const stream$ = of(routeCached).pipe(shareReplay({ bufferSize: 1, refCount: false }));
      this.blogMediaBatchCache.set(cacheKey, { cachedAt: now, stream$ });
      return stream$;
    }

    const params = new URLSearchParams();
    params.set('listItemIDs', missingIds.join(','));
    const stream$ = this.readRequest(
      this.http.get<{ items: BlogCardMediaItem[] }>(
        `${this.apiUrl}/content/v2/blog/cards/media?${params.toString()}`,
        { headers: this.headers }
      )
    ).pipe(
      map((res) => Array.isArray(res?.items) ? res.items : []),
      tap((items) => {
        this.writeRouteCache(cacheKey, items);
        for (const item of items || []) {
          const id = String(item?.listItemID || '').trim();
          const imageUrl = String(item?.imageUrl || '').trim();
          if (!id || !imageUrl) continue;
          this.mediaItemsCache.set(id, { cachedAt: Date.now(), imageUrl });
        }
      }),
      catchError((error) => {
        console.warn('[RedisService] Falling back to legacy blog media for v2/blog/cards/media:', error?.message || error);
        return this.getBlogCardsMediaLegacy(missingIds);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.blogMediaBatchCache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  private getListItemsBatchChunkV2(
    ids: string[],
    contentIds: number[] | undefined,
    cacheScope: string
  ): Observable<Record<string, RedisContent[]>> {
    if (!ids.length) return of({});

    const now = Date.now();
    const safeContentIds = Array.isArray(contentIds) ? contentIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)) : [];
    const cacheKey = this.buildCacheKey('v2-list-items', cacheScope, {
      ids,
      contentIds: safeContentIds
    });
    const cached = this.listItemsBatchV2Cache.get(cacheKey);
    if (cached && (now - cached.cachedAt) <= this.v2ReadCacheTtlMs) {
      return cached.stream$;
    }

    const routeCached = this.readRouteCache<Record<string, RedisContent[]>>(cacheKey, this.isListItemsBatchResponse);
    if (routeCached) {
      const stream$ = of(routeCached).pipe(shareReplay({ bufferSize: 1, refCount: false }));
      this.listItemsBatchV2Cache.set(cacheKey, { cachedAt: now, stream$ });
      return stream$;
    }

    const body: { listItemIDs: string[]; contentIds?: number[] } = {
      listItemIDs: ids
    };
    if (safeContentIds.length > 0) {
      body.contentIds = safeContentIds.slice(0, 100);
    }

    const stream$ = this.readRequest(
      this.http.post<{ itemsByListItemID: Record<string, RedisContent[]> }>(
        `${this.apiUrl}/content/v2/list-items/batch`,
        body,
        { headers: this.headers }
      )
    ).pipe(
      map((res) => res?.itemsByListItemID || {}),
      tap((groups) => this.writeRouteCache(cacheKey, groups)),
      catchError((error) => {
        console.warn('[RedisService] Falling back to legacy list-item batch read for v2/list-items/batch:', error?.message || error);
        return this.getListItemsBatchV2Legacy(ids, safeContentIds);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.listItemsBatchV2Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  private getContentPageV2Legacy(pageID: PageID, request: ContentV2PageRequest = {}): Observable<ContentV2PageResponse> {
    return this.getContentByPageID(pageID).pipe(
      map((items) => {
        let safeItems = Array.isArray(items) ? [...items] : [];
        if (Array.isArray(request.contentIds) && request.contentIds.length > 0) {
          const allowed = new Set(request.contentIds.map((n) => Number(n)));
          safeItems = safeItems.filter((item) => allowed.has(Number(item.PageContentID)));
        }

        const sort = request.sort || 'updated_desc';
        if (sort === 'id_asc') {
          safeItems.sort((a, b) => String(a?.ID || '').localeCompare(String(b?.ID || '')));
        } else {
          safeItems.sort((a, b) => {
            const aTs = new Date(a?.UpdatedAt || a?.CreatedAt || 0).getTime() || 0;
            const bTs = new Date(b?.UpdatedAt || b?.CreatedAt || 0).getTime() || 0;
            if (aTs !== bTs) {
              return sort === 'updated_asc' ? aTs - bTs : bTs - aTs;
            }
            return String(a?.ID || '').localeCompare(String(b?.ID || ''));
          });
        }

        const fields = request.fields || 'standard';
        if (fields === 'minimal') {
          safeItems = safeItems.map((item) => ({
            ID: item.ID,
            PageID: item.PageID,
            PageContentID: item.PageContentID,
            ListItemID: item.ListItemID,
            CreatedAt: item.CreatedAt,
            UpdatedAt: item.UpdatedAt,
            Metadata: item.Metadata
          } as RedisContent));
        } else if (fields === 'standard') {
          safeItems = safeItems.map((item) => ({
            ID: item.ID,
            PageID: item.PageID,
            PageContentID: item.PageContentID,
            ListItemID: item.ListItemID,
            CreatedAt: item.CreatedAt,
            UpdatedAt: item.UpdatedAt,
            Metadata: item.Metadata,
            Text: item.Text
          } as RedisContent));
        }

        const safeLimit = Math.max(1, Math.min(100, Number(request.limit) || safeItems.length || 1));
        const sliced = safeItems.slice(0, safeLimit);
        return {
          items: sliced,
          nextToken: null,
          page: {
            pageId: Number(pageID),
            limit: safeLimit,
            returned: sliced.length,
            hasMore: false,
            sort: sort as 'updated_desc' | 'updated_asc' | 'id_asc'
          }
        } as ContentV2PageResponse;
      }),
      catchError(this.handleError)
    );
  }

  private getBlogCardsV2Legacy(request: BlogCardsV2Request = {}): Observable<BlogCardsV2Response> {
    return this.getBlogPosts().pipe(
      map((groups) => {
        let mapped: BlogCardV2[] = groups.map((g) => {
          const meta = (g.metadata || {}) as any;
          const text = g.items.find((i) => i.PageContentID === PageContentID.BlogText)?.Text || '';
          return {
            listItemID: g.listItemID,
            title: String(meta.title || 'Untitled'),
            summary: String(meta.summary || text.substring(0, 150) || ''),
            publishDate: meta.publishDate ? new Date(meta.publishDate).toISOString() : null,
            status: String(meta.status || 'published'),
            tags: Array.isArray(meta.tags) ? meta.tags : [],
            privateSeoTags: Array.isArray(meta.privateSeoTags) ? meta.privateSeoTags : [],
            readTimeMinutes: Number.isFinite(Number(meta.readTimeMinutes)) && Number(meta.readTimeMinutes) > 0
              ? Math.max(1, Math.round(Number(meta.readTimeMinutes)))
              : Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 200)),
            category: String(meta.category || 'General')
          };
        });

        const requestedStatus = request.status || 'published';
        const includeFuture = request.includeFuture ?? false;
        const query = String(request.q || '').trim().toLowerCase();
        const category = String(request.category || '').trim().toLowerCase();
        const now = Date.now();

        mapped = mapped.filter((post) => {
          if (requestedStatus !== 'all' && post.status !== requestedStatus) return false;
          const ts = post.publishDate ? new Date(post.publishDate).getTime() : 0;
          if (!includeFuture && ts > now) return false;
          if (category && String(post.category || '').toLowerCase() !== category) return false;
          if (query) {
            const blob = `${post.title} ${post.summary} ${(post.tags || []).join(' ')} ${(post.privateSeoTags || []).join(' ')} ${post.category}`.toLowerCase();
            if (!blob.includes(query)) return false;
          }
          return true;
        });

        mapped.sort((a, b) => {
          const aTs = a.publishDate ? new Date(a.publishDate).getTime() : 0;
          const bTs = b.publishDate ? new Date(b.publishDate).getTime() : 0;
          return bTs - aTs;
        });

        const safeLimit = Math.max(1, Math.min(50, Number(request.limit) || mapped.length || 1));
        mapped = mapped.slice(0, safeLimit);

        return {
          items: mapped,
          nextToken: null,
          page: {
            limit: safeLimit,
            returned: mapped.length,
            hasMore: false
          }
        } as BlogCardsV2Response;
      }),
      catchError(this.handleError)
    );
  }

  private getBlogCardsMediaLegacy(listItemIDs: string[]): Observable<BlogCardMediaItem[]> {
    return this.getBlogPosts().pipe(
      map((groups) => {
        const byListItem = new Map(groups.map((group) => [group.listItemID, group]));
        const out: BlogCardMediaItem[] = [];
        for (const id of listItemIDs) {
          const group = byListItem.get(id);
          if (!group) continue;
          const image = group.items.find((item) => Number(item.PageContentID) === Number(PageContentID.BlogImage) && !!item.Photo);
          if (!image?.Photo) continue;
          out.push({ listItemID: id, imageUrl: image.Photo });
        }
        return out;
      }),
      catchError(() => of([]))
    );
  }

  private getListItemsBatchV2Legacy(listItemIDs: string[], contentIds?: number[]): Observable<Record<string, RedisContent[]>> {
    return this.getAllContent().pipe(
      map((items) => {
        const grouped: Record<string, RedisContent[]> = {};
        const allowedContentIds = new Set((contentIds || []).map((id) => Number(id)));
        listItemIDs.forEach((id) => { grouped[id] = []; });

        for (const item of items || []) {
          const key = String(item?.ListItemID || '').trim();
          if (!key || !grouped[key]) continue;
          if (allowedContentIds.size > 0 && !allowedContentIds.has(Number(item.PageContentID))) continue;
          grouped[key].push(item);
        }
        return grouped;
      }),
      catchError(this.handleError)
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

    return this.readRequest(
      this.http.get<RedisContent[]>(
        `${this.apiUrl}/content/list-item/${listItemId}`,
        { headers: this.headers }
      )
    ).pipe(catchError(this.handleError));
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

  getSiteChromeV3(): Observable<SiteChromeV3Response> {
    const now = Date.now();
    const stale = !this.siteChromeV3$ || (now - this.siteChromeV3CachedAt) > this.v2ReadCacheTtlMs;
    if (stale) {
      this.siteChromeV3CachedAt = now;
      this.siteChromeV3$ = this.readRequest(
        this.http.get<SiteChromeV3Response>(`${this.apiUrl}/content/v3/bootstrap`, { headers: this.headers })
      ).pipe(
        map((payload) => this.normalizeSiteChromePayload(payload)),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.siteChromeV3$!;
  }

  getLandingPayloadV3(): Observable<LandingV3Response> {
    const now = Date.now();
    const stale = !this.landingV3$ || (now - this.landingV3CachedAt) > this.v2ReadCacheTtlMs;
    if (stale) {
      this.landingV3CachedAt = now;
      this.landingV3$ = this.readRequest(
        this.http.get<LandingV3Response>(`${this.apiUrl}/content/v3/landing`, { headers: this.headers })
      ).pipe(
        map((payload) => this.normalizeLandingPayload(payload)),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.landingV3$!;
  }

  getWorkPayloadV3(request: { limit?: number; nextToken?: string | null; cacheScope?: string } = {}): Observable<WorkV3Response> {
    const now = Date.now();
    const cacheScope = this.normalizeCacheScope(request.cacheScope, 'work');
    const cacheKey = this.buildCacheKey('v3-work', cacheScope, {
      limit: request.limit,
      nextToken: request.nextToken || null
    });
    const cached = this.workV3Cache.get(cacheKey);
    if (cached && (now - cached.cachedAt) <= this.v2ReadCacheTtlMs) {
      return cached.stream$;
    }

    const params = new URLSearchParams();
    if (request.limit) params.set('limit', String(request.limit));
    if (request.nextToken) params.set('nextToken', request.nextToken);

    const stream$ = this.readRequest(
      this.http.get<WorkV3Response>(`${this.apiUrl}/content/v3/work${params.toString() ? `?${params.toString()}` : ''}`, { headers: this.headers })
    ).pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.workV3Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  getProjectsCategoriesV3(request: { limit?: number; nextToken?: string | null; cacheScope?: string } = {}): Observable<ProjectsCategoriesV3Response> {
    const now = Date.now();
    const cacheScope = this.normalizeCacheScope(request.cacheScope, 'projects-categories');
    const cacheKey = this.buildCacheKey('v3-projects-categories', cacheScope, {
      limit: request.limit,
      nextToken: request.nextToken || null
    });
    const cached = this.projectsCategoriesV3Cache.get(cacheKey);
    if (cached && (now - cached.cachedAt) <= this.v2ReadCacheTtlMs) {
      return cached.stream$;
    }

    const params = new URLSearchParams();
    if (request.limit) params.set('limit', String(request.limit));
    if (request.nextToken) params.set('nextToken', request.nextToken);

    const stream$ = this.readRequest(
      this.http.get<ProjectsCategoriesV3Response>(
        `${this.apiUrl}/content/v3/projects/categories${params.toString() ? `?${params.toString()}` : ''}`,
        { headers: this.headers }
      )
    ).pipe(
      map((payload) => this.normalizeProjectsCategoriesPayload(payload)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.projectsCategoriesV3Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  getProjectItemsV3(categoryIds: string[], options: RouteCacheOptions = {}): Observable<Record<string, RedisContent[]>> {
    const ids = Array.from(new Set((categoryIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!ids.length) return of({});

    const now = Date.now();
    const cacheScope = this.normalizeCacheScope(options.cacheScope, 'projects-items');
    const cacheKey = this.buildCacheKey('v3-project-items', cacheScope, { ids });
    const cached = this.projectItemsV3Cache.get(cacheKey);
    if (cached && (now - cached.cachedAt) <= this.v2ReadCacheTtlMs) {
      return cached.stream$;
    }

    const stream$ = this.readRequest(
      this.http.post<ProjectsItemsV3Response>(
        `${this.apiUrl}/content/v3/projects/items`,
        { categoryIds: ids },
        { headers: this.headers }
      )
    ).pipe(
      map((response) => response?.itemsByCategoryId || {}),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.projectItemsV3Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  getBlogPostDetailV3(listItemId: string): Observable<BlogPostDetailV3Response> {
    const safeListItemId = String(listItemId || '').trim();
    if (!safeListItemId) {
      return throwError(() => new Error('Missing listItemID'));
    }

    const now = Date.now();
    const cacheKey = `blog-detail:${safeListItemId}`;
    const cached = this.blogDetailV3Cache.get(cacheKey);
    if (cached && (now - cached.cachedAt) <= this.v2ReadCacheTtlMs) {
      return cached.stream$;
    }

    const stream$ = this.readRequest(
      this.http.get<BlogPostDetailV3Response>(
        `${this.apiUrl}/content/v3/blog/${encodeURIComponent(safeListItemId)}`,
        { headers: this.headers }
      )
    ).pipe(
      map((payload) => this.normalizeBlogDetailPayload(payload)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.blogDetailV3Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  /**
   * Get header content
   */
  getHeaderContent(): Observable<RedisContent[]> {
    return this.getSiteChromeV3().pipe(
      map((payload) => Array.isArray(payload?.header?.items) ? payload.header.items : [])
    );
  }

  /**
   * Get footer content
   */
  getFooterContent(): Observable<RedisContent[]> {
    return this.getSiteChromeV3().pipe(
      map((payload) => Array.isArray(payload?.footer?.items) ? payload.footer.items : [])
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
      this.previewSession$ = this.readRequest(
        this.http.get<PreviewSessionPayload>(
          `${this.apiUrl}/content/preview/${encodeURIComponent(this.previewToken)}`,
          { headers: this.headers }
        )
      ).pipe(
        map((session) => {
          this.previewSessionSnapshot = session || null;
          return this.previewSessionSnapshot;
        }),
        catchError(() => {
          this.previewSessionSnapshot = null;
          return of(null);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
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

  private normalizeCacheScope(scope: string | undefined, fallback: string): string {
    const value = String(scope || '').trim();
    return value || fallback;
  }

  private buildCacheKey(prefix: string, scope: string, payload: unknown): string {
    return `${prefix}|${scope}|${this.stableStringify(payload)}`;
  }

  private stableStringify(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => `"${key}":${this.stableStringify(val)}`);
      return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private mergeMediaRows(
    requestIds: string[],
    cachedItems: BlogCardMediaItem[],
    fetchedRows: BlogCardMediaItem[]
  ): BlogCardMediaItem[] {
    const merged = [...cachedItems];
    const fromNetwork = new Map((fetchedRows || []).map((item) => [item.listItemID, item.imageUrl]));
    for (const id of requestIds) {
      const imageUrl = fromNetwork.get(id);
      if (!imageUrl) continue;
      merged.push({ listItemID: id, imageUrl });
    }
    const dedup = new Map<string, BlogCardMediaItem>();
    for (const row of merged) {
      if (!row?.listItemID || !row?.imageUrl) continue;
      dedup.set(row.listItemID, row);
    }
    return Array.from(dedup.values());
  }

  private mergeListItemGroups(
    parts: Array<Record<string, RedisContent[]>>
  ): Record<string, RedisContent[]> {
    const out: Record<string, RedisContent[]> = {};
    for (const part of parts || []) {
      for (const [key, rows] of Object.entries(part || {})) {
        if (!out[key]) out[key] = [];
        out[key].push(...(Array.isArray(rows) ? rows : []));
      }
    }
    return out;
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const safeSize = Math.max(1, Number(size) || 1);
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += safeSize) {
      chunks.push(items.slice(i, i + safeSize));
    }
    return chunks;
  }

  private readRequest<T>(request$: Observable<T>): Observable<T> {
    return request$.pipe(
      timeout({ first: this.readTimeoutMs }),
      retry({ count: 2, delay: (_err, retryCount) => timer(retryCount * 500) })
    );
  }

  private persistContentSnapshot(content: RedisContent[]): void {
    void content;
  }

  private readContentSnapshot(): RedisContent[] | null {
    return null;
  }

  private persistPageSnapshot(pageID: PageID, content: RedisContent[]): void {
    void pageID;
    void content;
  }

  private readPageSnapshot(pageID: PageID): RedisContent[] | null {
    void pageID;
    return null;
  }

  private writeRouteCache(cacheKey: string, data: unknown): void {
    void cacheKey;
    void data;
  }

  private readRouteCache<T>(cacheKey: string, validator: (value: unknown) => value is T): T | null {
    void cacheKey;
    void validator;
    return null;
  }

  private clearRouteCacheSnapshots(): void {
    return;
  }

  private isContentPageV2Response(value: unknown): value is ContentV2PageResponse {
    return !!value
      && typeof value === 'object'
      && Array.isArray((value as ContentV2PageResponse).items)
      && !!(value as ContentV2PageResponse).page;
  }

  private isBlogCardsV2Response(value: unknown): value is BlogCardsV2Response {
    return !!value
      && typeof value === 'object'
      && Array.isArray((value as BlogCardsV2Response).items)
      && !!(value as BlogCardsV2Response).page;
  }

  private isBlogCardMediaList(value: unknown): value is BlogCardMediaItem[] {
    return Array.isArray(value);
  }

  private isListItemsBatchResponse(value: unknown): value is Record<string, RedisContent[]> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private normalizeSiteChromePayload(payload: SiteChromeV3Response): SiteChromeV3Response {
    return {
      header: { items: this.normalizeContentItems(payload?.header?.items) },
      footer: { items: this.normalizeContentItems(payload?.footer?.items) }
    };
  }

  private normalizeLandingPayload(payload: LandingV3Response): LandingV3Response {
    return {
      ...payload,
      heroSlides: Array.isArray(payload?.heroSlides)
        ? payload.heroSlides.map((slide) => ({
            ...slide,
            photo: this.normalizeMediaUrl(slide?.photo)
          }))
        : []
    };
  }

  private normalizeProjectsCategoriesPayload(payload: ProjectsCategoriesV3Response): ProjectsCategoriesV3Response {
    return {
      ...payload,
      items: Array.isArray(payload?.items)
        ? payload.items.map((item) => ({
            ...item,
            categoryPhoto: this.normalizeMediaUrl(item?.categoryPhoto || '')
          }))
        : []
    };
  }

  private normalizeBlogDetailPayload(payload: BlogPostDetailV3Response): BlogPostDetailV3Response {
    return {
      ...payload,
      coverImage: this.normalizeMediaUrl(payload?.coverImage || '')
    };
  }

  private normalizeContentItems(items: RedisContent[] | undefined | null): RedisContent[] {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      ...item,
      Photo: this.normalizeMediaUrl(item?.Photo || '')
    }));
  }

  private normalizeMediaUrl(url: string | null | undefined): string {
    const value = String(url || '').trim();
    if (!value) return '';

    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.replace(/^\/+/, '');

      const maybeVirtualHostedS3 = host.includes('.s3.') || host.endsWith('.amazonaws.com');
      if (!maybeVirtualHostedS3) return value;

      const managedKey = this.extractManagedMediaKey(host, pathname);
      if (!managedKey) return value;

      return `${this.mediaCdnBaseUrl}/${managedKey}`;
    } catch {
      return value;
    }
  }

  private extractManagedMediaKey(hostname: string, pathname: string): string | null {
    const directKey = this.managedMediaPrefixes.find((prefix) => pathname.startsWith(prefix));
    if (directKey) return pathname;

    const pathStylePrefix = this.managedMediaPrefixes.find((prefix) => pathname.includes(`/${prefix}`));
    if (pathStylePrefix) {
      const index = pathname.indexOf(`/${pathStylePrefix}`);
      return pathname.slice(index + 1);
    }

    if (hostname.startsWith('grayson-wills-media-381492289909.') && pathname) {
      const managedPrefix = this.managedMediaPrefixes.find((prefix) => pathname.startsWith(prefix));
      if (managedPrefix) return pathname;
    }

    return null;
  }
}
