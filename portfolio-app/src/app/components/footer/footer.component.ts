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
      item => item.PageContentID === PageContentID.FooterIcon
    );
  }

  /**
   * Get URL from icon metadata
   */
  getIconUrl(icon: RedisContent): string {
    return icon.Metadata?.['url'] || '#';
  }
}
