import { Component, OnInit } from '@angular/core';
import { RedisService } from '../../services/redis.service';
import { RedisContent, PageContentID } from '../../models/redis-content.model';
import { LinkedInDataService } from '../../services/linkedin-data.service';

@Component({
  selector: 'app-footer',
  standalone: false,
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss'
})
export class FooterComponent implements OnInit {
  footerContent: RedisContent[] = [];
  contactInfo: any = {};
  currentYear: number = new Date().getFullYear();
  private brokenIconIds = new Set<string>();

  constructor(
    private redisService: RedisService,
    private linkedInService: LinkedInDataService
  ) {}

  ngOnInit(): void {
    this.loadFooterContent();
    this.loadContactInfo();
  }

  /**
   * Load footer content from Redis
   */
  private loadFooterContent(): void {
    this.redisService.getFooterContent().subscribe({
      next: (content: RedisContent[]) => {
        this.footerContent = content;
      },
      error: (error) => {
        console.error('Error loading footer content:', error);
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
   * Get footer icons
   */
  getFooterIcons(): RedisContent[] {
    return this.footerContent.filter(
      item => item.PageContentID === PageContentID.FooterIcon && !this.shouldHideFooterIcon(item)
    );
  }

  /**
   * Get URL from icon metadata
   */
  getIconUrl(icon: RedisContent): string {
    return icon.Metadata?.['url'] || '#';
  }

  getIconClass(icon: RedisContent): string | null {
    const label = String(icon?.Text || '').trim().toLowerCase();
    const url = String(this.getIconUrl(icon) || '').trim().toLowerCase();

    if (label.includes('linkedin') || url.includes('linkedin.com')) return 'pi pi-linkedin';
    if (label.includes('github') || url.includes('github.com')) return 'pi pi-github';
    if (label.includes('email') || url.startsWith('mailto:')) return 'pi pi-envelope';
    return null;
  }

  useImageIcon(icon: RedisContent): boolean {
    return !this.getIconClass(icon) && !!icon?.Photo && !this.brokenIconIds.has(String(icon?.ID || ''));
  }

  onFooterIconError(icon: RedisContent): void {
    const id = String(icon?.ID || '').trim();
    if (!id) return;
    this.brokenIconIds.add(id);
  }

  private shouldHideFooterIcon(icon: RedisContent): boolean {
    const label = String(icon?.Text || '').trim().toLowerCase();
    const url = String(this.getIconUrl(icon) || '').trim().toLowerCase();

    if (label === 'website' || label === 'site') return true;
    if (url.includes('grayson-wills.com')) return true;

    return false;
  }
}
