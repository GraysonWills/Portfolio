import { Component, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { RedisContent, PageID, PageContentID, ContentGroup } from '../../models/redis-content.model';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-projects',
  standalone: false,
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.scss'
})
export class ProjectsComponent implements OnInit {
  projectsContent: RedisContent[] = [];
  categoryGroups: ContentGroup[] = [];
  layout: 'list' | 'grid' = 'grid';
  sortField: string = 'date';
  sortOrder: number = -1;

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
      },
      error: (error) => {
        console.error('Error loading projects content:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load projects page content'
        });
      }
    });
  }

  /**
   * Process projects content into category groups
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

    // Group projects by category
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
  }

  /**
   * Get project data from content group
   */
  getProjectData(group: ContentGroup): any {
    const textItem = group.items.find(item => item.PageContentID === PageContentID.ProjectsText);
    const photoItem = group.items.find(item => item.PageContentID === PageContentID.ProjectsPhoto);
    
    try {
      const data = textItem ? JSON.parse(textItem.Text || '{}') : {};
      return {
        ...data,
        photo: photoItem?.Photo,
        listItemID: group.listItemID
      };
    } catch (e) {
      return {
        text: textItem?.Text || '',
        photo: photoItem?.Photo,
        listItemID: group.listItemID
      };
    }
  }

  /**
   * Toggle layout view
   */
  toggleLayout(): void {
    this.layout = this.layout === 'list' ? 'grid' : 'list';
  }

  /**
   * Sort projects
   */
  sortProjects(field: string): void {
    if (this.sortField === field) {
      this.sortOrder = this.sortOrder === 1 ? -1 : 1;
    } else {
      this.sortField = field;
      this.sortOrder = -1;
    }
    
    // Sort category groups
    this.categoryGroups.sort((a, b) => {
      const aData = this.getProjectData(a);
      const bData = this.getProjectData(b);
      const aValue = aData[field] || '';
      const bValue = bData[field] || '';
      return this.sortOrder * (aValue > bValue ? 1 : -1);
    });
  }

  /**
   * Open GitHub URL
   */
  openGitHub(url: string): void {
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
}
