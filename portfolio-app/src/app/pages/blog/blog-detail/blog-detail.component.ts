import { Component, DestroyRef, OnInit, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RedisService } from '../../../services/redis.service';
import {
  RedisContent,
  PageContentID,
  ContentGroup,
  BlogPostMetadata,
  BlogBodyBlock,
  BlogSignature
} from '../../../models/redis-content.model';
import { SeoService } from '../../../services/seo.service';
import { MessageService } from 'primeng/api';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { marked } from 'marked';

@Component({
  selector: 'app-blog-detail',
  standalone: false,
  templateUrl: './blog-detail.component.html',
  styleUrl: './blog-detail.component.scss'
})
export class BlogDetailComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  // Post data
  title = '';
  summary = '';
  coverImage = '';
  coverAlt = '';
  publishDate: Date | null = null;
  readTime = 1;
  tags: string[] = [];
  privateSeoTags: string[] = [];
  category = '';
  bodyBlocks: BlogBodyBlock[] = [];
  signature: BlogSignature | null = null;

  // Recent posts
  recentPosts: ContentGroup[] = [];
  currentListItemId = '';

  // State
  isLoading = true;
  notFound = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private redisService: RedisService,
    private sanitizer: DomSanitizer,
    private seo: SeoService,
    private messageService: MessageService
  ) {
    marked.setOptions({ breaks: true, gfm: true });
  }

  ngOnInit(): void {
    this.route.params
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        this.currentListItemId = params['id'];
        this.loadPost(this.currentListItemId);
        this.loadRecentPosts();
      });
  }

  ngOnDestroy(): void {
    this.seo.clearStructuredData('article');
  }

  private loadPost(listItemId: string): void {
    this.isLoading = true;
    this.redisService.getBlogPostByListItemId(listItemId).subscribe({
      next: (items: RedisContent[]) => {
        if (!items || items.length === 0) {
          this.notFound = true;
          this.isLoading = false;
          return;
        }

        const metaItem = items.find(i => i.PageContentID === PageContentID.BlogItem) || items.find(i => !!i.Metadata);
        const textItem = items.find(i => i.PageContentID === PageContentID.BlogText);
        const imgItem  = items.find(i => i.PageContentID === PageContentID.BlogImage);
        const bodyItem = items.find(i => i.PageContentID === PageContentID.BlogBody);

        const meta = metaItem?.Metadata as any || {};
        this.title = meta.title || 'Untitled';
        this.summary = meta.summary || '';
        this.tags = meta.tags || [];
        this.privateSeoTags = Array.isArray(meta.privateSeoTags) ? meta.privateSeoTags : [];
        this.category = meta.category || 'General';
        this.publishDate = meta.publishDate ? new Date(meta.publishDate) : null;
        this.signature = this.resolveSignature(meta);
        const bypassVisibility = !!meta.previewBypassVisibility || this.redisService.isPreviewListItemForcedVisible(listItemId);

        // Hide drafts/scheduled posts from public view.
        const status = meta.status || 'published';
        const publishTs = meta.publishDate ? new Date(meta.publishDate).getTime() : null;
        if (!bypassVisibility && (status !== 'published' || (publishTs && publishTs > Date.now()))) {
          this.notFound = true;
          this.isLoading = false;
          return;
        }

        this.coverImage = imgItem?.Photo || '';
        this.coverAlt = imgItem?.Metadata?.['alt'] || this.title;

        // Parse body blocks
        if (bodyItem?.Text) {
          try {
            this.bodyBlocks = JSON.parse(bodyItem.Text);
          } catch {
            // Fallback: treat as single paragraph
            this.bodyBlocks = [{ type: 'paragraph', content: bodyItem.Text }];
          }
        } else if (textItem?.Text) {
          // Fallback: use BlogText as single paragraph body
          this.bodyBlocks = [{ type: 'paragraph', content: textItem.Text }];
        }

        // If there is no body/text at all, treat as not found.
        if (!this.bodyBlocks || this.bodyBlocks.length === 0) {
          this.notFound = true;
          this.isLoading = false;
          return;
        }

        // Calculate read time from all text content
        const allText = this.bodyBlocks
          .filter(b => b.type === 'paragraph' || b.type === 'heading' || b.type === 'quote')
          .map(b => (b as any).content || '')
          .join(' ');
        const words = allText.trim().split(/\s+/).length;
        this.readTime = Math.max(1, Math.ceil(words / 200));

        // SEO: update page title/meta + inject BlogPosting structured data.
        const urlPath = `/blog/${listItemId}`;
        const seoKeywords = this.buildSeoKeywords(this.tags, this.privateSeoTags, this.category);
        this.seo.update({
          title: this.title,
          description: this.summary || `${this.title} — a blog post by Grayson Wills.`,
          url: urlPath,
          image: this.coverImage || undefined,
          imageAlt: this.coverAlt || undefined,
          type: 'article',
          keywords: seoKeywords
        });

        const canonicalUrl = `https://www.grayson-wills.com${urlPath}`;
        const jsonLd: Record<string, unknown> = {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: this.title,
          description: this.summary || undefined,
          image: this.coverImage || 'https://www.grayson-wills.com/og-image.png',
          datePublished: this.publishDate ? this.publishDate.toISOString() : undefined,
          keywords: seoKeywords.length ? seoKeywords.join(', ') : undefined,
          mainEntityOfPage: canonicalUrl,
          author: {
            '@type': 'Person',
            name: 'Grayson Wills',
            url: 'https://www.grayson-wills.com/'
          }
        };
        this.seo.setStructuredData('article', jsonLd);

        this.isLoading = false;
      },
      error: () => {
        this.notFound = true;
        this.isLoading = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load blog post' });
      }
    });
  }

  private loadRecentPosts(): void {
    this.redisService.getBlogPosts().subscribe({
      next: (posts: ContentGroup[]) => {
        // Sort by date, exclude current post, take 3
        this.recentPosts = posts
          .filter(p => p.listItemID !== this.currentListItemId)
          .sort((a, b) => {
            const da = (a.metadata as any)?.publishDate ? new Date((a.metadata as any).publishDate).getTime() : 0;
            const db = (b.metadata as any)?.publishDate ? new Date((b.metadata as any).publishDate).getTime() : 0;
            return db - da;
          })
          .slice(0, 3);
      },
      error: () => {}
    });
  }

  /** Render Markdown to safe HTML */
  renderMarkdown(content: string): SafeHtml {
    const raw = String(content || '');
    if (!raw.trim()) {
      return this.sanitizer.bypassSecurityTrustHtml('');
    }

    // Most authoring content is stored as HTML from Quill. Normalize NBSPs so
    // text wraps naturally instead of breaking at punctuation/dashes.
    if (this.looksLikeHtml(raw)) {
      const normalizedHtml = this.normalizeNbsp(raw);
      return this.sanitizer.bypassSecurityTrustHtml(normalizedHtml);
    }

    const markdown = this.normalizeNbsp(raw);
    const html = marked.parse(markdown) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /** Get post card data for recent posts (same logic as BlogComponent) */
  getPostData(post: ContentGroup): any {
    const textItem = post.items.find(i => i.PageContentID === PageContentID.BlogText);
    const imgItem  = post.items.find(i => i.PageContentID === PageContentID.BlogImage);
    const meta = post.metadata as BlogPostMetadata | undefined;
    const content = textItem?.Text || '';

    return {
      listItemID: post.listItemID,
      title: meta?.title || 'Untitled',
      summary: meta?.summary || content.substring(0, 150),
      image: imgItem?.Photo,
      publishDate: meta?.publishDate ? new Date(meta.publishDate) : null,
      tags: meta?.tags || [],
      readTime: Math.max(1, Math.ceil((content.trim().split(/\s+/).length) / 200))
    };
  }

  goBack(): void {
    this.router.navigate(['/blog']);
  }

  private resolveSignature(metadata: any): BlogSignature {
    const snapshot = metadata?.signatureSnapshot;
    const quote = String(snapshot?.quote || '').trim();
    const quoteAuthor = String(snapshot?.quoteAuthor || '').trim();
    const signOffName = String(snapshot?.signOffName || '').trim() || 'Grayson Wills';
    const label = String(snapshot?.label || '').trim() || 'Default Signature';
    const id = String(snapshot?.id || metadata?.signatureId || '').trim() || 'sig-default';

    if (quote && quoteAuthor) {
      return {
        id,
        label,
        quote,
        quoteAuthor,
        signOffName
      };
    }

    return {
      id: 'sig-default',
      label: 'Default Signature',
      quote: 'Stay curious and keep building.',
      quoteAuthor: 'Grayson Wills',
      signOffName: 'Grayson Wills'
    };
  }

  private looksLikeHtml(value: string): boolean {
    return /<\/?[a-z][\s\S]*>/i.test(value);
  }

  private buildSeoKeywords(publicTags: string[], privateSeoTags: string[], category: string): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    const candidates = [...(publicTags || []), ...(privateSeoTags || []), category || ''];

    for (const raw of candidates) {
      const value = String(raw || '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(value);
    }

    return merged;
  }

  private normalizeNbsp(value: string): string {
    return value
      .replace(/&nbsp;/gi, ' ')
      .replace(/\u00a0/g, ' ');
  }
}
