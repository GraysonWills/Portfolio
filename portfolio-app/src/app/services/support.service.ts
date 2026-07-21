import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AnalyticsService } from './analytics.service';
import { GrowthContext, growthMetadata } from '../models/growth.model';

export interface SupportModalState extends GrowthContext {
  open: boolean;
}

/** Opens the global support (buy-me-a-coffee) modal from anywhere. */
@Injectable({ providedIn: 'root' })
export class SupportService {
  readonly canonicalUrl = 'https://buymeacoffee.com/calvarygmak';
  private readonly stateSubject = new BehaviorSubject<SupportModalState>({
    open: false,
    placement: 'footer',
    postId: null,
    postSlug: null,
    conversionId: null
  });
  readonly state$ = this.stateSubject.asObservable();

  constructor(private analytics: AnalyticsService) {}

  get isOpen(): boolean {
    return this.stateSubject.value.open;
  }

  get context(): SupportModalState {
    return this.stateSubject.value;
  }

  open(context: Partial<GrowthContext> = {}): void {
    const next: SupportModalState = {
      open: true,
      placement: context.placement || 'footer',
      postId: String(context.postId || '').trim() || null,
      postSlug: String(context.postSlug || '').trim() || null,
      conversionId: `support-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
    };
    this.stateSubject.next(next);
    this.analytics.track('support_modal_open', {
      metadata: growthMetadata('support', next)
    });
  }

  close(): void {
    this.stateSubject.next({ ...this.stateSubject.value, open: false });
  }

  trackOutboundClick(): void {
    const current = this.stateSubject.value;
    this.analytics.track('support_outbound_click', {
      metadata: growthMetadata('support', current, {
        destination: this.canonicalUrl
      })
    });
  }
}
