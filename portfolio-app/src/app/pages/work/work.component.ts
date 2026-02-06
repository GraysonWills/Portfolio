import { Component, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { LinkedInDataService } from '../../services/linkedin-data.service';
import { RedisContent, PageID, PageContentID } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-work',
  standalone: false,
  templateUrl: './work.component.html',
  styleUrl: './work.component.scss'
})
export class WorkComponent implements OnInit {
  workContent: RedisContent[] = [];
  timelineEvents: Array<Record<string, unknown>> = [];
  topSkills: string[] = [];
  certifications: Array<{name: string; issuer: string; date?: string}> = [];
  experienceData: any[] = [];
  isLoading: boolean = true;
  private loadCount = 0;

  constructor(
    private redisService: RedisService,
    private linkedInService: LinkedInDataService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.loadWorkContent();
    this.loadLinkedInData();
  }

  /**
   * Load work page content from Redis
   */
  private loadWorkContent(): void {
    this.redisService.getWorkPageContent().subscribe({
      next: (content: RedisContent[]) => {
        this.workContent = content;
        this.processWorkContent();
        this.checkLoaded();
      },
      error: (error) => {
        console.error('Error loading work content:', error);
        this.checkLoaded();
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load work page content'
        });
      }
    });
  }

  /**
   * Process work content into timeline events
   */
  private processWorkContent(): void {
    const workTextItems = this.workContent.filter(
      item => item.PageContentID === PageContentID.WorkText
    );

    this.timelineEvents = workTextItems
      .filter(item => item.ListItemID?.startsWith('experience-'))
      .map((item, index) => {
        try {
          const data = JSON.parse(item.Text || '{}');
          return {
            status: data.company || 'Company',
            icon: 'pi pi-briefcase',
            color: '#667eea',
            content: `
              <h3>${data.title}</h3>
              <p><strong>${data.company}</strong> - ${data.location}</p>
              <p><em>${data.startDate} - ${data.endDate || 'Present'}</em></p>
              ${data.description ? `<p>${data.description.join(' ')}</p>` : ''}
              ${data.achievements ? `
                <ul>
                  ${data.achievements.map((a: string) => `<li>${a}</li>`).join('')}
                </ul>
              ` : ''}
            `
          };
        } catch (e) {
          return {
            status: 'Work Experience',
            icon: 'pi pi-briefcase',
            color: '#667eea',
            content: item.Text || ''
          };
        }
      });
  }

  /**
   * Load LinkedIn data
   */
  private loadLinkedInData(): void {
    this.linkedInService.getLinkedInProfile().subscribe({
      next: (profile) => {
        this.topSkills = profile.topSkills;
        this.certifications = profile.certifications;
        this.experienceData = profile.experience;
        this.processExperienceData();
        this.checkLoaded();
      },
      error: (error) => {
        console.error('Error loading LinkedIn data:', error);
        this.checkLoaded();
      }
    });
  }

  /**
   * Process experience data into timeline
   */
  private processExperienceData(): void {
    if (this.experienceData.length > 0) {
      this.timelineEvents = this.experienceData.map((exp) => ({
        status: exp.company,
        icon: 'pi pi-briefcase',
        color: '#667eea',
        content: `
          <h3>${exp.title}</h3>
          <p><strong>${exp.company}</strong> - ${exp.location}</p>
          <p><em>${exp.startDate} - ${exp.endDate || 'Present'}</em></p>
          ${exp.description ? `<p>${exp.description.join(' ')}</p>` : ''}
          ${exp.achievements ? `
            <ul>
              ${exp.achievements.map((a: string) => `<li>${a}</li>`).join('')}
            </ul>
          ` : ''}
        `
      }));
    }
  }

  /**
   * Mark one data source as loaded; hide skeleton when both resolve
   */
  private checkLoaded(): void {
    this.loadCount++;
    if (this.loadCount >= 2) {
      this.isLoading = false;
    }
  }

  /**
   * Calculate career progress percentage
   */
  getCareerProgress(): number {
    // Calculate based on years of experience or other metrics
    return 75; // Placeholder
  }
}
