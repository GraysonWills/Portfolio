import { Component, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { RedisContent, PageID, PageContentID, ContentGroup } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';

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

@Component({
  selector: 'app-projects',
  standalone: false,
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.scss'
})
export class ProjectsComponent implements OnInit {
  projectsContent: RedisContent[] = [];
  categoryGroups: ContentGroup[] = [];
  isLoading: boolean = true;

  /** Tracks which category accordions are expanded */
  expandedCategories: Record<string, boolean> = {};

  constructor(
    private redisService: RedisService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.loadProjectsContent();
  }

  /**
   * Load projects page content from Redis
   */
  private loadProjectsContent(): void {
    this.redisService.getProjectsPageContent().subscribe({
      next: (content: RedisContent[]) => {
        this.projectsContent = content;
        this.processProjectsContent();
        this.isLoading = false;
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

  /**
   * Process projects content into category groups.
   * Each category may contain multiple projects (text + photo pairs).
   */
  private processProjectsContent(): void {
    const categories = this.projectsContent
      .filter(item => item.PageContentID === PageContentID.ProjectsCategoryText)
      .map(item => {
        try {
          const categoryData = JSON.parse(item.Text || '{}');
          return {
            name: categoryData.name || 'Uncategorized',
            listItemID: item.ListItemID || 'default'
          };
        } catch (e) {
          return {
            name: item.Text || 'Uncategorized',
            listItemID: item.ListItemID || 'default'
          };
        }
      });

    this.categoryGroups = categories.map(category => {
      const categoryPhoto = this.projectsContent.find(
        item => item.PageContentID === PageContentID.ProjectsCategoryPhoto &&
                item.ListItemID === category.listItemID
      );

      const projects = this.projectsContent.filter(
        item => (item.PageContentID === PageContentID.ProjectsPhoto ||
                 item.PageContentID === PageContentID.ProjectsText) &&
                item.ListItemID === category.listItemID
      );

      const group: ContentGroup = {
        listItemID: category.listItemID,
        items: projects,
        metadata: {
          categoryName: category.name,
          categoryPhoto: categoryPhoto?.Photo
        } as Record<string, unknown>
      };
      return group;
    });

    // Expand all categories by default
    this.categoryGroups.forEach(cat => {
      this.expandedCategories[cat.listItemID] = true;
    });
  }

  /**
   * Get all individual projects within a category group.
   * A single category can contain multiple ProjectsText items.
   */
  getProjectsInCategory(group: ContentGroup): ProjectItem[] {
    const textItems = group.items.filter(
      item => item.PageContentID === PageContentID.ProjectsText
    );
    const photoItems = group.items.filter(
      item => item.PageContentID === PageContentID.ProjectsPhoto
    );

    return textItems.map((textItem, index) => {
      try {
        const data = JSON.parse(textItem.Text || '{}');
        return {
          ...data,
          photo: photoItems[index]?.Photo,
          listItemID: group.listItemID
        } as ProjectItem;
      } catch (e) {
        return {
          text: textItem.Text || '',
          title: 'Project',
          description: textItem.Text || '',
          photo: photoItems[index]?.Photo,
          listItemID: group.listItemID
        } as ProjectItem;
      }
    });
  }

  /**
   * Toggle accordion expand/collapse for a category
   */
  toggleCategory(listItemID: string): void {
    this.expandedCategories[listItemID] = !this.expandedCategories[listItemID];
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
    return category.items.filter(
      item => item.PageContentID === PageContentID.ProjectsText
    ).length;
  }
}
