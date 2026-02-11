import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
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
export class HeaderComponent implements OnInit, OnDestroy {
  headerContent: RedisContent[] = [];
  menuItems: MenuItem[] = [];
  contactInfo: any = {};
  mobileMenuOpen: boolean = false;
  private routerSub!: Subscription;

  constructor(
    private redisService: RedisService,
    private linkedInService: LinkedInDataService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadHeaderContent();
    this.loadContactInfo();
    this.setupMenuItems();
    this.trackActiveRoute();
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
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
   * Setup navigation menu items with routerLink
   */
  private setupMenuItems(): void {
    this.menuItems = [
      {
        label: 'Home',
        icon: 'pi pi-home',
        routerLink: '/',
        styleClass: ''
      },
      {
        label: 'Work',
        icon: 'pi pi-briefcase',
        routerLink: '/work',
        styleClass: ''
      },
      {
        label: 'Projects',
        icon: 'pi pi-code',
        routerLink: '/projects',
        styleClass: ''
      },
      {
        label: 'Blog',
        icon: 'pi pi-book',
        routerLink: '/blog',
        styleClass: ''
      }
    ];
    this.updateActiveRoute(this.router.url);
  }

  /**
   * Track route changes and update active menu item
   */
  private trackActiveRoute(): void {
    this.routerSub = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.updateActiveRoute(event.urlAfterRedirects || event.url);
    });
  }

  /**
   * Update active class on menu items based on current route
   */
  private updateActiveRoute(url: string): void {
    this.menuItems.forEach(item => {
      const isActive = item.routerLink === '/'
        ? url === '/'
        : url.startsWith(item.routerLink as string);
      item.styleClass = isActive ? 'active-route' : '';
    });
  }

  /**
   * Navigate to route
   */
  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  /**
   * Toggle mobile menu drawer
   */
  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
    document.body.style.overflow = this.mobileMenuOpen ? 'hidden' : '';
  }

  /**
   * Close mobile menu drawer
   */
  closeMobileMenu(): void {
    this.mobileMenuOpen = false;
    document.body.style.overflow = '';
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
