import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { BlogApiService } from './blog-api.service';
import { PageContentID, PageID, RedisContent } from '../models/redis-content.model';

describe('BlogApiService canonical blog APIs', () => {
  let service: BlogApiService;
  let httpMock: HttpTestingController;

  const apiUrl = 'https://api.example.test/api';
  const postItems: RedisContent[] = [
    {
      ID: 'blog-item-post-1',
      Text: 'Canonical Post',
      PageID: PageID.Blog,
      PageContentID: PageContentID.BlogItem,
      ListItemID: 'post-1',
      Metadata: { title: 'Canonical Post', version: 2 }
    }
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [BlogApiService]
    });
    service = TestBed.inject(BlogApiService);
    httpMock = TestBed.inject(HttpTestingController);
    service.setApiEndpoint(apiUrl);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('creates blog posts through the canonical post endpoint', () => {
    let result: RedisContent[] = [];
    service.createBlogPost(
      'Canonical Post',
      '<p>Hello</p>',
      '<p>Rough</p>',
      'Summary',
      ['mcp'],
      ['seo'],
      'https://example.test/cover.png',
      'post-1',
      new Date('2026-06-15T12:00:00.000Z'),
      'draft',
      'Testing',
      3,
      'default-signature'
    ).subscribe((items) => {
      result = items;
    });

    const req = httpMock.expectOne(`${apiUrl}/blog/posts`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(jasmine.objectContaining({
      listItemID: 'post-1',
      title: 'Canonical Post',
      contentHtml: '<p>Hello</p>',
      roughDraftHtml: '<p>Rough</p>',
      coverImageUrl: 'https://example.test/cover.png',
      status: 'draft',
      readTimeMinutes: 3
    }));
    req.flush({ post: { listItemID: 'post-1', items: postItems } });

    expect(result).toEqual(postItems);
  });

  it('updates blog posts through the canonical post endpoint with concurrency fields', () => {
    service.updateBlogPost(
      'post-1',
      'Updated Post',
      '<p>Updated</p>',
      '',
      'Updated summary',
      ['updated'],
      [],
      undefined,
      new Date('2026-06-15T13:00:00.000Z'),
      'published',
      'Testing',
      undefined,
      undefined,
      undefined,
      2,
      '2026-06-15T12:00:00.000Z'
    ).subscribe();

    const req = httpMock.expectOne(`${apiUrl}/blog/posts/post-1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(jasmine.objectContaining({
      listItemID: 'post-1',
      title: 'Updated Post',
      contentHtml: '<p>Updated</p>',
      expectedVersion: 2,
      expectedUpdatedAt: '2026-06-15T12:00:00.000Z'
    }));
    req.flush({ post: { listItemID: 'post-1', items: postItems } });
  });

  it('reads and deletes blog posts through canonical endpoints', () => {
    let items: RedisContent[] = [];
    service.getBlogPost('post-1').subscribe((value) => {
      items = value;
    });

    const getReq = httpMock.expectOne(`${apiUrl}/blog/posts/post-1`);
    expect(getReq.request.method).toBe('GET');
    getReq.flush({ post: { listItemID: 'post-1', items: postItems } });
    expect(items).toEqual(postItems);

    service.deleteBlogPost('post-1', {
      expectedVersion: 2,
      expectedUpdatedAt: '2026-06-15T12:00:00.000Z'
    }).subscribe();

    const deleteReq = httpMock.expectOne(`${apiUrl}/blog/posts/post-1`);
    expect(deleteReq.request.method).toBe('DELETE');
    expect(deleteReq.request.body).toEqual({
      expectedVersion: 2,
      expectedUpdatedAt: '2026-06-15T12:00:00.000Z'
    });
    deleteReq.flush({ ok: true, listItemID: 'post-1', deleted: 3 });
  });
});
