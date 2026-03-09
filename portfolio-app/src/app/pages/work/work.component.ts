import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { LinkedInDataService } from '../../services/linkedin-data.service';
import { RedisContent, PageContentID } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';
import { RouteViewStateService } from '../../services/route-view-state.service';

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

interface WorkViewState extends Record<string, unknown> {
  timelineItemCount?: number;
  scrollY?: number;
  updatedAt?: number;
}

@Component({
  selector: 'app-work',
  standalone: false,
  templateUrl: './work.component.html',
  styleUrl: './work.component.scss'
})
export class WorkComponent implements OnInit, OnDestroy {
  workContent: RedisContent[] = [];
  timelineEvents: WorkTimelineEvent[] = [];
  careerMetrics: CareerMetric[] = [];
  topSkills: string[] = [];
  certifications: Array<{name: string; issuer: string; date?: string}> = [];
  experienceData: any[] = [];
  communityRoles: CommunityRole[] = [];
  isLoading: boolean = true;
  timelineAlign: 'alternate' | 'left' = 'alternate';
  isCompactTimeline: boolean = false;
  private loadCount = 0;
  private timelineNextToken: string | null = null;
  private isFetchingTimeline = false;
  private readonly scrollLoadBufferPx = 500;
  private readonly routeKey = '/work';
  private viewStateRestored = false;
  private lastScrollY = 0;

  constructor(
    private redisService: RedisService,
    private linkedInService: LinkedInDataService,
    private messageService: MessageService,
    private routeViewState: RouteViewStateService
  ) {}

  ngOnInit(): void {
    this.routeViewState.primeRestore(this.routeKey);
    this.routeViewState.restoreScrollImmediate(this.routeKey);
    this.updateTimelineAlign();
    this.loadWorkContent();
    this.loadLinkedInData();
  }

  ngOnDestroy(): void {
    this.persistViewState();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateTimelineAlign();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (typeof window !== 'undefined') {
      this.lastScrollY = window.scrollY;
    }
    this.routeViewState.captureScroll(this.routeKey);
    if (!this.timelineNextToken || this.isFetchingTimeline || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const viewportBottom = window.scrollY + window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    if ((documentHeight - viewportBottom) <= this.scrollLoadBufferPx) {
      void this.loadNextTimelineChunk();
    }
  }

  private updateTimelineAlign(): void {
    if (typeof window === 'undefined') return;
    this.isCompactTimeline = window.innerWidth <= 768;
    this.timelineAlign = this.isCompactTimeline ? 'left' : 'alternate';
  }

  /**
   * Load work page content from Redis
   */
  private loadWorkContent(): void {
    this.redisService.getWorkPayloadV3({
      limit: 8,
      cacheScope: 'route:/work'
    }).subscribe({
      next: (payload) => {
        const metricItems = Array.isArray(payload?.metrics) ? payload.metrics : [];
        const timelineItems = Array.isArray(payload?.timeline?.items) ? payload.timeline.items : [];
        this.workContent = this.mergeById([...metricItems, ...timelineItems]);
        this.processWorkContent();
        this.timelineNextToken = payload?.timeline?.nextToken || null;
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

  private async loadNextTimelineChunk(): Promise<boolean> {
    const token = String(this.timelineNextToken || '').trim();
    if (!token || this.isFetchingTimeline) return false;

    this.isFetchingTimeline = true;
    try {
      const payload = await firstValueFrom(this.redisService.getWorkPayloadV3({
        limit: 8,
        nextToken: token,
        cacheScope: 'route:/work'
      }));
      const rows = Array.isArray(payload?.timeline?.items) ? payload.timeline.items : [];
      if (rows.length) {
        this.workContent = this.mergeById([...this.workContent, ...rows]);
        this.processWorkContent();
      }
      this.timelineNextToken = payload?.timeline?.nextToken || null;
      return rows.length > 0;
    } catch {
      this.timelineNextToken = null;
      return false;
    } finally {
      this.isFetchingTimeline = false;
    }
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
      void this.restoreViewState();
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

  private async restoreViewState(): Promise<void> {
    if (this.viewStateRestored) return;

    const state = this.routeViewState.getState<WorkViewState>(this.routeKey);
    if (!state) {
      this.viewStateRestored = true;
      return;
    }

    const desiredCount = Math.max(this.timelineEvents.length, Number(state.timelineItemCount) || this.timelineEvents.length);
    while (this.timelineEvents.length < desiredCount && !!this.timelineNextToken) {
      const loaded = await this.loadNextTimelineChunk();
      if (!loaded) break;
    }

    this.viewStateRestored = true;
    await this.routeViewState.restoreScrollFinal(this.routeKey);
  }

  private persistViewState(): void {
    this.routeViewState.setState<WorkViewState>(this.routeKey, {
      timelineItemCount: this.timelineEvents.length,
      scrollY: typeof window !== 'undefined' ? this.lastScrollY || window.scrollY : 0
    });
  }
}
