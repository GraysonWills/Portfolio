import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { RedisService } from '../../services/redis.service';
import { RedisContent, PageContentID } from '../../models/redis-content.model';
import { LinkedInDataService } from '../../services/linkedin-data.service';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'app-header',
  standalone: false,
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent implements OnInit {
  headerContent: RedisContent[] = [];
  menuItems: MenuItem[] = [];
  contactInfo: any = {};

  constructor(
    private redisService: RedisService,
    private linkedInService: LinkedInDataService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadHeaderContent();
    this.loadContactInfo();
    this.setupMenuItems();
  }

  /**
   * Load header content from Redis
   */
  private loadHeaderContent(): void {
    this.redisService.getHeaderContent().subscribe({
      next: (content: RedisContent[]) => {
        this.headerContent = content;
      },
      error: (error) => {
        console.error('Error loading header content:', error);
      }
    });
  }

  /**
   * Load contact information
   */
  private loadContactInfo(): void {
    this.linkedInService.getContactInfo().subscribe({
      next: (contact) => {
        this.contactInfo = contact;
      },
      error: (error) => {
        console.error('Error loading contact info:', error);
      }
    });
  }

  /**
   * Setup navigation menu items
   */
  private setupMenuItems(): void {
    this.menuItems = [
      {
        label: 'Home',
        icon: 'pi pi-home',
        command: () => this.navigateTo('/')
      },
      {
        label: 'Work',
        icon: 'pi pi-briefcase',
        command: () => this.navigateTo('/work')
      },
      {
        label: 'Projects',
        icon: 'pi pi-code',
        command: () => this.navigateTo('/projects')
      },
      {
        label: 'Blog',
        icon: 'pi pi-book',
        command: () => this.navigateTo('/blog')
      }
    ];
  }

  /**
   * Navigate to route
   */
  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  /**
   * Get header text content
   */
  getHeaderText(): string {
    const textContent = this.headerContent.find(
      item => item.PageContentID === PageContentID.HeaderText
    );
    return textContent?.Text || 'Grayson Wills';
  }

  /**
   * Get header icon content
   */
  getHeaderIcon(): string {
    const iconContent = this.headerContent.find(
      item => item.PageContentID === PageContentID.HeaderIcon
    );
    return iconContent?.Photo || '';
  }
}
