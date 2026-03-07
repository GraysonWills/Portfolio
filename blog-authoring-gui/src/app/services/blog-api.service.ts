import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, forkJoin, throwError, of, timer } from 'rxjs';
import { catchError, map, retry, shareReplay, switchMap, tap, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  RedisContent,
  PageID,
  PageContentID,
  BlogPostMetadata,
  BlogSignature,
  BlogSignatureSettings,
  CollectionsCategory,
  CollectionsCategoryRegistry,
  CollectionsEntryMetadata,
  CollectionsEntryType
} from '../models/redis-content.model';

export type ApiHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type ApiHealth = {
  status: ApiHealthStatus;
  version?: string;
  contentBackend?: string;
  redis?: { status?: string; latencyMs?: number; contentKeys?: number | null; error?: string };
  dynamodb?: { status?: string; latencyMs?: number; error?: string };
  timestamp?: string;
};

export type PreviewSessionPayload = {
  upserts: Partial<RedisContent>[];
  deleteIds?: string[];
  deleteListItemIds?: string[];
  forceVisibleListItemIds?: string[];
  source?: string;
};

export type PreviewSessionResponse = {
  token: string;
  expiresInSeconds: number;
};

export type NotificationSubscriber = {
  email: string;
  emailHash: string;
  status: string;
  topics: string[];
  source?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  confirmedAt?: string | null;
  unsubscribedAt?: string | null;
};

export type NotificationSubscribersResponse = {
  topic: string | null;
  count: number;
  subscribers: NotificationSubscriber[];
};

export type UpsertSubscriberRequest = {
  email: string;
  topics: string[];
  status?: 'PENDING' | 'SUBSCRIBED' | 'UNSUBSCRIBED';
};

export type CollectionsEntryDraft = {
  id?: string;
  listItemID?: string;
  title: string;
  summary?: string;
  body: string;
  entryType: CollectionsEntryType;
  categoryId: string;
  categoryName?: string;
  categorySlug?: string;
  tags?: string[];
  isPublic: boolean;
};

export type CollectionsEntryRecord = {
  item: RedisContent;
  metadata: CollectionsEntryMetadata;
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

export type AdminDashboardResponse = {
  items: BlogCardV2[];
  counts: Record<string, number>;
  nextToken: string | null;
  page: {
    limit: number;
    returned: number;
    hasMore: boolean;
  };
};

export type AdminContentResponse = {
  items: RedisContent[];
  nextToken: string | null;
  page: {
    pageId: number;
    contentId: number;
    limit: number;
    returned: number;
    hasMore: boolean;
  };
};

export type RouteCacheOptions = {
  cacheScope?: string;
};

type PhotoAssetUploadInitResponse = {
  assetId: string;
  uploadUrl: string;
  uploadMethod?: string;
  uploadHeaders?: Record<string, string>;
  expiresInSeconds?: number;
  publicUrl?: string;
  bucket?: string;
  key?: string;
  status?: string;
};

type PhotoAssetCompleteResponse = {
  ok?: boolean;
  asset?: {
    public_url?: string;
    publicUrl?: string;
  };
};

@Injectable({
  providedIn: 'root'
})
export class BlogApiService {
  private readonly ENDPOINT_STORAGE_KEY = 'portfolio_api_endpoint';
  private readonly LEGACY_ENDPOINT_STORAGE_KEYS = ['portfolio_redis_api_endpoint'];
  private readonly PROD_DEFAULT_API = 'https://api.grayson-wills.com/api';
  private readonly PROD_DEFAULT_PORTFOLIO_PREVIEW_URL = 'https://www.grayson-wills.com';
  private readonly SIGNATURE_SETTINGS_LIST_ITEM_ID = 'blog-signature-settings';
  private readonly SIGNATURE_SETTINGS_CONTENT_ID = 'blog-signature-settings-record';
  private readonly COLLECTIONS_REGISTRY_LIST_ITEM_ID = 'collections-category-registry';
  private readonly COLLECTIONS_REGISTRY_CONTENT_ID = 'collections-category-registry-record';
  private readonly readTimeoutMs = 8000;
  private readonly snapshotMaxAgeMs = 30 * 60_000;
  private readonly allContentCacheTtlMs = 2 * 60_000;
  private readonly pageContentCacheTtlMs = 5 * 60_000;
  private readonly listItemCacheTtlMs = 2 * 60_000;
  private readonly subscribersCacheTtlMs = 60_000;
  private readonly v2ReadCacheTtlMs = 60_000;
  private readonly mediaItemCacheTtlMs = 10 * 60_000;
  private readonly allContentSnapshotStorageKey = 'blog_authoring_content_snapshot_v1';
  private readonly pageSnapshotStorageKeyPrefix = 'blog_authoring_content_page_snapshot_v1_';
  private readonly listItemSnapshotStorageKeyPrefix = 'blog_authoring_content_list_item_snapshot_v1_';
  private readonly subscribersSnapshotStorageKeyPrefix = 'blog_authoring_subscribers_snapshot_v1_';
  private readonly routeCacheStorageKeyPrefix = 'blog_authoring_route_cache_v2_';
  private readonly useContentV2Stream = !!environment.useContentV2Stream;
  private readonly useBlogV2Cards = !!environment.useBlogV2Cards;
  private apiUrl: string = environment.redisApiUrl;
  private portfolioPreviewUrl: string = environment.portfolioPreviewUrl || this.PROD_DEFAULT_PORTFOLIO_PREVIEW_URL;
  private headers: HttpHeaders;
  private allContentCachedAt = 0;
  private allContent$: Observable<RedisContent[]> | null = null;
  private pageContentCache = new Map<number, { cachedAt: number; stream$: Observable<RedisContent[]> }>();
  private listItemCache = new Map<string, { cachedAt: number; stream$: Observable<RedisContent[]> }>();
  private subscribersCache = new Map<string, { cachedAt: number; stream$: Observable<NotificationSubscribersResponse> }>();
  private contentPageV2Cache = new Map<string, { cachedAt: number; stream$: Observable<ContentV2PageResponse> }>();
  private blogCardsV2Cache = new Map<string, { cachedAt: number; stream$: Observable<BlogCardsV2Response> }>();
  private blogMediaBatchCache = new Map<string, { cachedAt: number; stream$: Observable<BlogCardMediaItem[]> }>();
  private listItemsBatchV2Cache = new Map<string, { cachedAt: number; stream$: Observable<Record<string, RedisContent[]>> }>();
  private adminDashboardV3Cache = new Map<string, { cachedAt: number; stream$: Observable<AdminDashboardResponse> }>();
  private adminContentV3Cache = new Map<string, { cachedAt: number; stream$: Observable<AdminContentResponse> }>();
  private mediaItemsCache = new Map<string, { cachedAt: number; imageUrl: string }>();

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
    this.invalidateReadCaches();
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

  isContentV2StreamingEnabled(): boolean {
    return this.useContentV2Stream;
  }

  isBlogV2CardsEnabled(): boolean {
    return this.useBlogV2Cards;
  }

  getPortfolioPreviewUrl(): string {
    return this.portfolioPreviewUrl;
  }

  getDefaultSignatureSettings(): BlogSignatureSettings {
    const defaultSignature: BlogSignature = {
      id: 'sig-default',
      label: 'Default Signature',
      quote: 'Stay curious and keep building.',
      quoteAuthor: 'Grayson Wills',
      signOffName: 'Grayson Wills'
    };

    return {
      signatures: [defaultSignature],
      defaultSignatureId: defaultSignature.id
    };
  }

  getSignatureSettings(): Observable<BlogSignatureSettings> {
    return this.getContentByPage(PageID.Blog).pipe(
      map((items) => {
        const record = items.find((item) => item.PageContentID === PageContentID.BlogSignatureSettings);
        const raw = (record?.Metadata as any)?.signatureSettings ?? record?.Metadata ?? null;
        return this.normalizeSignatureSettings(raw);
      }),
      catchError(() => of(this.getDefaultSignatureSettings()))
    );
  }

  saveSignatureSettings(settings: BlogSignatureSettings): Observable<BlogSignatureSettings> {
    const normalized = this.normalizeSignatureSettings(settings);
    const metadata = {
      signatureSettings: normalized,
      updatedAt: new Date().toISOString()
    };

    return this.getContentByPage(PageID.Blog).pipe(
      map((items) => items.find((item) => item.PageContentID === PageContentID.BlogSignatureSettings) || null),
      switchMap((existing) => {
        const payload: Partial<RedisContent> = {
          Text: 'Blog signature settings',
          PageID: PageID.Blog,
          PageContentID: PageContentID.BlogSignatureSettings,
          ListItemID: this.SIGNATURE_SETTINGS_LIST_ITEM_ID,
          Metadata: metadata as any
        };

        if (existing?.ID) {
          return this.updateContent(existing.ID, payload);
        }

        return this.createContent({
          ID: this.SIGNATURE_SETTINGS_CONTENT_ID,
          ...payload
        } as RedisContent);
      }),
      map(() => normalized),
      catchError(this.handleError)
    );
  }

  getCollectionsRegistry(): Observable<CollectionsCategoryRegistry> {
    return this.getContentByPage(PageID.Collections).pipe(
      map((items) => {
        const registryRecord = items.find((item) => item.PageContentID === PageContentID.CollectionsCategoryRegistry);
        const raw = (registryRecord?.Metadata as any)?.registry ?? registryRecord?.Metadata ?? null;
        return this.normalizeCollectionsRegistry(raw);
      }),
      catchError(() => of(this.getDefaultCollectionsRegistry()))
    );
  }

  saveCollectionsRegistry(registry: CollectionsCategoryRegistry): Observable<CollectionsCategoryRegistry> {
    const normalized = this.normalizeCollectionsRegistry(registry);
    const metadata = {
      registry: normalized,
      updatedAt: new Date().toISOString()
    };

    return this.getContentByPage(PageID.Collections).pipe(
      map((items) => items.find((item) => item.PageContentID === PageContentID.CollectionsCategoryRegistry) || null),
      switchMap((existing) => {
        const payload: Partial<RedisContent> = {
          Text: 'Collections category registry',
          PageID: PageID.Collections,
          PageContentID: PageContentID.CollectionsCategoryRegistry,
          ListItemID: this.COLLECTIONS_REGISTRY_LIST_ITEM_ID,
          Metadata: metadata as any
        };

        if (existing?.ID) {
          return this.updateContent(existing.ID, payload);
        }

        return this.createContent({
          ID: this.COLLECTIONS_REGISTRY_CONTENT_ID,
          ...payload
        } as RedisContent);
      }),
      map(() => normalized),
      catchError(this.handleError)
    );
  }

  getCollectionsEntries(): Observable<CollectionsEntryRecord[]> {
    return this.getContentByPage(PageID.Collections).pipe(
      map((items) => {
        return (items || [])
          .filter((item) => Number(item.PageContentID) === Number(PageContentID.CollectionsEntry))
          .map((item) => ({
            item,
            metadata: this.normalizeCollectionsEntryMetadata(item.Metadata, item)
          }))
          .sort((a, b) => {
            const aTs = new Date(a.metadata.updatedAt || a.item.UpdatedAt || 0).getTime() || 0;
            const bTs = new Date(b.metadata.updatedAt || b.item.UpdatedAt || 0).getTime() || 0;
            return bTs - aTs;
          });
      }),
      catchError(this.handleError)
    );
  }

  upsertCollectionsEntry(entry: CollectionsEntryDraft): Observable<RedisContent> {
    const nowIso = new Date().toISOString();
    const normalizedTags = this.normalizeStringList(entry.tags || []);
    const metadata: CollectionsEntryMetadata = {
      title: String(entry.title || '').trim() || 'Untitled',
      summary: String(entry.summary || '').trim(),
      entryType: this.normalizeCollectionsEntryType(entry.entryType),
      categoryId: String(entry.categoryId || '').trim(),
      categorySlug: this.slugify(entry.categorySlug || entry.categoryId || ''),
      categoryName: String(entry.categoryName || '').trim() || undefined,
      tags: normalizedTags,
      isPublic: !!entry.isPublic,
      visibility: entry.isPublic ? 'public' : 'hidden',
      updatedAt: nowIso,
      ...(entry.isPublic ? { publishedAt: nowIso } : {})
    };

    const payload: Partial<RedisContent> = {
      Text: String(entry.body || ''),
      PageID: PageID.Collections,
      PageContentID: PageContentID.CollectionsEntry,
      ListItemID: String(entry.listItemID || '').trim() || `collections-${Date.now().toString(36)}`,
      Metadata: metadata as any
    };

    const id = String(entry.id || '').trim();
    if (id) {
      return this.getContentById(id).pipe(
        switchMap((existing) => {
          const existingMeta = this.normalizeCollectionsEntryMetadata(existing?.Metadata, existing);
          const mergedMetadata: CollectionsEntryMetadata = {
            ...existingMeta,
            ...metadata,
            createdAt: existingMeta.createdAt || existing?.CreatedAt?.toString() || nowIso
          };

          return this.updateContent(id, {
            ...payload,
            Metadata: mergedMetadata as any
          });
        }),
        catchError(() => this.updateContent(id, payload))
      );
    }

    const createdMetadata: CollectionsEntryMetadata = {
      ...metadata,
      createdAt: nowIso
    };

    return this.createContent({
      ID: `collections-entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ...payload,
      Metadata: createdMetadata as any
    } as RedisContent);
  }

  setCollectionsEntryVisibility(id: string, isPublic: boolean): Observable<RedisContent> {
    const safeId = String(id || '').trim();
    if (!safeId) {
      return throwError(() => new Error('Missing entry ID'));
    }

    return this.getContentById(safeId).pipe(
      switchMap((item) => {
        const nowIso = new Date().toISOString();
        const metadata = this.normalizeCollectionsEntryMetadata(item?.Metadata, item);
        const nextMetadata: CollectionsEntryMetadata = {
          ...metadata,
          isPublic,
          visibility: isPublic ? 'public' : 'hidden',
          updatedAt: nowIso,
          ...(isPublic ? { publishedAt: metadata.publishedAt || nowIso } : {})
        };
        return this.updateContent(safeId, { Metadata: nextMetadata as any });
      }),
      catchError(this.handleError)
    );
  }

  deleteCollectionsEntry(id: string): Observable<void> {
    return this.deleteContent(id);
  }

  /**
   * ──────────────────────────────────────────────────────────────
   * Generic Content CRUD (Portfolio Content Studio)
   * ──────────────────────────────────────────────────────────────
   */

  getAllContent(): Observable<RedisContent[]> {
    const now = Date.now();
    const stale = !this.allContent$ || (now - this.allContentCachedAt) > this.allContentCacheTtlMs;

    if (stale) {
      this.allContentCachedAt = now;
      this.allContent$ = this.readRequest(
        this.http.get<RedisContent[]>(
          `${this.apiUrl}/content`,
          { headers: this.headers }
        )
      ).pipe(
        tap((items) => {
          this.persistAllContentSnapshot(items);
          this.persistPageSnapshotsFromAll(items);
        }),
        catchError((error) => {
          const fallback = this.readAllContentSnapshot();
          if (fallback) {
            console.warn('[BlogApiService] Falling back to all-content snapshot.');
            return of(fallback);
          }
          return this.handleError(error);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }

    const stream = this.allContent$;
    if (!stream) {
      return throwError(() => new Error('All content cache stream is not initialized.'));
    }

    return stream;
  }

  getContentByPage(pageId: number): Observable<RedisContent[]> {
    const now = Date.now();
    const cached = this.pageContentCache.get(pageId);
    if (cached && (now - cached.cachedAt) <= this.pageContentCacheTtlMs) {
      return cached.stream$;
    }

    const stream$ = this.readRequest(
      this.http.get<RedisContent[]>(
        `${this.apiUrl}/content/page/${pageId}`,
        { headers: this.headers }
      )
    ).pipe(
      tap((items) => this.persistPageSnapshot(pageId, items)),
      catchError((error) => {
        const pageFallback = this.readPageSnapshot(pageId);
        if (pageFallback) {
          console.warn(`[BlogApiService] Falling back to page snapshot for page ${pageId}.`);
          return of(pageFallback);
        }

        const allFallback = this.readAllContentSnapshot();
        if (allFallback) {
          console.warn('[BlogApiService] Falling back to all-content snapshot for page read.');
          return of(allFallback.filter((item) => Number(item.PageID) === Number(pageId)));
        }

        return this.handleError(error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.pageContentCache.set(pageId, { cachedAt: now, stream$ });
    return stream$;
  }

  getContentPageV2(pageId: number, request: ContentV2PageRequest = {}): Observable<ContentV2PageResponse> {
    if (!this.useContentV2Stream) {
      return this.getContentPageV2Legacy(pageId, request);
    }

    const now = Date.now();
    const cacheScope = this.normalizeCacheScope(request.cacheScope, `page-${pageId}`);
    const cacheKey = this.buildCacheKey('v2-page', cacheScope, {
      pageId,
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
      params.set(
        'contentIds',
        request.contentIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)).join(',')
      );
    }
    if (request.fields) params.set('fields', request.fields);
    if (request.sort) params.set('sort', request.sort);
    const query = params.toString();

    const stream$ = this.readRequest(
      this.http.get<ContentV2PageResponse>(
        `${this.apiUrl}/content/v2/page/${pageId}${query ? `?${query}` : ''}`,
        { headers: this.headers }
      )
    ).pipe(
      tap((response) => this.writeRouteCache(cacheKey, response)),
      catchError((error) => {
        console.warn('[BlogApiService] Falling back to legacy page read for v2/page:', error?.message || error);
        return this.getContentPageV2Legacy(pageId, request);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.contentPageV2Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  getBlogCardsV2(request: BlogCardsV2Request = {}): Observable<BlogCardsV2Response> {
    if (!this.useBlogV2Cards) {
      return this.getBlogCardsV2Legacy(request);
    }

    const now = Date.now();
    const cacheScope = this.normalizeCacheScope(request.cacheScope, 'blog-cards');
    const cacheKey = this.buildCacheKey('v2-blog-cards', cacheScope, {
      limit: request.limit,
      nextToken: request.nextToken || null,
      status: request.status || 'all',
      includeFuture: request.includeFuture ?? true,
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
        console.warn('[BlogApiService] Falling back to legacy blog cards for v2/blog/cards:', error?.message || error);
        return this.getBlogCardsV2Legacy(request);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.blogCardsV2Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  getAdminDashboardV3(request: {
    limit?: number;
    nextToken?: string | null;
    q?: string;
    category?: string;
    cacheScope?: string;
  } = {}): Observable<AdminDashboardResponse> {
    const now = Date.now();
    const cacheScope = this.normalizeCacheScope(request.cacheScope, 'admin-dashboard');
    const cacheKey = this.buildCacheKey('v3-admin-dashboard', cacheScope, {
      limit: request.limit,
      nextToken: request.nextToken || null,
      q: request.q || '',
      category: request.category || ''
    });
    const cached = this.adminDashboardV3Cache.get(cacheKey);
    if (cached && (now - cached.cachedAt) <= this.v2ReadCacheTtlMs) {
      return cached.stream$;
    }

    const params = new URLSearchParams();
    if (request.limit) params.set('limit', String(request.limit));
    if (request.nextToken) params.set('nextToken', request.nextToken);
    if (request.q) params.set('q', request.q);
    if (request.category) params.set('category', request.category);

    const stream$ = this.readRequest(
      this.http.get<AdminDashboardResponse>(
        `${this.apiUrl}/content/v3/admin/dashboard${params.toString() ? `?${params.toString()}` : ''}`,
        { headers: this.headers }
      )
    ).pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.adminDashboardV3Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  getAdminContentV3(request: {
    pageId: number;
    contentId?: number;
    q?: string;
    limit?: number;
    nextToken?: string | null;
    cacheScope?: string;
  }): Observable<AdminContentResponse> {
    const now = Date.now();
    const safePageId = Number.isFinite(Number(request?.pageId)) ? Number(request.pageId) : -1;
    const safeContentId = Number.isFinite(Number(request?.contentId)) ? Number(request.contentId) : -1;
    const cacheScope = this.normalizeCacheScope(request.cacheScope, `admin-content:${safePageId}`);
    const cacheKey = this.buildCacheKey('v3-admin-content', cacheScope, {
      pageId: safePageId,
      contentId: safeContentId,
      q: request.q || '',
      limit: request.limit,
      nextToken: request.nextToken || null
    });
    const cached = this.adminContentV3Cache.get(cacheKey);
    if (cached && (now - cached.cachedAt) <= this.v2ReadCacheTtlMs) {
      return cached.stream$;
    }

    const params = new URLSearchParams();
    params.set('pageId', String(safePageId));
    params.set('contentId', String(safeContentId));
    if (request.q) params.set('q', request.q);
    if (request.limit) params.set('limit', String(request.limit));
    if (request.nextToken) params.set('nextToken', request.nextToken);

    const stream$ = this.readRequest(
      this.http.get<AdminContentResponse>(
        `${this.apiUrl}/content/v3/admin/content?${params.toString()}`,
        { headers: this.headers }
      )
    ).pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.adminContentV3Cache.set(cacheKey, { cachedAt: now, stream$ });
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

    if (!ids.length) return of([]);

    if (!this.useBlogV2Cards) {
      return this.getAllBlogPosts().pipe(
        map((items) => {
          const out: BlogCardMediaItem[] = [];
          for (const id of ids) {
            const image = (items || []).find((item) =>
              String(item?.ListItemID || '') === id && Number(item.PageContentID) === Number(PageContentID.BlogImage) && !!item.Photo
            );
            if (!image?.Photo) continue;
            out.push({ listItemID: id, imageUrl: image.Photo });
          }
          return out;
        }),
        catchError(() => of([]))
      );
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
    if (!ids.length) return of({});

    if (!this.useContentV2Stream) {
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
      tap((rows) => {
        this.writeRouteCache(cacheKey, rows);
        for (const row of rows || []) {
          const id = String(row?.listItemID || '').trim();
          const imageUrl = String(row?.imageUrl || '').trim();
          if (!id || !imageUrl) continue;
          this.mediaItemsCache.set(id, { cachedAt: Date.now(), imageUrl });
        }
      }),
      catchError((error) => {
        console.warn('[BlogApiService] Falling back to legacy blog media for v2/blog/cards/media:', error?.message || error);
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

    const body: { listItemIDs: string[]; contentIds?: number[] } = { listItemIDs: ids };
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
        console.warn('[BlogApiService] Falling back to legacy list-item batch read for v2/list-items/batch:', error?.message || error);
        return this.getListItemsBatchV2Legacy(ids, safeContentIds);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.listItemsBatchV2Cache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  private getContentPageV2Legacy(pageId: number, request: ContentV2PageRequest = {}): Observable<ContentV2PageResponse> {
    return this.getContentByPage(pageId).pipe(
      map((items) => {
        let rows = Array.isArray(items) ? [...items] : [];
        if (Array.isArray(request.contentIds) && request.contentIds.length > 0) {
          const allowed = new Set(request.contentIds.map((n) => Number(n)));
          rows = rows.filter((item) => allowed.has(Number(item.PageContentID)));
        }

        const sort = request.sort || 'updated_desc';
        if (sort === 'id_asc') {
          rows.sort((a, b) => String(a?.ID || '').localeCompare(String(b?.ID || '')));
        } else {
          rows.sort((a, b) => {
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
          rows = rows.map((item) => ({
            ID: item.ID,
            PageID: item.PageID,
            PageContentID: item.PageContentID,
            ListItemID: item.ListItemID,
            CreatedAt: item.CreatedAt,
            UpdatedAt: item.UpdatedAt,
            Metadata: item.Metadata
          } as RedisContent));
        } else if (fields === 'standard') {
          rows = rows.map((item) => ({
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

        const safeLimit = Math.max(1, Math.min(100, Number(request.limit) || rows.length || 1));
        const sliced = rows.slice(0, safeLimit);
        return {
          items: sliced,
          nextToken: null,
          page: {
            pageId: Number(pageId),
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
    return this.getAllBlogPosts().pipe(
      map((items) => {
        const groupedMap = new Map<string, RedisContent[]>();
        for (const item of items || []) {
          const key = String(item?.ListItemID || '').trim();
          if (!key) continue;
          if (!groupedMap.has(key)) groupedMap.set(key, []);
          groupedMap.get(key)!.push(item);
        }
        let cards: BlogCardV2[] = Array.from(groupedMap.entries()).map(([listItemID, rows]) => {
          const meta = (rows.find((row) => row.PageContentID === PageContentID.BlogItem)?.Metadata as any)
            || (rows.find((row) => !!row.Metadata)?.Metadata as any)
            || {};
          const text = rows.find((row) => row.PageContentID === PageContentID.BlogText)?.Text || '';
          return {
            listItemID,
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

        const status = request.status || 'all';
        const includeFuture = request.includeFuture ?? true;
        const query = String(request.q || '').trim().toLowerCase();
        const category = String(request.category || '').trim().toLowerCase();
        const now = Date.now();

        cards = cards.filter((card) => {
          if (status !== 'all' && card.status !== status) return false;
          const ts = card.publishDate ? new Date(card.publishDate).getTime() : 0;
          if (!includeFuture && ts > now) return false;
          if (category && String(card.category || '').toLowerCase() !== category) return false;
          if (query) {
            const blob = `${card.title} ${card.summary} ${(card.tags || []).join(' ')} ${(card.privateSeoTags || []).join(' ')} ${card.category}`.toLowerCase();
            if (!blob.includes(query)) return false;
          }
          return true;
        });

        cards.sort((a, b) => {
          const aTs = a.publishDate ? new Date(a.publishDate).getTime() : 0;
          const bTs = b.publishDate ? new Date(b.publishDate).getTime() : 0;
          return bTs - aTs;
        });

        const safeLimit = Math.max(1, Math.min(50, Number(request.limit) || cards.length || 1));
        cards = cards.slice(0, safeLimit);

        return {
          items: cards,
          nextToken: null,
          page: {
            limit: safeLimit,
            returned: cards.length,
            hasMore: false
          }
        } as BlogCardsV2Response;
      }),
      catchError(this.handleError)
    );
  }

  private getBlogCardsMediaLegacy(listItemIDs: string[]): Observable<BlogCardMediaItem[]> {
    return this.getAllBlogPosts().pipe(
      map((items) => {
        const out: BlogCardMediaItem[] = [];
        for (const id of listItemIDs) {
          const image = (items || []).find((item) =>
            String(item?.ListItemID || '') === id && Number(item.PageContentID) === Number(PageContentID.BlogImage) && !!item.Photo
          );
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
        const allowed = new Set((contentIds || []).map((id) => Number(id)));
        listItemIDs.forEach((id) => { grouped[id] = []; });
        for (const item of items || []) {
          const key = String(item?.ListItemID || '').trim();
          if (!key || !grouped[key]) continue;
          if (allowed.size > 0 && !allowed.has(Number(item.PageContentID))) continue;
          grouped[key].push(item);
        }
        return grouped;
      }),
      catchError(this.handleError)
    );
  }

  getContentById(id: string): Observable<RedisContent> {
    return this.readRequest(
      this.http.get<RedisContent>(
        `${this.apiUrl}/content/${id}`,
        { headers: this.headers }
      )
    ).pipe(
      catchError((error) => {
        const allFallback = this.readAllContentSnapshot();
        if (allFallback) {
          const found = allFallback.find((item) => String(item?.ID || '') === String(id || ''));
          if (found) {
            console.warn(`[BlogApiService] Falling back to all-content snapshot for content ID ${id}.`);
            return of(found);
          }
        }
        return this.handleError(error);
      })
    );
  }

  createContent(content: Partial<RedisContent>): Observable<RedisContent> {
    return this.http.post<RedisContent>(
      `${this.apiUrl}/content`,
      content,
      { headers: this.headers }
    ).pipe(
      tap(() => this.invalidateReadCaches()),
      catchError(this.handleError)
    );
  }

  updateContent(id: string, patch: Partial<RedisContent>): Observable<RedisContent> {
    return this.http.put<RedisContent>(
      `${this.apiUrl}/content/${id}`,
      patch,
      { headers: this.headers }
    ).pipe(
      tap(() => this.invalidateReadCaches()),
      catchError(this.handleError)
    );
  }

  deleteContent(id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/content/${id}`,
      { headers: this.headers }
    ).pipe(
      tap(() => this.invalidateReadCaches()),
      catchError(this.handleError)
    );
  }

  /**
   * Create a new blog post
   */
  createBlogPost(
    title: string,
    content: string,
    summary: string,
    tags: string[],
    privateSeoTags: string[] = [],
    image?: string,
    listItemID?: string,
    publishDate?: Date,
    status?: 'draft' | 'scheduled' | 'published',
    category?: string,
    readTimeMinutes?: number,
    signatureId?: string,
    signatureSnapshot?: BlogSignature
  ): Observable<RedisContent[]> {
    const postItems: RedisContent[] = [];
    const itemId = listItemID || `blog-${Date.now()}`;
    const metadata: BlogPostMetadata = {
      title,
      summary,
      tags,
      privateSeoTags,
      publishDate: publishDate || new Date(),
      status: status || 'published',
      ...(category ? { category } : {}),
      ...(readTimeMinutes && readTimeMinutes > 0 ? { readTimeMinutes: Math.round(readTimeMinutes) } : {}),
      ...(signatureId ? { signatureId } : {}),
      ...(signatureSnapshot ? { signatureSnapshot } : {})
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
        tap(() => this.invalidateReadCaches()),
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
    privateSeoTags: string[] = [],
    image?: string,
    publishDate?: Date,
    status?: 'draft' | 'scheduled' | 'published',
    category?: string,
    readTimeMinutes?: number,
    signatureId?: string,
    signatureSnapshot?: BlogSignature
  ): Observable<RedisContent[]> {
    const metadata: BlogPostMetadata = {
      title,
      summary,
      tags,
      privateSeoTags,
      publishDate: publishDate || new Date(),
      status: status || 'published',
      ...(category ? { category } : {}),
      ...(readTimeMinutes && readTimeMinutes > 0 ? { readTimeMinutes: Math.round(readTimeMinutes) } : {}),
      ...(signatureId ? { signatureId } : {}),
      ...(signatureSnapshot ? { signatureSnapshot } : {})
    };

    return this.getBlogPost(listItemID).pipe(
      switchMap((items) => {
        const blogText = items.find((item) => item.PageContentID === PageContentID.BlogText);
        const blogItem = items.find((item) => item.PageContentID === PageContentID.BlogItem);
        const blogImage = items.find((item) => item.PageContentID === PageContentID.BlogImage);

        const upserts: RedisContent[] = [
          {
            ...(blogText || {}),
            ID: blogText?.ID || `blog-text-${listItemID}`,
            Text: content,
            PageID: PageID.Blog,
            PageContentID: PageContentID.BlogText,
            ListItemID: listItemID,
            Metadata: metadata as any,
            ...(blogText?.CreatedAt ? { CreatedAt: blogText.CreatedAt } : {})
          } as RedisContent,
          {
            ...(blogItem || {}),
            ID: blogItem?.ID || `blog-item-${listItemID}`,
            Text: title,
            PageID: PageID.Blog,
            PageContentID: PageContentID.BlogItem,
            ListItemID: listItemID,
            Metadata: metadata as any,
            ...(blogItem?.CreatedAt ? { CreatedAt: blogItem.CreatedAt } : {})
          } as RedisContent
        ];

        if (image && image.trim()) {
          upserts.push({
            ...(blogImage || {}),
            ID: blogImage?.ID || `blog-image-${listItemID}`,
            Photo: image,
            PageID: PageID.Blog,
            PageContentID: PageContentID.BlogImage,
            ListItemID: listItemID,
            ...(blogImage?.CreatedAt ? { CreatedAt: blogImage.CreatedAt } : {})
          } as RedisContent);
        }

        const batch$ = this.http.post<RedisContent[]>(
          `${this.apiUrl}/content/batch`,
          upserts,
          { headers: this.headers }
        ).pipe(
          tap(() => this.invalidateReadCaches()),
          catchError(this.handleError)
        );

        if ((!image || !image.trim()) && blogImage?.ID) {
          return batch$.pipe(
            switchMap(() => this.deleteContent(blogImage.ID)),
            map(() => upserts)
          );
        }

        return batch$.pipe(map(() => upserts));
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Get blog post by ListItemID
   */
  getBlogPost(listItemID: string): Observable<RedisContent[]> {
    const safeListItemId = String(listItemID || '').trim();
    if (!safeListItemId) {
      return of([]);
    }

    const now = Date.now();
    const cached = this.listItemCache.get(safeListItemId);
    if (cached && (now - cached.cachedAt) <= this.listItemCacheTtlMs) {
      return cached.stream$;
    }

    const stream$ = this.readRequest(
      this.http.get<RedisContent[]>(
        `${this.apiUrl}/content/list-item/${encodeURIComponent(safeListItemId)}`,
        { headers: this.headers }
      )
    ).pipe(
      tap((items) => this.persistListItemSnapshot(safeListItemId, items)),
      catchError((error) => {
        const listFallback = this.readListItemSnapshot(safeListItemId);
        if (listFallback) {
          console.warn(`[BlogApiService] Falling back to list-item snapshot for ${safeListItemId}.`);
          return of(listFallback);
        }

        const allFallback = this.readAllContentSnapshot();
        if (allFallback) {
          console.warn('[BlogApiService] Falling back to all-content snapshot for list-item read.');
          return of(allFallback.filter((item) => String(item?.ListItemID || '') === safeListItemId));
        }

        return this.handleError(error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.listItemCache.set(safeListItemId, { cachedAt: now, stream$ });
    return stream$;
  }

  /**
   * Delete blog post
   */
  deleteBlogPost(listItemID: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/content/list-item/${listItemID}`,
      { headers: this.headers }
    ).pipe(
      tap(() => this.invalidateReadCaches()),
      catchError(this.handleError)
    );
  }

  /**
   * Trigger notification send now for a blog post (admin/auth required).
   */
  sendNotificationNow(listItemID: string, topic: string = 'blog_posts', force: boolean = false): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/notifications/send-now`,
      { listItemID, topic, force },
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

  unpublishPost(listItemID: string): Observable<any> {
    const safeListItemID = String(listItemID || '').trim();
    if (!safeListItemID) {
      return throwError(() => new Error('Missing listItemID'));
    }

    return this.http.post<any>(
      `${this.apiUrl}/notifications/unpublish`,
      { listItemID: safeListItemID },
      { headers: this.headers }
    ).pipe(
      tap(() => this.invalidateReadCaches()),
      catchError(this.handleError)
    );
  }

  getNotificationSubscribers(topic: string = 'blog_posts', includeUnsubscribed: boolean = false): Observable<NotificationSubscribersResponse> {
    const safeTopic = String(topic || 'blog_posts').trim().toLowerCase() || 'blog_posts';
    const cacheKey = `${safeTopic}:${includeUnsubscribed ? 'all' : 'active'}`;
    const now = Date.now();
    const cached = this.subscribersCache.get(cacheKey);
    if (cached && (now - cached.cachedAt) <= this.subscribersCacheTtlMs) {
      return cached.stream$;
    }

    const params = new URLSearchParams({
      topic: safeTopic,
      includeUnsubscribed: includeUnsubscribed ? 'true' : 'false'
    });
    const stream$ = this.readRequest(
      this.http.get<NotificationSubscribersResponse>(
        `${this.apiUrl}/notifications/subscribers?${params.toString()}`,
        { headers: this.headers }
      )
    ).pipe(
      tap((data) => this.persistSubscribersSnapshot(cacheKey, data)),
      catchError((error) => {
        const fallback = this.readSubscribersSnapshot(cacheKey);
        if (fallback) {
          console.warn(`[BlogApiService] Falling back to subscriber snapshot for ${cacheKey}.`);
          return of(fallback);
        }
        return this.handleError(error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.subscribersCache.set(cacheKey, { cachedAt: now, stream$ });
    return stream$;
  }

  upsertNotificationSubscriber(payload: UpsertSubscriberRequest): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/notifications/subscribers`,
      payload,
      { headers: this.headers }
    ).pipe(
      tap(() => this.subscribersCache.clear()),
      catchError(this.handleError)
    );
  }

  removeNotificationSubscriber(emailHash: string): Observable<any> {
    return this.http.delete<any>(
      `${this.apiUrl}/notifications/subscribers/${encodeURIComponent(emailHash)}`,
      { headers: this.headers }
    ).pipe(
      tap(() => this.subscribersCache.clear()),
      catchError(this.handleError)
    );
  }

  /**
   * Get all blog posts
   */
  getAllBlogPosts(): Observable<RedisContent[]> {
    return this.getContentByPage(PageID.Blog);
  }

  /**
   * Upload image
   */
  uploadImage(file: File): Observable<string> {
    const contentType = String(file.type || 'image/jpeg').trim().toLowerCase();
    const filename = String(file.name || 'image').trim();
    const sizeBytes = Number(file.size || 0);

    return this.http.post<PhotoAssetUploadInitResponse>(
      `${this.apiUrl}/photo-assets/upload-url`,
      {
        filename,
        contentType,
        sizeBytes,
        usage: 'blog',
        tags: ['blog']
      },
      { headers: this.headers }
    ).pipe(
      switchMap((init) => {
        if (!init?.assetId || !init?.uploadUrl) {
          throw new Error('Invalid photo asset upload response.');
        }

        const uploadHeaders = new HttpHeaders(init.uploadHeaders || { 'Content-Type': contentType });
        return this.http.put(
          init.uploadUrl,
          file,
          { headers: uploadHeaders, responseType: 'text' }
        ).pipe(
          switchMap(() => this.http.post<PhotoAssetCompleteResponse>(
            `${this.apiUrl}/photo-assets/${encodeURIComponent(init.assetId)}/complete`,
            {},
            { headers: this.headers }
          )),
          map((complete) => {
            const url = complete?.asset?.public_url || complete?.asset?.publicUrl || init.publicUrl || '';
            if (!url) throw new Error('Photo asset completion response did not return a URL.');
            return url;
          })
        );
      }),
      catchError((err) => {
        console.warn('Signed image upload failed; falling back to legacy upload endpoint:', err);
        return this.uploadImageLegacy(file);
      })
    );
  }

  private uploadImageLegacy(file: File): Observable<string> {
    const formData = new FormData();
    formData.append('image', file);

    return this.http.post<{url: string}>(
      `${this.apiUrl}/upload/image`,
      formData
    ).pipe(map((res) => res.url));
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

  createPreviewSession(payload: PreviewSessionPayload): Observable<PreviewSessionResponse> {
    return this.http.post<PreviewSessionResponse>(
      `${this.apiUrl}/content/preview/session`,
      payload,
      { headers: this.headers }
    ).pipe(catchError(this.handleError));
  }

  buildPortfolioPreviewUrl(token: string, path: string = '/'): string {
    const safeToken = String(token || '').trim();
    if (!safeToken) return this.portfolioPreviewUrl || this.PROD_DEFAULT_PORTFOLIO_PREVIEW_URL;

    let base = this.portfolioPreviewUrl || this.PROD_DEFAULT_PORTFOLIO_PREVIEW_URL;
    base = base.replace(/\/+$/, '');

    let normalizedPath = (path || '/').trim();
    if (!normalizedPath.startsWith('/')) normalizedPath = `/${normalizedPath}`;

    const target = `${base}${normalizedPath}`;
    const url = new URL(target);
    url.searchParams.set('previewToken', safeToken);
    return url.toString();
  }

  private invalidateReadCaches(): void {
    this.allContent$ = null;
    this.allContentCachedAt = 0;
    this.pageContentCache.clear();
    this.listItemCache.clear();
    this.subscribersCache.clear();
    this.contentPageV2Cache.clear();
    this.blogCardsV2Cache.clear();
    this.blogMediaBatchCache.clear();
    this.listItemsBatchV2Cache.clear();
    this.adminDashboardV3Cache.clear();
    this.adminContentV3Cache.clear();
    this.mediaItemsCache.clear();
    this.clearRouteCacheSnapshots();
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

  private persistAllContentSnapshot(items: RedisContent[]): void {
    void items;
  }

  private readAllContentSnapshot(): RedisContent[] | null {
    return null;
  }

  private persistPageSnapshot(pageId: number, items: RedisContent[]): void {
    void pageId;
    void items;
  }

  private readPageSnapshot(pageId: number): RedisContent[] | null {
    void pageId;
    return null;
  }

  private persistListItemSnapshot(listItemID: string, items: RedisContent[]): void {
    void listItemID;
    void items;
  }

  private readListItemSnapshot(listItemID: string): RedisContent[] | null {
    void listItemID;
    return null;
  }

  private persistSubscribersSnapshot(cacheKey: string, payload: NotificationSubscribersResponse): void {
    void cacheKey;
    void payload;
  }

  private readSubscribersSnapshot(cacheKey: string): NotificationSubscribersResponse | null {
    void cacheKey;
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

  private persistPageSnapshotsFromAll(items: RedisContent[]): void {
    void items;
  }

  private writeSnapshot(key: string, data: unknown): void {
    void key;
    void data;
  }

  private readSnapshot<T>(key: string, validator: (value: unknown) => value is T): T | null {
    void key;
    void validator;
    return null;
  }

  private isRedisContentArray(value: unknown): value is RedisContent[] {
    return Array.isArray(value);
  }

  private isNotificationSubscriberResponse(value: unknown): value is NotificationSubscribersResponse {
    return !!value && typeof value === 'object' && Array.isArray((value as NotificationSubscribersResponse).subscribers);
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

  private getDefaultCollectionsRegistry(): CollectionsCategoryRegistry {
    const nowIso = new Date().toISOString();
    return {
      categories: [
        {
          id: 'general',
          name: 'General',
          slug: 'general',
          description: 'General purpose writing and notes.',
          isArchived: false,
          sortOrder: 0,
          createdAt: nowIso,
          updatedAt: nowIso
        }
      ],
      updatedAt: nowIso
    };
  }

  private normalizeCollectionsRegistry(raw: any): CollectionsCategoryRegistry {
    const fallback = this.getDefaultCollectionsRegistry();
    const input = Array.isArray(raw?.categories) ? raw.categories : [];
    const usedIds = new Set<string>();

    const categories: CollectionsCategory[] = input
      .map((entry: any, index: number): CollectionsCategory | null => {
        const name = String(entry?.name || '').trim();
        if (!name) return null;

        const slug = this.slugify(entry?.slug || name);
        const baseId = this.slugify(entry?.id || slug || name) || `category-${index + 1}`;
        const id = usedIds.has(baseId) ? `${baseId}-${index + 1}` : baseId;
        usedIds.add(id);

        return {
          id,
          name,
          slug: slug || id,
          description: String(entry?.description || '').trim() || undefined,
          isArchived: !!entry?.isArchived,
          sortOrder: Number.isFinite(Number(entry?.sortOrder)) ? Number(entry.sortOrder) : index,
          createdAt: String(entry?.createdAt || '').trim() || undefined,
          updatedAt: String(entry?.updatedAt || '').trim() || undefined
        };
      })
      .filter((entry: CollectionsCategory | null): entry is CollectionsCategory => !!entry)
      .sort((a: CollectionsCategory, b: CollectionsCategory) => {
        const aOrder = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
        const bOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
        return aOrder - bOrder;
      });

    if (!categories.length) return fallback;

    return {
      categories,
      updatedAt: String(raw?.updatedAt || '').trim() || new Date().toISOString()
    };
  }

  private normalizeCollectionsEntryMetadata(raw: any, item?: Partial<RedisContent> | null): CollectionsEntryMetadata {
    const nowIso = new Date().toISOString();
    const title = String(raw?.title || item?.Text || '').trim() || 'Untitled';
    const summary = String(raw?.summary || '').trim();
    const categoryId = String(raw?.categoryId || '').trim() || 'general';
    const categorySlug = this.slugify(raw?.categorySlug || categoryId) || 'general';
    const isPublic = !!raw?.isPublic || String(raw?.visibility || '').toLowerCase() === 'public';
    const createdAt = String(raw?.createdAt || item?.CreatedAt || '').trim() || nowIso;
    const updatedAt = String(raw?.updatedAt || item?.UpdatedAt || '').trim() || nowIso;

    return {
      title,
      summary,
      entryType: this.normalizeCollectionsEntryType(raw?.entryType),
      categoryId,
      categorySlug,
      categoryName: String(raw?.categoryName || '').trim() || undefined,
      tags: this.normalizeStringList(raw?.tags),
      isPublic,
      visibility: isPublic ? 'public' : 'hidden',
      createdAt,
      updatedAt,
      publishedAt: String(raw?.publishedAt || '').trim() || undefined
    };
  }

  private normalizeCollectionsEntryType(raw: any): CollectionsEntryType {
    const value = String(raw || '').trim().toLowerCase();
    const allowed: CollectionsEntryType[] = ['lyrics', 'poem', 'quote', 'transcript', 'interview', 'note', 'article', 'custom'];
    if ((allowed as string[]).includes(value)) return value as CollectionsEntryType;
    return 'custom';
  }

  private normalizeStringList(input: any): string[] {
    if (!Array.isArray(input)) return [];
    const values: string[] = [];
    const seen = new Set<string>();
    for (const raw of input) {
      const clean = String(raw || '').trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(clean);
    }
    return values;
  }

  private slugify(value: string): string {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private normalizeSignatureSettings(raw: any): BlogSignatureSettings {
    const fallback = this.getDefaultSignatureSettings();

    const signaturesRaw = Array.isArray(raw?.signatures) ? raw.signatures : [];
    const signatures: BlogSignature[] = signaturesRaw
      .map((entry: any): BlogSignature | null => {
        const quote = String(entry?.quote || '').trim();
        const quoteAuthor = String(entry?.quoteAuthor || '').trim();
        if (!quote || !quoteAuthor) return null;

        const id = String(entry?.id || '').trim() || `sig-${Date.now().toString(36)}`;
        const label = String(entry?.label || '').trim() || `Quote by ${quoteAuthor}`;
        const signOffName = String(entry?.signOffName || 'Grayson Wills').trim() || 'Grayson Wills';
        return { id, label, quote, quoteAuthor, signOffName };
      })
      .filter((entry: BlogSignature | null): entry is BlogSignature => !!entry);

    if (!signatures.length) {
      return fallback;
    }

    const ids = new Set(signatures.map((sig) => sig.id));
    const defaultSignatureId = String(raw?.defaultSignatureId || '').trim();

    return {
      signatures,
      defaultSignatureId: ids.has(defaultSignatureId) ? defaultSignatureId : signatures[0].id
    };
  }
}
