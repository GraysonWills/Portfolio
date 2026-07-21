import { AfterViewInit, Directive, ElementRef, Input, OnDestroy } from '@angular/core';
import { AnalyticsService } from '../services/analytics.service';
import { GrowthAction, GrowthPlacement, growthMetadata } from '../models/growth.model';

@Directive({
  selector: '[appGrowthCtaImpression]',
  standalone: false
})
export class GrowthCtaImpressionDirective implements AfterViewInit, OnDestroy {
  @Input('appGrowthCtaImpression') action: GrowthAction = 'subscribe';
  @Input() growthPlacement: GrowthPlacement = 'header';
  @Input() growthPostId: string | null = null;
  @Input() growthPostSlug: string | null = null;

  private observer?: IntersectionObserver;
  private tracked = false;

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    private analytics: AnalyticsService
  ) {}

  ngAfterViewInit(): void {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      this.trackOnce();
      return;
    }

    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.25)) {
        this.trackOnce();
      }
    }, { threshold: [0.25] });
    this.observer.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private trackOnce(): void {
    if (this.tracked) return;
    this.tracked = true;
    this.observer?.disconnect();
    this.analytics.track('growth_cta_impression', {
      metadata: growthMetadata(this.action, {
        placement: this.growthPlacement,
        postId: this.growthPostId,
        postSlug: this.growthPostSlug
      })
    });
  }
}
