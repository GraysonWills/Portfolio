import { Component, OnDestroy, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { LinkedInDataService } from '../../services/linkedin-data.service';
import { RedisContent, PageContentID } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';
import { AnalyticsService } from '../../services/analytics.service';

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
  private heroAutoplayHandle: ReturnType<typeof setInterval> | null = null;
  private readonly heroAutoplayMs = 5000;
  private readonly defaultHeroSlides: Array<{ photo: string; alt: string; order: number }> = [
    {
      photo: 'https://images.unsplash.com/photo-1639322537228-f710d846310a?w=1920&q=80',
      alt: 'Artificial intelligence neural network visualization',
      order: 1
    },
    {
      photo: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1920&q=80',
      alt: 'Machine learning data flow concept',
      order: 2
    },
    {
      photo: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1920&q=80',
      alt: 'Data analytics dashboard visualization',
      order: 3
    },
    {
      photo: 'https://images.unsplash.com/photo-1518432031352-d6fc5c10da5a?w=1920&q=80',
      alt: 'Abstract technology and coding environment',
      order: 4
    }
  ];

  constructor(
    private redisService: RedisService,
    private linkedInService: LinkedInDataService,
    private messageService: MessageService,
    private analytics: AnalyticsService
  ) {}

  ngOnInit(): void {
    this.loadLandingContent();
    this.loadLinkedInData();
    this.refreshHeroSlides();
    this.startHeroAutoplay();
  }

  ngOnDestroy(): void {
    this.stopHeroAutoplay();
  }

  private loadLandingContent(): void {
    this.redisService.getLandingPageContent().subscribe({
      next: (content: RedisContent[]) => {
        this.landingPhotos = content.filter(
          item => item.PageContentID === PageContentID.LandingPhoto
        );
        this.landingText = content.filter(
          item => item.PageContentID === PageContentID.LandingText
        );
        this.refreshHeroSlides();

        const summaryContent = this.landingText.find(
          item => item.Metadata?.['type'] === 'summary'
        );
        if (summaryContent?.Text) {
          this.summary = summaryContent.Text;
        }
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
    this.analytics.track('resume_download_clicked', {
      route: '/',
      page: 'home',
      metadata: { location: 'hero' }
    });
    if (typeof window !== 'undefined') {
      window.open('/assets/resume.pdf', '_blank');
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

  onHeroImageError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img || img.dataset['fallbackApplied'] === '1') return;
    img.dataset['fallbackApplied'] = '1';
    img.src = '/og-image.png';
  }
}
