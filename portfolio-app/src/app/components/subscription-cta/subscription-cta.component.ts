import {
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  SharedSubscriptionState,
  SubscriptionService
} from '../../services/subscription.service';
import { GrowthPlacement } from '../../models/growth.model';

let nextSubscriptionCtaId = 0;

@Component({
  selector: 'app-subscription-cta',
  templateUrl: './subscription-cta.component.html',
  styleUrl: './subscription-cta.component.scss',
  standalone: false
})
export class SubscriptionCtaComponent implements OnInit, OnDestroy {
  @Input() placement: GrowthPlacement = 'header';
  @Input() mode: 'inline' | 'popover' = 'inline';
  @Input() theme: 'light' | 'dark' = 'light';
  @Input() heading = 'Get the next field note.';
  @Input() description = 'Technology, creativity, and the honest process behind the build.';
  @Input() triggerLabel = 'Subscribe';
  @Input() submitLabel = 'Subscribe';
  @Input() showCopy = true;
  @Input() postId: string | null = null;
  @Input() postSlug: string | null = null;

  @ViewChild('emailInput') emailInput?: ElementRef<HTMLInputElement>;
  @ViewChild('triggerButton') triggerButton?: ElementRef<HTMLButtonElement>;

  readonly instanceId = ++nextSubscriptionCtaId;
  state: SharedSubscriptionState = {
    status: 'idle',
    email: '',
    message: '',
    updatedAt: null
  };
  expanded = false;
  private stateSub?: Subscription;

  constructor(
    private host: ElementRef<HTMLElement>,
    private subscriptions: SubscriptionService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.stateSub = this.subscriptions.sharedState$.subscribe((state) => {
      this.state = state;
    });
  }

  ngOnDestroy(): void {
    this.stateSub?.unsubscribe();
  }

  get isSubmitting(): boolean {
    return this.state.status === 'submitting';
  }

  get showsCompletion(): boolean {
    return ['pending', 'already_pending', 'confirmed', 'already_subscribed'].includes(this.state.status);
  }

  get statusTitle(): string {
    switch (this.state.status) {
      case 'pending': return 'Check your inbox.';
      case 'already_pending': return 'A confirmation is already waiting.';
      case 'confirmed': return 'You’re subscribed.';
      case 'already_subscribed': return 'You’re already on the list.';
      default: return '';
    }
  }

  get inputId(): string {
    return `subscription-email-${this.instanceId}`;
  }

  get statusId(): string {
    return `subscription-status-${this.instanceId}`;
  }

  togglePopover(event: Event): void {
    event.stopPropagation();
    this.expanded ? this.closePopover(true) : this.openPopover();
  }

  openPopover(): void {
    this.expanded = true;
    if (typeof window !== 'undefined') {
      window.setTimeout(() => this.emailInput?.nativeElement.focus(), 0);
    }
  }

  closePopover(returnFocus = false): void {
    this.expanded = false;
    if (returnFocus && typeof window !== 'undefined') {
      window.setTimeout(() => this.triggerButton?.nativeElement.focus(), 0);
    }
  }

  updateEmail(value: string): void {
    this.subscriptions.updateSharedEmail(value);
  }

  submit(): void {
    this.subscriptions.submitShared(this.state.email, {
      placement: this.placement,
      postId: this.postId,
      postSlug: this.postSlug
    });
  }

  managePreferences(): void {
    this.closePopover(false);
    this.router.navigate(['/account']);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.mode !== 'popover' || !this.expanded) return;
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.closePopover(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.mode === 'popover' && this.expanded) {
      this.closePopover(true);
    }
  }
}
