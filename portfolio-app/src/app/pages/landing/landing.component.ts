import { Component, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { LinkedInDataService } from '../../services/linkedin-data.service';
import { RedisContent, PageID, PageContentID } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';
import { AnalyticsService } from '../../services/analytics.service';

@Component({
  selector: 'app-landing',
  standalone: false,
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss'
})
export class LandingComponent implements OnInit {
  landingPhotos: RedisContent[] = [];
  landingText: RedisContent[] = [];
  summary: string = '';
  contactInfo: any = {};
  topSkills: string[] = [];
  certifications: Array<{name: string; issuer: string; date?: string}> = [];
  education: Array<{degree: string; institution: string; location: string; graduationDate?: string}> = [];

  constructor(
    private redisService: RedisService,
    private linkedInService: LinkedInDataService,
    private messageService: MessageService,
    private analytics: AnalyticsService
  ) {}

  ngOnInit(): void {
    this.loadLandingContent();
    this.loadLinkedInData();
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

  getCarouselItems(): { photo: string; alt: string }[] {
    return this.landingPhotos
      .filter(item => item.Photo)
      .map(item => ({
        photo: item.Photo as string,
        alt: item.Metadata?.['alt'] || 'Portfolio hero image'
      }));
  }
}
