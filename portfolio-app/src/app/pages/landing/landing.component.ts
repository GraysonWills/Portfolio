import { Component, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { LinkedInDataService } from '../../services/linkedin-data.service';
import { RedisContent, PageID, PageContentID } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';

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
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.loadLandingContent();
    this.loadLinkedInData();
  }

  /**
   * Load landing page content from Redis
   */
  private loadLandingContent(): void {
    this.redisService.getLandingPageContent().subscribe({
      next: (content: RedisContent[]) => {
        this.landingPhotos = content.filter(
          item => item.PageContentID === PageContentID.LandingPhoto
        );
        this.landingText = content.filter(
          item => item.PageContentID === PageContentID.LandingText
        );

        // Extract summary from landing text
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

  /**
   * Load LinkedIn profile data
   */
  private loadLinkedInData(): void {
    this.linkedInService.getLinkedInProfile().subscribe({
      next: (profile) => {
        // Only use LinkedIn summary as fallback
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

  /**
   * Download resume
   */
  downloadResume(): void {
    if (typeof window !== 'undefined') {
      window.open('/assets/resume.pdf', '_blank');
    }
  }

  /**
   * Open email client
   */
  openEmail(email: string): void {
    if (typeof window !== 'undefined' && email) {
      window.location.href = `mailto:${email}`;
    }
  }

  /**
   * Get carousel images
   */
  getCarouselImages(): string[] {
    return this.landingPhotos
      .filter(item => item.Photo)
      .map(item => item.Photo as string);
  }
}
