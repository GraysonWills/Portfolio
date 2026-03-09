import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { RedisContent, PageContentID, ContentGroup, PageID } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';
import { RouteViewStateService } from '../../services/route-view-state.service';
import { firstValueFrom } from 'rxjs';

interface ProjectItem {
  title: string;
  description: string;
  text?: string;
  photo?: string;
  techStack?: string[];
  githubUrl?: string;
  liveUrl?: string;
  date?: string;
  listItemID: string;
}

interface ProjectsViewState extends Record<string, unknown> {
  expandedCategories?: Record<string, boolean>;
  visibleCategoryCount?: number;
  scrollY?: number;
  updatedAt?: number;
}

@Component({
  selector: 'app-projects',
  standalone: false,
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.scss'
})
export class ProjectsComponent implements OnInit, OnDestroy {
  projectsContent: RedisContent[] = [];
  categoryGroups: ContentGroup[] = [];
  visibleCategories: ContentGroup[] = [];
  isLoading: boolean = true;
  private projectsByCategory = new Map<string, ProjectItem[]>();

  /** Tracks which category accordions are expanded */
  expandedCategories: Record<string, boolean> = {};
  private visibleCategoryCount = 0;
  private readonly categoryPageSize = 4;
  private readonly scrollLoadBufferPx = 500;
  private loadingCategoryIds = new Set<string>();
  private categoriesNextToken: string | null = null;
  private isFetchingCategoryPage = false;
  private readonly routeKey = '/projects';
  private viewStateRestored = false;
  private lastScrollY = 0;

  constructor(
    private redisService: RedisService,
    private messageService: MessageService,
    private routeViewState: RouteViewStateService
  ) {}

  ngOnInit(): void {
    this.routeViewState.restoreScrollImmediate(this.routeKey);
    this.loadProjectsContent();
  }

  ngOnDestroy(): void {
    this.persistViewState();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (typeof window !== 'undefined') {
      this.lastScrollY = window.scrollY;
    }
    if (this.isLoading || !this.hasMoreCategories) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const viewportBottom = window.scrollY + window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    if ((documentHeight - viewportBottom) <= this.scrollLoadBufferPx) {
      this.loadMoreCategories();
    }
  }

  /**
   * Load projects page content from Redis
   */
  private loadProjectsContent(): void {
    this.redisService.getProjectsCategoriesV3({
      limit: 12,
      cacheScope: 'route:/projects:categories'
    }).subscribe({
      next: (response) => {
        const content = this.mapCategoriesToContent(response?.items || []);
        this.categoriesNextToken = response?.nextToken || null;
        this.projectsContent = content;
        this.processProjectsContent();
        this.isLoading = false;
        void this.restoreViewState();
      },
      error: (error) => {
        console.error('Error loading projects content:', error);
        this.isLoading = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load projects page content'
        });
      }
    });
  }

  private async loadNextCategoryChunk(): Promise<boolean> {
    const token = String(this.categoriesNextToken || '').trim();
    if (!token || this.isFetchingCategoryPage) return false;

    this.isFetchingCategoryPage = true;
    try {
      const response = await firstValueFrom(this.redisService.getProjectsCategoriesV3({
        limit: 12,
        nextToken: token,
        cacheScope: 'route:/projects:categories'
      }));
      const rows = this.mapCategoriesToContent(response?.items || []);
      if (rows.length) {
        this.projectsContent = this.mergeById([...this.projectsContent, ...rows]);
        this.processProjectsContent(false);
      }
      this.categoriesNextToken = response?.nextToken || null;
      return rows.length > 0;
    } catch {
      this.categoriesNextToken = null;
      return false;
    } finally {
      this.isFetchingCategoryPage = false;
    }
  }

  /**
   * Process projects content into category groups.
   * Each category may contain multiple projects (text + photo pairs).
   */
  private processProjectsContent(resetVisible: boolean = true): void {
    this.projectsByCategory.clear();

    const categories = this.projectsContent
      .filter(item => item.PageContentID === PageContentID.ProjectsCategoryText)
      .map((item, index) => {
        try {
          const categoryData = JSON.parse(item.Text || '{}');
          return {
            name: categoryData.name || 'Uncategorized',
            listItemID: item.ListItemID || 'default',
            order: this.getItemOrder(item, index + 1)
          };
        } catch (e) {
          return {
            name: item.Text || 'Uncategorized',
            listItemID: item.ListItemID || 'default',
            order: this.getItemOrder(item, index + 1)
          };
        }
      })
      .sort((a, b) => a.order - b.order);

    this.categoryGroups = categories.map(category => {
      const categoryPhoto = this.projectsContent.find(
        item => item.PageContentID === PageContentID.ProjectsCategoryPhoto &&
                item.ListItemID === category.listItemID
      );

      const group: ContentGroup = {
        listItemID: category.listItemID,
        items: [],
        metadata: {
          categoryName: category.name,
          categoryPhoto: categoryPhoto?.Photo,
          order: category.order
        } as Record<string, unknown>
      };
      return group;
    });

    const nextExpanded: Record<string, boolean> = {};
    this.categoryGroups.forEach((cat) => {
      nextExpanded[cat.listItemID] = this.expandedCategories[cat.listItemID] ?? true;
    });
    this.expandedCategories = nextExpanded;

    if (resetVisible) {
      this.resetVisibleCategories();
      return;
    }

    const retainCount = Math.max(this.visibleCategoryCount, this.visibleCategories.length, this.categoryPageSize);
    this.visibleCategoryCount = retainCount;
    this.visibleCategories = this.categoryGroups.slice(0, this.visibleCategoryCount);
    const needsHydration = this.visibleCategories
      .filter((category) => this.expandedCategories[category.listItemID] && !this.projectsByCategory.has(category.listItemID))
      .map((category) => category.listItemID);
    this.hydrateProjectsForCategories(needsHydration);
  }

  /**
   * Get all individual projects within a category group.
   * A single category can contain multiple ProjectsText items.
   */
  getProjectsInCategory(group: ContentGroup): ProjectItem[] {
    return this.projectsByCategory.get(group.listItemID) || [];
  }

  private buildProjectsForCategory(items: RedisContent[], listItemID: string): ProjectItem[] {
    const textItems = items.filter(
      item => item.PageContentID === PageContentID.ProjectsText
    ).sort((a, b) => this.compareByOrderThenId(a, b));
    const photoItems = items.filter(
      item => item.PageContentID === PageContentID.ProjectsPhoto
    ).sort((a, b) => this.compareByOrderThenId(a, b));

    return textItems.map((textItem, index) => {
      try {
        const data = JSON.parse(textItem.Text || '{}');
        return {
          ...data,
          photo: photoItems[index]?.Photo,
          listItemID
        } as ProjectItem;
      } catch (e) {
        return {
          text: textItem.Text || '',
          title: 'Project',
          description: textItem.Text || '',
          photo: photoItems[index]?.Photo,
          listItemID
        } as ProjectItem;
      }
    });
  }

  private compareByOrderThenId(a: RedisContent, b: RedisContent): number {
    const orderDelta = this.getItemOrder(a) - this.getItemOrder(b);
    if (orderDelta !== 0) return orderDelta;
    return String(a.ID || '').localeCompare(String(b.ID || ''));
  }

  private getItemOrder(item: RedisContent, fallback: number = Number.MAX_SAFE_INTEGER): number {
    const raw = Number(item?.Metadata?.['order']);
    if (Number.isFinite(raw) && raw > 0) return raw;
    return fallback;
  }

  /**
   * Toggle accordion expand/collapse for a category
   */
  toggleCategory(listItemID: string): void {
    const next = !this.expandedCategories[listItemID];
    this.expandedCategories[listItemID] = next;
    if (next && !this.projectsByCategory.has(listItemID)) {
      this.hydrateProjectsForCategories([listItemID]);
    }
    this.persistViewState();
  }

  /**
   * Check if a category is expanded
   */
  isCategoryExpanded(listItemID: string): boolean {
    return !!this.expandedCategories[listItemID];
  }

  /**
   * Open external URL
   */
  openUrl(url: string): void {
    if (typeof window !== 'undefined' && url) {
      window.open(url, '_blank');
    }
  }

  /**
   * Get category name from metadata
   */
  getCategoryName(category: ContentGroup): string | null {
    if (!category.metadata) return null;
    const metadata = category.metadata as Record<string, unknown>;
    return metadata['categoryName'] as string || null;
  }

  /**
   * Get category photo from metadata
   */
  getCategoryPhoto(category: ContentGroup): string | null {
    if (!category.metadata) return null;
    const metadata = category.metadata as Record<string, unknown>;
    return metadata['categoryPhoto'] as string || null;
  }

  /**
   * Get project count for a category
   */
  getProjectCount(category: ContentGroup): number {
    return this.getProjectsInCategory(category).length;
  }

  isCategoryLoading(listItemID: string): boolean {
    return this.loadingCategoryIds.has(listItemID);
  }

  private hydrateProjectsForCategories(listItemIDs: string[]): void {
    const keys = Array.from(
      new Set(
        (Array.isArray(listItemIDs) ? listItemIDs : [])
          .map((id) => String(id || '').trim())
          .filter((id) => !!id && !this.loadingCategoryIds.has(id) && !this.projectsByCategory.has(id))
      )
    );
    if (!keys.length) return;

    keys.forEach((key) => this.loadingCategoryIds.add(key));
    this.redisService.getProjectItemsV3(keys, { cacheScope: 'route:/projects:category-items' }).subscribe({
      next: (response) => {
        for (const key of keys) {
          const rows = Array.isArray(response?.[key]) ? response[key] : [];
          const parsedProjects = this.buildProjectsForCategory(rows, key);
          this.projectsByCategory.set(key, parsedProjects);
          this.loadingCategoryIds.delete(key);
        }
      },
      error: () => {
        for (const key of keys) {
          this.loadingCategoryIds.delete(key);
          this.projectsByCategory.set(key, []);
        }
      }
    });
  }

  private mergeById(items: RedisContent[]): RedisContent[] {
    const map = new Map<string, RedisContent>();
    for (const item of items || []) {
      const id = String(item?.ID || '').trim();
      if (!id) continue;
      map.set(id, item);
    }
    return Array.from(map.values());
  }

  get hasMoreCategories(): boolean {
    return this.visibleCategories.length < this.categoryGroups.length || !!this.categoriesNextToken;
  }

  loadMoreCategories(): void {
    if (this.visibleCategories.length < this.categoryGroups.length) {
      this.visibleCategoryCount += this.categoryPageSize;
      this.visibleCategories = this.categoryGroups.slice(0, this.visibleCategoryCount);
    }
    const needsHydration = this.visibleCategories
      .filter((category) => this.expandedCategories[category.listItemID] && !this.projectsByCategory.has(category.listItemID))
      .map((category) => category.listItemID);
    this.hydrateProjectsForCategories(needsHydration);
    if (this.categoriesNextToken && this.visibleCategories.length >= (this.categoryGroups.length - 2)) {
      void this.loadNextCategoryChunk();
    }
    this.persistViewState();
  }

  private resetVisibleCategories(): void {
    this.visibleCategoryCount = this.categoryPageSize;
    this.visibleCategories = this.categoryGroups.slice(0, this.visibleCategoryCount);
    const needsHydration = this.visibleCategories
      .filter((category) => this.expandedCategories[category.listItemID] && !this.projectsByCategory.has(category.listItemID))
      .map((category) => category.listItemID);
    this.hydrateProjectsForCategories(needsHydration);
  }

  trackByCategory(index: number, category: ContentGroup): string {
    return category.listItemID || `${index}`;
  }

  trackByProject(index: number, project: ProjectItem): string {
    return `${project.listItemID}-${project.title || 'project'}-${index}`;
  }

  trackByTech(index: number, tech: string): string {
    return `${tech}-${index}`;
  }

  private mapCategoriesToContent(items: Array<any>): RedisContent[] {
    return (Array.isArray(items) ? items : []).flatMap((item, index) => {
      const listItemID = String(item?.listItemID || '').trim();
      if (!listItemID) return [];

      const rows: RedisContent[] = [
        {
          ID: `projects-category-text-${listItemID}`,
          PageID: PageID.Projects,
          PageContentID: PageContentID.ProjectsCategoryText,
          ListItemID: listItemID,
          Text: JSON.stringify({
            name: item?.name || 'Uncategorized',
            description: item?.description || ''
          }),
          Metadata: {
            order: Number(item?.order || index + 1)
          }
        }
      ];

      if (item?.categoryPhoto) {
        rows.push({
          ID: `projects-category-photo-${listItemID}`,
          PageID: PageID.Projects,
          PageContentID: PageContentID.ProjectsCategoryPhoto,
          ListItemID: listItemID,
          Photo: item.categoryPhoto,
          Metadata: {
            order: Number(item?.order || index + 1)
          }
        });
      }

      return rows;
    });
  }

  private async restoreViewState(): Promise<void> {
    if (this.viewStateRestored) return;

    const state = this.routeViewState.getState<ProjectsViewState>(this.routeKey);
    if (!state) {
      this.viewStateRestored = true;
      return;
    }

    const desiredVisibleCount = Math.max(
      this.categoryPageSize,
      Number(state.visibleCategoryCount) || this.categoryPageSize
    );

    while (this.categoryGroups.length < desiredVisibleCount && !!this.categoriesNextToken) {
      const loaded = await this.loadNextCategoryChunk();
      if (!loaded) break;
    }

    if (state.expandedCategories) {
      this.expandedCategories = {
        ...this.expandedCategories,
        ...state.expandedCategories
      };
    }

    this.visibleCategoryCount = Math.min(
      Math.max(this.categoryPageSize, desiredVisibleCount),
      Math.max(this.categoryGroups.length, this.categoryPageSize)
    );
    this.visibleCategories = this.categoryGroups.slice(0, this.visibleCategoryCount);

    const needsHydration = this.visibleCategories
      .filter((category) => this.expandedCategories[category.listItemID] && !this.projectsByCategory.has(category.listItemID))
      .map((category) => category.listItemID);
    this.hydrateProjectsForCategories(needsHydration);

    this.viewStateRestored = true;
    await this.routeViewState.restoreScrollFinal(this.routeKey);
  }

  private persistViewState(): void {
    this.routeViewState.setState<ProjectsViewState>(this.routeKey, {
      expandedCategories: { ...this.expandedCategories },
      visibleCategoryCount: this.visibleCategoryCount || this.categoryPageSize,
      scrollY: typeof window !== 'undefined' ? this.lastScrollY || window.scrollY : 0
    });
  }
}
