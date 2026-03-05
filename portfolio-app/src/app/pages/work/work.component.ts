import { Component, OnInit, HostListener } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { LinkedInDataService } from '../../services/linkedin-data.service';
import { RedisContent, PageContentID, PageID } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';
import { forkJoin } from 'rxjs';

interface WorkTimelineEvent {
  id: string;
  title: string;
  company: string;
  location: string;
  period: string;
  description: string[];
  achievements: string[];
  markerColor: string;
  isCurrent: boolean;
  order: number;
}

interface CareerMetric {
  id: string;
  label: string;
  value: number;
  level: string;
  summary: string;
  order: number;
}

interface CommunityRole {
  id: string;
  role: string;
  organization: string;
  period: string;
  cause?: string;
  summary: string;
  isCurrent: boolean;
  order: number;
}

@Component({
  selector: 'app-work',
  standalone: false,
  templateUrl: './work.component.html',
  styleUrl: './work.component.scss'
})
export class WorkComponent implements OnInit {
  workContent: RedisContent[] = [];
  timelineEvents: WorkTimelineEvent[] = [];
  careerMetrics: CareerMetric[] = [];
  topSkills: string[] = [];
  certifications: Array<{name: string; issuer: string; date?: string}> = [];
  experienceData: any[] = [];
  communityRoles: CommunityRole[] = [];
  isLoading: boolean = true;
  timelineAlign: 'alternate' | 'left' = 'alternate';
  private loadCount = 0;
  private timelineNextToken: string | null = null;

  constructor(
    private redisService: RedisService,
    private linkedInService: LinkedInDataService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.updateTimelineAlign();
    this.loadWorkContent();
    this.loadLinkedInData();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateTimelineAlign();
  }

  private updateTimelineAlign(): void {
    this.timelineAlign = window.innerWidth <= 768 ? 'left' : 'alternate';
  }

  /**
   * Load work page content from Redis
   */
  private loadWorkContent(): void {
    forkJoin({
      metrics: this.redisService.getContentPageV2(PageID.Work, {
        limit: 20,
        fields: 'standard',
        contentIds: [PageContentID.WorkSkillMetric],
        sort: 'id_asc',
        cacheScope: 'route:/work:metrics'
      }),
      timeline: this.redisService.getContentPageV2(PageID.Work, {
        limit: 8,
        fields: 'standard',
        contentIds: [PageContentID.WorkText],
        sort: 'id_asc',
        cacheScope: 'route:/work:timeline'
      })
    }).subscribe({
      next: ({ metrics, timeline }) => {
        const metricItems = this.extractItems(metrics);
        const timelineItems = this.extractItems(timeline);
        this.workContent = this.mergeById([...metricItems, ...timelineItems]);
        this.processWorkContent();
        this.timelineNextToken = (timeline as any)?.nextToken || null;
        if (this.timelineNextToken) {
          this.loadNextTimelineChunk(this.timelineNextToken);
        }
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

  private loadNextTimelineChunk(nextToken: string): void {
    const token = String(nextToken || '').trim();
    if (!token) return;

    this.redisService.getContentPageV2(PageID.Work, {
      limit: 8,
      fields: 'standard',
      contentIds: [PageContentID.WorkText],
      sort: 'id_asc',
      nextToken: token,
      cacheScope: 'route:/work:timeline'
    }).subscribe({
      next: (response) => {
        const rows = this.extractItems(response);
        if (rows.length) {
          this.workContent = this.mergeById([...this.workContent, ...rows]);
          this.processWorkContent();
        }
        const next = (response as any)?.nextToken || null;
        if (next) {
          this.timelineNextToken = next;
          this.loadNextTimelineChunk(next);
        } else {
          this.timelineNextToken = null;
        }
      },
      error: () => {
        this.timelineNextToken = null;
      }
    });
  }

  private extractItems(response: any): RedisContent[] {
    if (Array.isArray(response?.items)) return response.items as RedisContent[];
    if (Array.isArray(response)) return response as RedisContent[];
    return [];
  }

  private mergeById(items: RedisContent[]): RedisContent[] {
    const map = new Map<string, RedisContent>();
    for (const item of items) {
      const id = String(item?.ID || '').trim();
      if (!id) continue;
      map.set(id, item);
    }
    return Array.from(map.values());
  }

  /**
   * Process work content into timeline events
   */
  private processWorkContent(): void {
    const workTextItems = this.workContent.filter(
      item => item.PageContentID === PageContentID.WorkText
    );

    const parsedTimeline = workTextItems
      .filter((item) => item.ListItemID?.startsWith('experience-'))
      .map((item, index) => this.parseTimelineItem(item, index))
      .filter((event): event is WorkTimelineEvent => event !== null)
      .sort((a, b) => a.order - b.order);

    if (parsedTimeline.length > 0) {
      this.timelineEvents = parsedTimeline;
    }

    const metricItems = this.workContent
      .filter((item) => item.PageContentID === PageContentID.WorkSkillMetric)
      .map((item, index) => this.parseMetricItem(item, index))
      .filter((metric): metric is CareerMetric => metric !== null)
      .sort((a, b) => a.order - b.order);

    if (metricItems.length > 0) {
      this.careerMetrics = metricItems;
    }
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
        this.communityRoles = (profile.communityService || []).map((item, index) => ({
          id: `community-${index + 1}`,
          role: item.role,
          organization: item.organization,
          period: `${item.startDate} - ${item.endDate || 'Present'}`,
          cause: item.cause,
          summary: item.summary,
          isCurrent: !item.endDate || item.endDate === 'Present',
          order: index + 1
        }));
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
    if (this.timelineEvents.length === 0 && this.experienceData.length > 0) {
      this.timelineEvents = this.experienceData.map((exp, index) => ({
        id: `linkedin-exp-${index}`,
        title: exp.title || 'Role',
        company: exp.company || 'Company',
        location: exp.location || 'Location unavailable',
        period: `${exp.startDate || 'Unknown'} - ${exp.endDate || 'Present'}`,
        description: Array.isArray(exp.description) ? exp.description : [],
        achievements: Array.isArray(exp.achievements) ? exp.achievements : [],
        markerColor: exp.endDate ? '#0b4f9f' : '#2f9e6f',
        isCurrent: !exp.endDate || exp.endDate === 'Present',
        order: index + 1
      }));
    }

    if (this.careerMetrics.length === 0) {
      this.careerMetrics = [
        {
          id: 'metric-systems',
          label: 'AI Systems Architecture',
          value: 86,
          level: 'Advanced',
          summary: 'Platform-minded architecture and deployment of production data + AI workflows',
          order: 1
        },
        {
          id: 'metric-analytics',
          label: 'Analytics Storytelling',
          value: 90,
          level: 'Advanced',
          summary: 'Converting complex model and data outputs into high-confidence executive decisions',
          order: 2
        },
        {
          id: 'metric-computer-vision',
          label: 'Computer Vision',
          value: 74,
          level: 'Developing',
          summary: 'Active growth area through proof-of-concepts and applied production experiments',
          order: 3
        },
        {
          id: 'metric-leadership',
          label: 'Cross-Functional Leadership',
          value: 81,
          level: 'Strong',
          summary: 'Driving outcomes across investigation, engineering, and stakeholder teams',
          order: 4
        }
      ];
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
    if (this.careerMetrics.length === 0) {
      return 0;
    }
    const total = this.careerMetrics.reduce((sum, metric) => sum + metric.value, 0);
    return Math.round(total / this.careerMetrics.length);
  }

  getMetricTone(metric: CareerMetric): 'elite' | 'strong' | 'developing' | 'emerging' {
    if (metric.value >= 90) {
      return 'elite';
    }
    if (metric.value >= 80) {
      return 'strong';
    }
    if (metric.value >= 70) {
      return 'developing';
    }
    return 'emerging';
  }

  private parseTimelineItem(item: RedisContent, index: number): WorkTimelineEvent | null {
    try {
      const parsed = JSON.parse(item.Text || '{}');
      const startDate = parsed.startDate || 'Unknown';
      const endDate = parsed.endDate || 'Present';
      return {
        id: item.ID,
        title: parsed.title || 'Role',
        company: parsed.company || 'Company',
        location: parsed.location || 'Location unavailable',
        period: `${startDate} - ${endDate}`,
        description: Array.isArray(parsed.description) ? parsed.description : [],
        achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
        markerColor: endDate === 'Present' ? '#2f9e6f' : '#0b4f9f',
        isCurrent: endDate === 'Present',
        order: Number(item.Metadata?.['order']) || index + 1
      };
    } catch (error) {
      if (!item.Text) {
        return null;
      }
      return {
        id: item.ID,
        title: 'Work Experience',
        company: 'Career Entry',
        location: 'Location unavailable',
        period: 'Timeline record',
        description: [item.Text],
        achievements: [],
        markerColor: '#0b4f9f',
        isCurrent: false,
        order: Number(item.Metadata?.['order']) || index + 1
      };
    }
  }

  private parseMetricItem(item: RedisContent, index: number): CareerMetric | null {
    try {
      const parsed = JSON.parse(item.Text || '{}');
      if (!parsed.label) {
        return null;
      }
      return {
        id: item.ID,
        label: parsed.label,
        value: Math.max(0, Math.min(100, Number(parsed.value) || 0)),
        level: parsed.level || 'Growing',
        summary: parsed.summary || '',
        order: Number(item.Metadata?.['order']) || index + 1
      };
    } catch (error) {
      return null;
    }
  }
}
