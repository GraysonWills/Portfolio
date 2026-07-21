import { Component, DestroyRef, OnInit, OnDestroy, inject } from '@angular/core';
import { Location } from '@angular/common';
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
import { BlogComment, CommentService } from '../../../services/comment.service';
import { SiteAuthService, SiteUser } from '../../../services/site-auth.service';
import { SupportService } from '../../../services/support.service';

interface RecentPostCard {
  listItemID: string;
  slug?: string;
  title: string;
  summary: string;
  image?: string;
  publishDate: Date | null;
  tags: string[];
  readTime: number;
}

type CommentAuthMode = 'login' | 'email-code' | 'register' | 'confirm' | 'reset' | 'reset-confirm';

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
  dateModified: Date | null = null;
  seoTitle = '';
  seoDescription = '';
  canonicalPath = '';
  readTime = 1;
  roughDraftReadTime = 1;
  tags: string[] = [];
  privateSeoTags: string[] = [];
  category = '';
  bodyBlocks: BlogBodyBlock[] = [];
  roughDraftHtml = '';
  contentVersion: 'polished' | 'rough' = 'polished';
  signature: BlogSignature | null = null;

  // Recent posts
  recentPosts: ContentGroup[] = [];
  recentPostCards: RecentPostCard[] = [];
  currentListItemId = '';
  postSlug = '';

  // State
  isLoading = true;
  notFound = false;

  // Comments
  comments: BlogComment[] = [];
  commentsLoading = false;
  commentsLoadFailed = false;
  newCommentBody = '';
  replyDrafts: Record<string, string> = {};
  replyingToCommentId: string | null = null;
  savingComment = false;
  savingReplyFor: string | null = null;
  likingCommentId: string | null = null;
  deletingCommentId: string | null = null;
  commentAccountOpen = false;
  commentAuthMode: CommentAuthMode = 'login';
  commentAuthEmail = '';
  commentAuthPassword = '';
  commentAuthDisplayName = '';
  commentAuthCode = '';
  commentAuthBusy = false;
  commentAuthCodeExpiresAtMs = 0;
  commentAuthCodeCountdown = '';
  siteUser: SiteUser | null = null;
  private commentAuthTimerId: number | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private redisService: RedisService,
    private commentService: CommentService,
    readonly siteAuth: SiteAuthService,
    private sanitizer: DomSanitizer,
    private seo: SeoService,
    private messageService: MessageService,
    private support: SupportService
  ) {
    marked.setOptions({ breaks: false, gfm: true });
  }

  private resolveReadTimeMinutes(metadata: BlogPostMetadata | undefined, fallbackText: string): number {
    const manual = Number((metadata as any)?.readTimeMinutes);
    if (Number.isFinite(manual) && manual > 0) {
      return Math.max(1, Math.round(manual));
    }
    const words = String(fallbackText || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }

  ngOnInit(): void {
    this.siteAuth.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        const previousUser = this.siteUser?.username || '';
        this.siteUser = user;
        if (this.currentListItemId && previousUser !== (user?.username || '')) {
          this.loadComments(this.currentListItemId, true);
        }
      });

    this.route.params
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        this.resolveAndLoadPost(String(params['id'] || ''));
      });
  }

  ngOnDestroy(): void {
    this.seo.clearStructuredData('article');
    this.seo.clearStructuredData('article-breadcrumbs');
    this.clearCommentCodeExpiry();
  }

  private resolveAndLoadPost(routeValue: string): void {
    this.isLoading = true;
    this.notFound = false;
    if (this.redisService.isPreviewModeActive()) {
      this.loadResolvedPost(routeValue, routeValue, `/blog/${encodeURIComponent(routeValue)}`);
      return;
    }

    this.redisService.resolveBlogRouteV3(routeValue).subscribe({
      next: (resolution) => {
        if (!resolution?.listItemID) {
          this.showNotFound();
          return;
        }
        if (resolution.canonicalPath && resolution.canonicalPath !== `/blog/${routeValue}`) {
          this.location.replaceState(resolution.canonicalPath);
        }
        this.loadResolvedPost(
          resolution.listItemID,
          resolution.slug || routeValue,
          resolution.canonicalPath || `/blog/${resolution.slug || routeValue}`,
          resolution.dateModified || null
        );
      },
      error: () => {
        this.showNotFound();
      }
    });
  }

  private loadResolvedPost(listItemID: string, slug: string, canonicalPath: string, dateModified?: string | null): void {
    this.currentListItemId = listItemID;
    this.postSlug = slug;
    this.canonicalPath = canonicalPath;
    this.dateModified = dateModified ? new Date(dateModified) : null;
    this.loadPost(listItemID);
    this.loadComments(listItemID);
    this.loadRecentPosts();
  }

  private loadPost(listItemId: string): void {
    this.notFound = false;
    this.bodyBlocks = [];
    this.roughDraftHtml = '';
    this.contentVersion = 'polished';
    this.readTime = 1;
    this.roughDraftReadTime = 1;
    if (this.redisService.isContentV2StreamingEnabled()) {
      this.loadPostV3(listItemId);
      return;
    }
    this.loadPostLegacy(listItemId);
  }

  private loadPostV3(listItemId: string): void {
    this.isLoading = true;
    this.redisService.getBlogPostDetailV3(listItemId).subscribe({
      next: (payload) => {
        if (!payload?.listItemID) {
          this.showNotFound();
          return;
        }

        this.title = payload.title || 'Untitled';
        this.postSlug = String(payload.slug || this.postSlug || '').trim();
        this.seoTitle = String(payload.seoTitle || '').trim();
        this.seoDescription = String(payload.seoDescription || '').trim();
        this.canonicalPath = String(payload.canonicalPath || this.canonicalPath || `/blog/${this.postSlug || listItemId}`).trim();
        this.dateModified = payload.dateModified ? new Date(payload.dateModified) : this.dateModified;
        this.summary = payload.summary || '';
        this.coverImage = payload.coverImage || '';
        this.coverAlt = payload.coverAlt || this.title;
        this.publishDate = payload.publishDate ? new Date(payload.publishDate) : null;
        this.tags = Array.isArray(payload.tags) ? payload.tags : [];
        this.privateSeoTags = Array.isArray(payload.privateSeoTags) ? payload.privateSeoTags : [];
        this.category = payload.category || 'General';
        this.signature = payload.signature || null;
        this.bodyBlocks = Array.isArray(payload.bodyBlocks) ? payload.bodyBlocks : [];
        this.readTime = Math.max(1, Number(payload.readTimeMinutes) || 1);
        this.roughDraftHtml = String(payload.roughDraftHtml || '');
        this.roughDraftReadTime = this.hasRoughDraft()
          ? this.calculateReadTimeFromText(this.extractReadableText(this.roughDraftHtml))
          : this.readTime;
        this.updateSeo(listItemId);
        this.isLoading = false;
      },
      error: () => {
        this.showNotFound();
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load blog post' });
      }
    });
  }

  private loadPostLegacy(listItemId: string, hydrateOnly: boolean = false): void {
    if (!hydrateOnly) {
      this.isLoading = true;
    }
    this.redisService.getBlogPostByListItemId(listItemId).subscribe({
      next: (items: RedisContent[]) => {
        if (!items || items.length === 0) {
          if (!hydrateOnly) {
            this.notFound = true;
            this.isLoading = false;
          }
          return;
        }

        const metaItem = items.find(i => i.PageContentID === PageContentID.BlogItem) || items.find(i => !!i.Metadata);
        const textItem = items.find(i => i.PageContentID === PageContentID.BlogText);
        const imgItem  = items.find(i => i.PageContentID === PageContentID.BlogImage);
        const bodyItem = items.find(i => i.PageContentID === PageContentID.BlogBody);
        const roughDraftItem = items.find(i => i.PageContentID === PageContentID.BlogRoughDraft);

        const meta = metaItem?.Metadata as any || {};
        this.applyMetadata(meta);

        // Hide drafts/scheduled posts from public view.
        if (!this.isPostVisible(meta, listItemId)) {
          if (!hydrateOnly) {
            this.notFound = true;
            this.isLoading = false;
          }
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
          if (!hydrateOnly) {
            this.notFound = true;
            this.isLoading = false;
          }
          return;
        }

        // Calculate read time from all text content
        const allText = this.bodyBlocks
          .filter(b => b.type === 'paragraph' || b.type === 'heading' || b.type === 'quote')
          .map(b => (b as any).content || '')
          .join(' ');
        this.readTime = this.resolveReadTimeMinutes(meta as BlogPostMetadata, allText);
        this.roughDraftHtml = String(roughDraftItem?.Text || '');
        this.roughDraftReadTime = this.hasRoughDraft()
          ? this.calculateReadTimeFromText(this.extractReadableText(this.roughDraftHtml))
          : this.readTime;

        this.updateSeo(listItemId);

        if (!hydrateOnly) {
          this.isLoading = false;
        }
      },
      error: () => {
        if (!hydrateOnly) {
          this.notFound = true;
          this.isLoading = false;
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load blog post' });
        }
      }
    });
  }

  private applyMetadata(meta: any): void {
    this.title = meta.title || 'Untitled';
    this.postSlug = String(meta.slug || '').trim();
    this.seoTitle = String(meta.seoTitle || '').trim();
    this.seoDescription = String(meta.seoDescription || '').trim();
    this.canonicalPath = String(meta.canonicalPath || this.canonicalPath || '').trim();
    this.dateModified = meta.dateModified ? new Date(meta.dateModified) : this.dateModified;
    this.summary = meta.summary || '';
    this.tags = meta.tags || [];
    this.privateSeoTags = Array.isArray(meta.privateSeoTags) ? meta.privateSeoTags : [];
    this.category = meta.category || 'General';
    this.publishDate = meta.publishDate ? new Date(meta.publishDate) : null;
    this.signature = this.resolveSignature(meta);
  }

  private isPostVisible(meta: any, listItemId: string): boolean {
    const bypassVisibility = !!meta.previewBypassVisibility || this.redisService.isPreviewListItemForcedVisible(listItemId);
    const status = meta.status || 'published';
    const publishTs = meta.publishDate ? new Date(meta.publishDate).getTime() : null;
    return !!(bypassVisibility || (status === 'published' && !(publishTs && publishTs > Date.now())));
  }

  private showNotFound(): void {
    this.notFound = true;
    this.isLoading = false;
    this.seo.clearStructuredData('article');
    this.seo.clearStructuredData('article-breadcrumbs');
    this.seo.update({
      title: 'Blog Post Not Found',
      description: 'The requested blog post does not exist or is not publicly available.',
      url: this.canonicalPath || this.router.url.split('?')[0],
      robots: 'noindex,nofollow,noarchive'
    });
  }

  private updateSeo(listItemId: string): void {
    const urlPath = this.canonicalPath || `/blog/${this.postSlug || listItemId}`;
    const seoKeywords = this.buildSeoKeywords(this.tags, this.privateSeoTags, this.category);
    this.seo.update({
      title: this.seoTitle || this.title,
      description: this.seoDescription || this.summary || `${this.title} — a blog post by Grayson Wills.`,
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
      '@id': `${canonicalUrl}#article`,
      headline: this.title,
      description: this.seoDescription || this.summary || undefined,
      image: this.coverImage || 'https://www.grayson-wills.com/og-image.png',
      datePublished: this.publishDate ? this.publishDate.toISOString() : undefined,
      dateModified: this.dateModified ? this.dateModified.toISOString() : (this.publishDate ? this.publishDate.toISOString() : undefined),
      keywords: seoKeywords.length ? seoKeywords.join(', ') : undefined,
      url: canonicalUrl,
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
      isPartOf: { '@type': 'Blog', '@id': 'https://www.grayson-wills.com/blog#blog' },
      author: {
        '@type': 'Person',
        '@id': 'https://www.grayson-wills.com/#person',
        name: 'Grayson Wills',
        url: 'https://www.grayson-wills.com/'
      },
      publisher: {
        '@type': 'Person',
        '@id': 'https://www.grayson-wills.com/#person',
        name: 'Grayson Wills'
      }
    };
    this.seo.setStructuredData('article', jsonLd);
    this.seo.setStructuredData('article-breadcrumbs', {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.grayson-wills.com/' },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://www.grayson-wills.com/blog' },
        { '@type': 'ListItem', position: 3, name: this.title, item: canonicalUrl }
      ]
    });
  }

  private loadRecentPosts(): void {
    if (this.redisService.isBlogV2CardsEnabled()) {
      this.redisService.getBlogCardsV2({
        limit: 6,
        status: 'published',
        includeFuture: false,
        cacheScope: `route:/blog/${this.currentListItemId}:recent`
      }).subscribe({
        next: (response) => {
          const cards = (response?.items || [])
            .filter((item) => item.listItemID !== this.currentListItemId)
            .slice(0, 3);

          this.recentPostCards = cards.map((item) => ({
            listItemID: item.listItemID,
            slug: item.slug,
            title: item.title || 'Untitled',
            summary: item.summary || '',
            image: undefined,
            publishDate: item.publishDate ? new Date(item.publishDate) : null,
            tags: item.tags || [],
            readTime: Math.max(1, Number(item.readTimeMinutes) || 1)
          }));
          this.recentPosts = this.recentPostCards.map((card) => ({
            listItemID: card.listItemID,
            items: [],
            metadata: {
              title: card.title,
              summary: card.summary,
              tags: card.tags,
              publishDate: card.publishDate || undefined,
              status: 'published'
            } as any
          }));

          const ids = this.recentPostCards.map((card) => card.listItemID);
          this.redisService.getBlogCardsMedia(ids, {
            cacheScope: `route:/blog/${this.currentListItemId}:recent-media`
          }).subscribe({
            next: (media) => {
              const map = new Map(media.map((m) => [m.listItemID, m.imageUrl]));
              this.recentPostCards = this.recentPostCards.map((card) => ({
                ...card,
                image: map.get(card.listItemID) || card.image
              }));
            },
            error: () => {}
          });
        },
        error: () => {}
      });
      return;
    }

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
        this.recentPostCards = this.recentPosts.map((post) => this.toRecentPostCard(post));
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

  renderRoughDraftHtml(): SafeHtml {
    return this.renderMarkdown(this.roughDraftHtml);
  }

  hasRoughDraft(): boolean {
    return !!String(this.roughDraftHtml || '').trim();
  }

  isShowingRoughDraft(): boolean {
    return this.contentVersion === 'rough' && this.hasRoughDraft();
  }

  showPolishedVersion(): void {
    this.contentVersion = 'polished';
  }

  showRoughDraftVersion(): void {
    if (!this.hasRoughDraft()) return;
    this.contentVersion = 'rough';
  }

  getActiveReadTime(): number {
    return this.isShowingRoughDraft() ? this.roughDraftReadTime : this.readTime;
  }

  refreshComments(): void {
    this.loadComments(this.currentListItemId);
  }

  submitComment(): void {
    if (!this.ensureCommentUser()) return;
    const body = String(this.newCommentBody || '').trim();
    if (!body) {
      this.messageService.add({ severity: 'warn', summary: 'Comment Empty', detail: 'Write a comment first.' });
      return;
    }

    this.savingComment = true;
    this.commentService.createComment(this.currentListItemId, body).subscribe({
      next: () => {
        this.newCommentBody = '';
        this.savingComment = false;
        this.loadComments(this.currentListItemId, true);
      },
      error: (err) => {
        this.savingComment = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Comment Failed',
          detail: err?.message || 'Could not post comment.'
        });
      }
    });
  }

  toggleReply(comment: BlogComment): void {
    if (!this.ensureCommentUser()) return;
    this.replyingToCommentId = this.replyingToCommentId === comment.commentId ? null : comment.commentId;
  }

  submitReply(comment: BlogComment): void {
    if (!this.ensureCommentUser()) return;
    const body = String(this.replyDrafts[comment.commentId] || '').trim();
    if (!body) {
      this.messageService.add({ severity: 'warn', summary: 'Reply Empty', detail: 'Write a reply first.' });
      return;
    }

    this.savingReplyFor = comment.commentId;
    this.commentService.createComment(this.currentListItemId, body, comment.commentId).subscribe({
      next: () => {
        this.replyDrafts[comment.commentId] = '';
        this.replyingToCommentId = null;
        this.savingReplyFor = null;
        this.loadComments(this.currentListItemId, true);
      },
      error: (err) => {
        this.savingReplyFor = null;
        this.messageService.add({
          severity: 'error',
          summary: 'Reply Failed',
          detail: err?.message || 'Could not post reply.'
        });
      }
    });
  }

  toggleLike(comment: BlogComment): void {
    if (!this.ensureCommentUser()) return;
    this.likingCommentId = comment.commentId;
    this.commentService.setLike(comment.commentId, !comment.likedByViewer).subscribe({
      next: (updated) => {
        this.comments = this.replaceComment(this.comments, updated);
        this.likingCommentId = null;
      },
      error: (err) => {
        this.likingCommentId = null;
        this.messageService.add({
          severity: 'error',
          summary: 'Like Failed',
          detail: err?.message || 'Could not update like.'
        });
      }
    });
  }

  deleteComment(comment: BlogComment): void {
    if (!comment.viewerCanDelete || comment.deleted) return;
    this.deletingCommentId = comment.commentId;
    this.commentService.deleteComment(comment.commentId).subscribe({
      next: () => {
        this.deletingCommentId = null;
        this.loadComments(this.currentListItemId, true);
      },
      error: (err) => {
        this.deletingCommentId = null;
        this.messageService.add({
          severity: 'error',
          summary: 'Delete Failed',
          detail: err?.message || 'Could not delete comment.'
        });
      }
    });
  }

  openCommentAccount(mode: CommentAuthMode = 'login'): void {
    if (!this.siteAuth.isConfigured()) {
      this.messageService.add({
        severity: 'info',
        summary: 'Accounts Not Ready',
        detail: 'Comment accounts need a public Cognito client before sign-in is available.'
      });
      return;
    }
    this.commentAccountOpen = true;
    this.setCommentAuthMode(mode);
  }

  closeCommentAccount(): void {
    this.commentAccountOpen = false;
    this.clearCommentCodeExpiry();
  }

  setCommentAuthMode(mode: CommentAuthMode): void {
    this.commentAuthMode = mode;
    if (mode === 'login' || mode === 'register' || mode === 'reset') {
      this.commentAuthCode = '';
      this.clearCommentCodeExpiry();
    }
    if (mode !== 'register' && mode !== 'reset-confirm') {
      this.commentAuthPassword = '';
    }
  }

  getCommentAuthSubmitLabel(): string {
    if (this.commentAuthMode === 'register') return 'Create Account';
    if (this.commentAuthMode === 'confirm') return 'Verify Email';
    if (this.commentAuthMode === 'reset') return 'Send Reset Code';
    if (this.commentAuthMode === 'reset-confirm') return 'Update Password';
    if (this.commentAuthMode === 'email-code') return 'Verify Code';
    return 'Send Code';
  }

  submitCommentAuth(): void {
    if (this.commentAuthBusy) return;
    this.commentAuthBusy = true;

    const done = () => {
      this.commentAuthBusy = false;
    };

    if (this.commentAuthMode === 'register') {
      this.siteAuth.register(this.commentAuthDisplayName, this.commentAuthEmail, this.commentAuthPassword).subscribe({
        next: () => {
          done();
          this.setCommentAuthMode('confirm');
          this.startCommentCodeExpiry();
          this.messageService.add({
            severity: 'success',
            summary: 'Check Email',
            detail: 'Enter the verification code within 10 minutes to finish creating your account.'
          });
        },
        error: (err) => {
          done();
          this.messageService.add({ severity: 'error', summary: 'Registration Failed', detail: err?.message || 'Could not register.' });
        }
      });
      return;
    }

    if (this.commentAuthMode === 'confirm') {
      this.siteAuth.confirmRegistration(this.commentAuthEmail, this.commentAuthCode).subscribe({
        next: () => {
          done();
          this.setCommentAuthMode('login');
          this.messageService.add({
            severity: 'success',
            summary: 'Verified',
            detail: 'Your account is verified. Send yourself a sign-in code to comment.'
          });
        },
        error: (err) => {
          done();
          this.messageService.add({ severity: 'error', summary: 'Verification Failed', detail: err?.message || 'Could not verify account.' });
        }
      });
      return;
    }

    if (this.commentAuthMode === 'reset') {
      this.siteAuth.forgotPassword(this.commentAuthEmail).subscribe({
        next: () => {
          done();
          this.setCommentAuthMode('reset-confirm');
          this.startCommentCodeExpiry();
          this.messageService.add({
            severity: 'success',
            summary: 'Check Email',
            detail: 'Enter the reset code within 10 minutes and choose a new password.'
          });
        },
        error: (err) => {
          done();
          this.messageService.add({ severity: 'error', summary: 'Reset Failed', detail: err?.message || 'Could not send password reset code.' });
        }
      });
      return;
    }

    if (this.commentAuthMode === 'reset-confirm') {
      this.siteAuth.confirmForgotPassword(this.commentAuthEmail, this.commentAuthCode, this.commentAuthPassword).subscribe({
        next: () => {
          done();
          this.commentAuthCode = '';
          this.commentAuthPassword = '';
          this.clearCommentCodeExpiry();
          this.setCommentAuthMode('login');
          this.messageService.add({
            severity: 'success',
            summary: 'Password Updated',
            detail: 'Send yourself a sign-in code to comment.'
          });
        },
        error: (err) => {
          done();
          this.messageService.add({ severity: 'error', summary: 'Reset Failed', detail: err?.message || 'Could not reset password.' });
        }
      });
      return;
    }

    if (this.commentAuthMode === 'email-code') {
      this.siteAuth.confirmEmailCodeLogin(this.commentAuthEmail, this.commentAuthCode).subscribe({
        next: () => {
          done();
          this.commentAccountOpen = false;
          this.commentAuthCode = '';
          this.commentAuthPassword = '';
          this.clearCommentCodeExpiry();
          this.loadComments(this.currentListItemId, true);
        },
        error: (err) => {
          done();
          this.messageService.add({ severity: 'error', summary: 'Sign In Failed', detail: err?.message || 'Could not verify sign-in code.' });
        }
      });
      return;
    }

    this.siteAuth.startEmailCodeLogin(this.commentAuthEmail).subscribe({
      next: () => {
        done();
        this.setCommentAuthMode('email-code');
        this.startCommentCodeExpiry();
        this.commentAuthPassword = '';
        this.messageService.add({
          severity: 'success',
          summary: 'Check Email',
          detail: 'Enter the sign-in code within 10 minutes.'
        });
      },
      error: (err) => {
        done();
        this.messageService.add({ severity: 'error', summary: 'Code Failed', detail: err?.message || 'Could not send sign-in code.' });
      }
    });
  }

  resendCommentAuthCode(): void {
    if (this.commentAuthBusy) return;
    this.commentAuthBusy = true;

    const done = () => {
      this.commentAuthBusy = false;
    };

    if (this.commentAuthMode === 'confirm') {
      this.siteAuth.resendRegistrationCode(this.commentAuthEmail).subscribe({
        next: () => {
          done();
          this.startCommentCodeExpiry();
          this.messageService.add({ severity: 'success', summary: 'Code Sent', detail: 'A new verification code was sent.' });
        },
        error: (err) => {
          done();
          this.messageService.add({ severity: 'error', summary: 'Resend Failed', detail: err?.message || 'Could not resend verification code.' });
        }
      });
      return;
    }

    if (this.commentAuthMode === 'reset-confirm') {
      this.siteAuth.forgotPassword(this.commentAuthEmail).subscribe({
        next: () => {
          done();
          this.startCommentCodeExpiry();
          this.messageService.add({ severity: 'success', summary: 'Code Sent', detail: 'A new password reset code was sent.' });
        },
        error: (err) => {
          done();
          this.messageService.add({ severity: 'error', summary: 'Resend Failed', detail: err?.message || 'Could not send password reset code.' });
        }
      });
      return;
    }

    this.siteAuth.startEmailCodeLogin(this.commentAuthEmail).subscribe({
      next: () => {
        done();
        this.setCommentAuthMode('email-code');
        this.startCommentCodeExpiry();
        this.messageService.add({ severity: 'success', summary: 'Code Sent', detail: 'A new sign-in code was sent.' });
      },
      error: (err) => {
        done();
        this.messageService.add({ severity: 'error', summary: 'Resend Failed', detail: err?.message || 'Could not send sign-in code.' });
      }
    });
  }

  logoutCommentUser(): void {
    this.siteAuth.logout();
    this.loadComments(this.currentListItemId, true);
  }

  trackByComment(index: number, comment: BlogComment): string {
    return comment.commentId || `${index}`;
  }

  private toRecentPostCard(post: ContentGroup): RecentPostCard {
    const textItem = post.items.find(i => i.PageContentID === PageContentID.BlogText);
    const imgItem  = post.items.find(i => i.PageContentID === PageContentID.BlogImage);
    const meta = post.metadata as BlogPostMetadata | undefined;
    const content = textItem?.Text || '';

    return {
      listItemID: post.listItemID,
      slug: String(meta?.slug || '').trim() || undefined,
      title: meta?.title || 'Untitled',
      summary: meta?.summary || content.substring(0, 150),
      image: imgItem?.Photo,
      publishDate: meta?.publishDate ? new Date(meta.publishDate) : null,
      tags: meta?.tags || [],
      readTime: this.resolveReadTimeMinutes(meta, content)
    };
  }

  trackByRecentPost(index: number, post: RecentPostCard): string {
    return post.listItemID || `${index}`;
  }

  trackByTag(index: number, tag: string): string {
    return `${tag}-${index}`;
  }

  goBack(): void {
    this.router.navigate(['/blog']);
  }

  /** Open the global support (buy-me-a-coffee) modal. */
  openSupport(): void {
    this.support.open({
      placement: 'article_end',
      postId: this.currentListItemId,
      postSlug: this.postSlug
    });
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

  private extractReadableText(value: string): string {
    const raw = String(value || '');
    if (!raw.trim()) return '';

    if (typeof document !== 'undefined' && this.looksLikeHtml(raw)) {
      const root = document.createElement('div');
      root.innerHTML = raw;
      return String(root.textContent || '').replace(/\s+/g, ' ').trim();
    }

    return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private calculateReadTimeFromText(value: string): number {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
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

  private loadComments(listItemId: string, quiet: boolean = false): void {
    const safeId = String(listItemId || '').trim();
    if (!safeId) return;

    if (!quiet) {
      this.commentsLoading = true;
    }
    this.commentsLoadFailed = false;

    this.commentService.getComments(safeId).subscribe({
      next: (response) => {
        this.comments = Array.isArray(response?.comments) ? response.comments : [];
        this.commentsLoading = false;
      },
      error: () => {
        this.commentsLoading = false;
        this.commentsLoadFailed = true;
      }
    });
  }

  private ensureCommentUser(): boolean {
    if (this.siteUser) return true;
    this.openCommentAccount('login');
    return false;
  }

  private startCommentCodeExpiry(): void {
    this.commentAuthCodeExpiresAtMs = Date.now() + (10 * 60 * 1000);
    this.updateCommentCodeCountdown();
    if (this.commentAuthTimerId !== null) {
      window.clearInterval(this.commentAuthTimerId);
    }
    this.commentAuthTimerId = window.setInterval(() => {
      this.updateCommentCodeCountdown();
    }, 1000);
  }

  private clearCommentCodeExpiry(): void {
    this.commentAuthCodeExpiresAtMs = 0;
    this.commentAuthCodeCountdown = '';
    if (this.commentAuthTimerId !== null) {
      window.clearInterval(this.commentAuthTimerId);
      this.commentAuthTimerId = null;
    }
  }

  private updateCommentCodeCountdown(): void {
    const remainingMs = Math.max(0, this.commentAuthCodeExpiresAtMs - Date.now());
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = `${remainingSeconds % 60}`.padStart(2, '0');
    this.commentAuthCodeCountdown = `${minutes}:${seconds}`;

    if (remainingMs <= 0 && this.commentAuthTimerId !== null) {
      window.clearInterval(this.commentAuthTimerId);
      this.commentAuthTimerId = null;
    }
  }

  private replaceComment(comments: BlogComment[], updated: BlogComment): BlogComment[] {
    return comments.map((comment) => {
      if (comment.commentId === updated.commentId) {
        return {
          ...updated,
          replies: comment.replies
        };
      }
      return {
        ...comment,
        replies: this.replaceComment(comment.replies || [], updated)
      };
    });
  }
}
