import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { LinkedInDataService } from '../../services/linkedin-data.service';
import { RedisContent, PageContentID, PageID } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';
import { AnalyticsService } from '../../services/analytics.service';
import { RouteViewStateService } from '../../services/route-view-state.service';

interface LandingViewState extends Record<string, unknown> {
  scrollY?: number;
  activeHeroIndex?: number;
  updatedAt?: number;
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
  heroSlides: Array<{ photo: string; alt: string }> = [];
  activeHeroIndex: number = 0;
  isResumeCooldown = false;
  private heroAutoplayHandle: ReturnType<typeof setInterval> | null = null;
  private resumeCooldownHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly heroAutoplayMs = 5000;
  private readonly routeKey = '/';
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
    private routeViewState: RouteViewStateService
  ) {}

  ngOnInit(): void {
    this.routeViewState.primeRestore(this.routeKey);
    this.routeViewState.restoreScrollImmediate(this.routeKey);
    this.loadLandingContent();
    this.loadLinkedInData();
    this.refreshHeroSlides();
    this.startHeroAutoplay();
  }

  ngOnDestroy(): void {
    this.persistViewState();
    this.stopHeroAutoplay();
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
        this.refreshHeroSlides();
        this.tryRestoreViewState();
      },
      error: (error) => {
        console.error('Error loading landing content:', error);
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
        this.topSkills = profile.topSkills;
        this.certifications = profile.certifications;
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
    this.activeHeroIndex = ((index % this.heroSlides.length) + this.heroSlides.length) % this.heroSlides.length;
    this.persistViewState();
    this.startHeroAutoplay();
  }

  nextHeroSlide(): void {
    if (this.heroSlides.length <= 1) return;
    this.activeHeroIndex = (this.activeHeroIndex + 1) % this.heroSlides.length;
  }

  private refreshHeroSlides(): void {
    const items = this.landingPhotos
      .filter(item => item.Photo)
      .sort((a, b) => {
        const aOrder = Number(a.Metadata?.['order']) || Number.MAX_SAFE_INTEGER;
        const bOrder = Number(b.Metadata?.['order']) || Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      })
      .map(item => ({
        photo: item.Photo as string,
        alt: item.Metadata?.['alt'] || 'Portfolio hero image'
      }));

    this.heroSlides = items.length > 0
      ? items
      : this.defaultHeroSlides.map(({ photo, alt }) => ({ photo, alt }));

    if (this.activeHeroIndex >= this.heroSlides.length) {
      this.activeHeroIndex = 0;
    }
    this.startHeroAutoplay();
  }

  private startHeroAutoplay(): void {
    this.stopHeroAutoplay();
    if (typeof window === 'undefined' || this.heroSlides.length <= 1) return;
    this.heroAutoplayHandle = setInterval(() => this.nextHeroSlide(), this.heroAutoplayMs);
  }

  private stopHeroAutoplay(): void {
    if (!this.heroAutoplayHandle) return;
    clearInterval(this.heroAutoplayHandle);
    this.heroAutoplayHandle = null;
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
    img.src = '/og-image.png';
  }

  private tryRestoreViewState(): void {
    if (this.viewStateRestored) return;

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
