import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { LinkedInDataService } from '../../services/linkedin-data.service';
import { RedisContent, PageContentID, PageID } from '../../models/redis-content.model';
import { firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';
import { AnalyticsService } from '../../services/analytics.service';
import { RouteViewStateService } from '../../services/route-view-state.service';
import { SupportService } from '../../services/support.service';

interface LandingViewState extends Record<string, unknown> {
  scrollY?: number;
  activeHeroIndex?: number;
  updatedAt?: number;
}

interface FeaturedRole {
  title: string;
  org: string;
  place: string;
  period: string;
  lead: string;
}

interface LandingPostCard {
  listItemID: string;
  slug?: string;
  title: string;
  dateLabel: string;
  readLabel: string;
  excerpt: string;
  image?: string;
}

interface LandingProjectCard {
  title: string;
  description: string;
  tags: string[];
  photo?: string;
  url?: string;
}

interface HeroSlide {
  photo: string;
  alt: string;
  displaySrc?: string;
  srcset?: string;
}

@Component({
  selector: 'app-landing',
  standalone: false,
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss'
})
export class LandingComponent implements OnInit, OnDestroy {
  landingPhotos: RedisContent[] = [];
  landingText: RedisContent[] = [];
  summary: string = '';
  contactInfo: any = {};
  topSkills: string[] = [];
  certifications: Array<{name: string; issuer: string; date?: string}> = [];
  education: Array<{degree: string; institution: string; location: string; graduationDate?: string}> = [];
  featuredRoles: FeaturedRole[] = [];
  featuredProjects: LandingProjectCard[] = [];
  latestPosts: LandingPostCard[] = [];
  websiteUrl = '';
  heroSlides: HeroSlide[] = [];
  activeHeroIndex: number = 0;
  isResumeCooldown = false;

  private heroAutoplayHandle: ReturnType<typeof setInterval> | null = null;
  private heroPrefetchIdleHandle: number | null = null;
  private heroPrefetchTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private heroPrefetchImage: HTMLImageElement | null = null;
  private readonly requestedHeroUrls = new Set<string>();
  private loadedHeroUrl: string | null = null;
  private resumeCooldownHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly heroAutoplayMs = 5000;
  private readonly heroPrefetchDelayMs = 1500;
  private readonly routeKey = '/';
  private heroContentResolved = false;
  private viewStateRestored = false;
  private lastScrollY = 0;
  private readonly defaultHeroSlides: Array<{ photo: string; alt: string; order: number }> = [
    {
      photo: 'https://images.unsplash.com/photo-1639322537228-f710d846310a?auto=format&fit=crop&fm=webp&w=1920&q=80',
      alt: 'Artificial intelligence neural network visualization',
      order: 1
    },
    {
      photo: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&fm=webp&w=1920&q=80',
      alt: 'Machine learning data flow concept',
      order: 2
    },
    {
      photo: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&fm=webp&w=1920&q=80',
      alt: 'Data analytics dashboard visualization',
      order: 3
    },
    {
      photo: 'https://images.unsplash.com/photo-1518432031352-d6fc5c10da5a?auto=format&fit=crop&fm=webp&w=1920&q=80',
      alt: 'Abstract technology and coding environment',
      order: 4
    }
  ];

  constructor(
    private redisService: RedisService,
    private linkedInService: LinkedInDataService,
    private messageService: MessageService,
    private analytics: AnalyticsService,
    private routeViewState: RouteViewStateService,
    private support: SupportService
  ) {}

  ngOnInit(): void {
    this.routeViewState.primeRestore(this.routeKey);
    this.routeViewState.restoreScrollImmediate(this.routeKey);
    this.loadLandingContent();
    this.loadLinkedInData();
    this.loadFeaturedProjects();
    this.loadLatestPosts();
  }

  ngOnDestroy(): void {
    this.persistViewState();
    this.stopHeroAutoplay();
    this.cancelHeroPrefetch();
    this.clearResumeCooldown();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (typeof window !== 'undefined') {
      this.lastScrollY = window.scrollY;
    }
    if (!this.viewStateRestored) {
      return;
    }
    this.routeViewState.captureScroll(this.routeKey);
  }

  private loadLandingContent(): void {
    this.redisService.getLandingPayloadV3().subscribe({
      next: (payload) => {
        this.summary = String(payload?.summary || '').trim();
        this.landingPhotos = Array.isArray(payload?.heroSlides)
          ? payload.heroSlides
              .filter((slide) => !!slide?.photo)
              .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
              .map((slide, index) => ({
                ID: `landing-hero-${index + 1}`,
                PageID: PageID.Landing,
                PageContentID: PageContentID.LandingPhoto,
                Photo: slide.photo,
                Metadata: {
                  alt: slide.alt || 'Portfolio hero image',
                  order: slide.order || index + 1
                }
              } as RedisContent))
          : [];
        this.heroContentResolved = true;
        this.refreshHeroSlides();
        this.tryRestoreViewState();
        this.startHeroAutoplay();
      },
      error: (error) => {
        console.error('Error loading landing content:', error);
        // Network-backed defaults are a recovery path only. Waiting until the
        // content request fails avoids downloading defaults that are immediately
        // replaced by API-provided slides during the normal path.
        this.landingPhotos = [];
        this.heroContentResolved = true;
        this.refreshHeroSlides();
        this.tryRestoreViewState();
        this.startHeroAutoplay();
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load landing page content'
        });
      }
    });
  }

  private loadLinkedInData(): void {
    this.linkedInService.getLinkedInProfile().subscribe({
      next: (profile) => {
        if (!this.summary) {
          this.summary = profile.summary;
        }
        this.contactInfo = profile.contact;
        this.websiteUrl = profile.contact?.website || '';
        this.topSkills = profile.topSkills;
        this.certifications = profile.certifications;
        this.featuredRoles = (profile.experience || []).slice(0, 3).map((exp) => ({
          title: exp.title,
          org: exp.company,
          place: exp.location,
          period: exp.endDate ? `${exp.startDate} — ${exp.endDate}` : exp.startDate,
          lead: (exp.description && exp.description[0]) || ''
        }));
        this.tryRestoreViewState();
      },
      error: (error) => {
        console.error('Error loading LinkedIn data:', error);
      }
    });

    this.linkedInService.getEducation().subscribe({
      next: (edu) => { this.education = edu; },
      error: () => {}
    });
  }

  private loadLatestPosts(): void {
    this.redisService.getBlogCardsV2({
      limit: 3,
      status: 'published',
      includeFuture: false,
      cacheScope: 'route:/:landing-latest'
    }).subscribe({
      next: (response) => {
        const cards = Array.isArray(response?.items) ? response.items : [];
        this.latestPosts = cards.slice(0, 3).map((card) => ({
          listItemID: card.listItemID,
          slug: card.slug,
          title: card.title || 'Untitled',
          dateLabel: this.formatPostDate(card.publishDate),
          readLabel: `${Math.max(1, Math.round(Number(card.readTimeMinutes) || 1))} min read`,
          excerpt: card.summary || ''
        }));
        this.hydrateLatestPostImages();
      },
      error: (error) => {
        console.error('Error loading latest posts:', error);
      }
    });
  }

  private hydrateLatestPostImages(): void {
    const listItemIDs = this.latestPosts.map((post) => post.listItemID).filter(Boolean);
    if (!listItemIDs.length) return;

    this.redisService.getBlogCardsMedia(listItemIDs, {
      cacheScope: 'route:/:landing-latest-media'
    }).subscribe({
      next: (mediaItems) => {
        const mediaMap = new Map(
          (Array.isArray(mediaItems) ? mediaItems : [])
            .filter((item) => !!item?.listItemID && !!item?.imageUrl)
            .map((item) => [item.listItemID, item.imageUrl])
        );
        this.latestPosts = this.latestPosts.map((post) => ({
          ...post,
          image: mediaMap.get(post.listItemID) || post.image
        }));
      },
      error: (error) => {
        console.error('Error loading latest post images:', error);
      }
    });
  }

  private async loadFeaturedProjects(): Promise<void> {
    try {
      const categories = await firstValueFrom(this.redisService.getProjectsCategoriesV3({
        limit: 6,
        cacheScope: 'route:/:landing-featured-projects'
      }));

      const categoryRows = Array.isArray(categories?.items) ? categories.items : [];
      const categoryIds = categoryRows
        .map((cat, index) => ({ id: String(cat?.listItemID || '').trim(), order: Number(cat?.order) || index + 1 }))
        .filter((c) => !!c.id)
        .sort((a, b) => a.order - b.order)
        .map((c) => c.id);

      if (!categoryIds.length) return;

      const itemsByCategory = await firstValueFrom(
        this.redisService.getProjectItemsV3(categoryIds, { cacheScope: 'route:/:landing-featured-project-items' })
      );

      const cards: LandingProjectCard[] = [];
      for (const id of categoryIds) {
        const rows = Array.isArray(itemsByCategory?.[id]) ? itemsByCategory[id] : [];
        const textItems = rows
          .filter((r) => r?.PageContentID === PageContentID.ProjectsText)
          .sort((a, b) => (Number(a?.Metadata?.['order']) || 0) - (Number(b?.Metadata?.['order']) || 0));
        const photoItems = rows
          .filter((r) => r?.PageContentID === PageContentID.ProjectsPhoto)
          .sort((a, b) => (Number(a?.Metadata?.['order']) || 0) - (Number(b?.Metadata?.['order']) || 0));

        textItems.forEach((textItem, index) => {
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(textItem.Text || '{}');
          } catch {
            data = { title: 'Project', description: textItem.Text || '' };
          }
          const tags = Array.isArray(data['techStack'])
            ? (data['techStack'] as unknown[]).map((t) => String(t)).filter(Boolean).slice(0, 4)
            : [];
          cards.push({
            title: String(data['title'] || 'Project'),
            description: String(data['description'] || ''),
            tags,
            photo: photoItems[index]?.Photo || (data['photo'] ? String(data['photo']) : undefined),
            url: (data['liveUrl'] || data['githubUrl']) ? String(data['liveUrl'] || data['githubUrl']) : undefined
          });
        });
        if (cards.length >= 3) break;
      }

      this.featuredProjects = cards.slice(0, 3);
    } catch (error) {
      console.error('Error loading featured projects:', error);
    }
  }

  private formatPostDate(input: string | null): string {
    if (!input) return '';
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  openSupport(): void {
    this.support.open({ placement: 'home_writing' });
  }

  downloadResume(): void {
    if (this.isResumeCooldown) {
      return;
    }

    this.analytics.track('resume_download_clicked', {
      route: '/',
      page: 'home',
      metadata: { location: 'hero' }
    });
    this.isResumeCooldown = true;
    this.clearResumeCooldown();
    this.resumeCooldownHandle = setTimeout(() => {
      this.isResumeCooldown = false;
      this.resumeCooldownHandle = null;
    }, 5000);
    if (typeof window !== 'undefined') {
      window.open('/api/resume/download', '_blank', 'noopener,noreferrer');
    }
  }

  openEmail(email: string): void {
    this.analytics.track('contact_email_clicked', {
      route: '/',
      page: 'home',
      metadata: { location: 'hero' }
    });
    if (typeof window !== 'undefined' && email) {
      window.location.href = `mailto:${email}`;
    }
  }

  goToHeroSlide(index: number): void {
    if (!this.heroSlides.length) return;
    const nextIndex = ((index % this.heroSlides.length) + this.heroSlides.length) % this.heroSlides.length;
    if (nextIndex !== this.activeHeroIndex) {
      this.cancelScheduledHeroPrefetch();
      this.loadedHeroUrl = null;
      this.activeHeroIndex = nextIndex;
    }
    this.persistViewState();
    this.startHeroAutoplay();
  }

  nextHeroSlide(): void {
    if (this.heroSlides.length <= 1) return;
    this.cancelScheduledHeroPrefetch();
    this.loadedHeroUrl = null;
    this.activeHeroIndex = (this.activeHeroIndex + 1) % this.heroSlides.length;
  }

  get activeHeroSlide(): HeroSlide | null {
    return this.heroSlides[this.activeHeroIndex] || null;
  }

  private refreshHeroSlides(): void {
    const items = this.landingPhotos
      .filter(item => item.Photo)
      .sort((a, b) => {
        const aOrder = Number(a.Metadata?.['order']) || Number.MAX_SAFE_INTEGER;
        const bOrder = Number(b.Metadata?.['order']) || Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      })
      .map(item => this.createHeroSlide(
        item.Photo as string,
        item.Metadata?.['alt'] || 'Portfolio hero image'
      ));

    this.heroSlides = items.length > 0
      ? items
      : this.defaultHeroSlides.map(({ photo, alt }) => this.createHeroSlide(photo, alt));

    if (this.activeHeroIndex >= this.heroSlides.length) {
      this.activeHeroIndex = 0;
    }

    this.cancelHeroPrefetch();
    this.loadedHeroUrl = null;
  }

  private startHeroAutoplay(): void {
    this.stopHeroAutoplay();
    if (
      typeof window === 'undefined'
      || this.heroSlides.length <= 1
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) return;
    this.heroAutoplayHandle = setInterval(() => this.nextHeroSlide(), this.heroAutoplayMs);
  }

  private stopHeroAutoplay(): void {
    if (!this.heroAutoplayHandle) return;
    clearInterval(this.heroAutoplayHandle);
    this.heroAutoplayHandle = null;
  }

  onHeroImageLoad(): void {
    const currentSlide = this.activeHeroSlide;
    if (!currentSlide?.photo) return;

    // A cached or previously prefetched image still emits load. Treat it the
    // same as a network load so the following slide can be warmed in sequence.
    this.loadedHeroUrl = currentSlide.photo;
    this.requestedHeroUrls.add(currentSlide.photo);
    this.cancelScheduledHeroPrefetch();
    this.scheduleNextHeroPrefetch();
  }

  private scheduleNextHeroPrefetch(): void {
    if (
      typeof window === 'undefined'
      || this.heroSlides.length <= 1
      || this.loadedHeroUrl !== this.activeHeroSlide?.photo
      || this.shouldSkipHeroPrefetch()
      || this.heroPrefetchTimeoutHandle !== null
      || this.heroPrefetchIdleHandle !== null
    ) return;

    const currentSlide = this.activeHeroSlide;
    if (currentSlide?.photo) {
      this.requestedHeroUrls.add(currentSlide.photo);
    }

    const nextSlide = this.heroSlides[(this.activeHeroIndex + 1) % this.heroSlides.length];
    if (!nextSlide?.photo || this.requestedHeroUrls.has(nextSlide.photo)) return;

    const activeUrl = currentSlide?.photo || '';
    this.heroPrefetchTimeoutHandle = setTimeout(() => {
      this.heroPrefetchTimeoutHandle = null;
      if (this.loadedHeroUrl !== activeUrl || this.activeHeroSlide?.photo !== activeUrl) return;

      if (typeof window.requestIdleCallback === 'function') {
        this.heroPrefetchIdleHandle = window.requestIdleCallback(() => {
          this.heroPrefetchIdleHandle = null;
          this.prefetchHeroSlide(nextSlide);
        }, { timeout: 2000 });
        return;
      }

      this.prefetchHeroSlide(nextSlide);
    }, this.heroPrefetchDelayMs);
  }

  private prefetchHeroSlide(slide: HeroSlide): void {
    const url = slide.photo;
    if (
      typeof window === 'undefined'
      || this.shouldSkipHeroPrefetch()
      || this.heroPrefetchImage
      || this.requestedHeroUrls.has(url)
    ) return;

    // The active slide may have changed while this callback waited for idle time.
    const nextSlide = this.heroSlides[(this.activeHeroIndex + 1) % this.heroSlides.length];
    if (nextSlide?.photo !== url) return;

    this.requestedHeroUrls.add(url);
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = 'low';
    if (slide.srcset) {
      image.srcset = slide.srcset;
      image.sizes = '100vw';
    }
    this.heroPrefetchImage = image;

    const complete = () => {
      if (this.heroPrefetchImage !== image) return;
      image.onload = null;
      image.onerror = null;
      this.heroPrefetchImage = null;
      this.scheduleNextHeroPrefetch();
    };

    image.onload = complete;
    image.onerror = complete;
    image.src = slide.displaySrc || url;
  }

  private createHeroSlide(photo: string, alt: string): HeroSlide {
    const source = String(photo || '').trim();
    if (!source) return { photo: '', alt };

    try {
      const parsed = new URL(source);
      if (parsed.hostname.toLowerCase() !== 'images.unsplash.com') {
        return { photo: source, alt };
      }

      const buildVariant = (width: number): string => {
        const variant = new URL(parsed.toString());
        variant.searchParams.set('auto', 'format');
        variant.searchParams.set('fit', 'crop');
        variant.searchParams.delete('fm');
        variant.searchParams.set('q', '72');
        variant.searchParams.set('w', String(width));
        return variant.toString();
      };
      const widths = [640, 960, 1280, 1600];

      return {
        photo: source,
        alt,
        displaySrc: buildVariant(1600),
        srcset: widths.map(width => `${buildVariant(width)} ${width}w`).join(', ')
      };
    } catch {
      return { photo: source, alt };
    }
  }

  private shouldSkipHeroPrefetch(): boolean {
    if (typeof navigator === 'undefined') return false;
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (!connection) return false;

    const effectiveType = String(connection.effectiveType || '').toLowerCase();
    return connection.saveData === true || effectiveType === 'slow-2g' || effectiveType === '2g';
  }

  private cancelScheduledHeroPrefetch(): void {
    if (this.heroPrefetchIdleHandle !== null && typeof window !== 'undefined') {
      window.cancelIdleCallback?.(this.heroPrefetchIdleHandle);
      this.heroPrefetchIdleHandle = null;
    }
    if (this.heroPrefetchTimeoutHandle !== null) {
      clearTimeout(this.heroPrefetchTimeoutHandle);
      this.heroPrefetchTimeoutHandle = null;
    }
  }

  private cancelHeroPrefetch(): void {
    this.cancelScheduledHeroPrefetch();
    if (!this.heroPrefetchImage) return;
    this.heroPrefetchImage.onload = null;
    this.heroPrefetchImage.onerror = null;
    this.heroPrefetchImage = null;
  }

  private clearResumeCooldown(): void {
    if (!this.resumeCooldownHandle) return;
    clearTimeout(this.resumeCooldownHandle);
    this.resumeCooldownHandle = null;
  }

  onHeroImageError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img || img.dataset['fallbackApplied'] === '1') return;
    img.dataset['fallbackApplied'] = '1';
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.src = '/og-image.png';
  }

  private tryRestoreViewState(): void {
    if (this.viewStateRestored || !this.heroContentResolved) return;

    const state = this.routeViewState.getState<LandingViewState>(this.routeKey);
    if (!state) {
      this.viewStateRestored = true;
      void this.routeViewState.restoreScrollFinal(this.routeKey, 0);
      return;
    }

    if (state && Number.isFinite(Number(state.activeHeroIndex)) && this.heroSlides.length > 0) {
      const requestedIndex = Number(state.activeHeroIndex);
      this.activeHeroIndex = Math.min(Math.max(0, requestedIndex), this.heroSlides.length - 1);
    }

    this.viewStateRestored = true;
    void this.routeViewState.restoreScrollFinal(this.routeKey, 0);
  }

  private persistViewState(): void {
    this.routeViewState.setState<LandingViewState>(this.routeKey, {
      activeHeroIndex: this.activeHeroIndex,
      scrollY: typeof window !== 'undefined' ? this.lastScrollY || window.scrollY : 0
    });
  }
}
