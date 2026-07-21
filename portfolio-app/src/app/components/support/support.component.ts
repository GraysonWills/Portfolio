import { AfterViewChecked, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { SupportModalState, SupportService } from '../../services/support.service';

/**
 * One global, user-triggered support dialog opened from any public placement.
 */
@Component({
  selector: 'app-support',
  templateUrl: './support.component.html',
  styleUrl: './support.component.scss',
  standalone: false,
})
export class SupportComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('dialog') dialog?: ElementRef<HTMLElement>;
  @ViewChild('closeButton')
  set closeButton(value: ElementRef<HTMLButtonElement> | undefined) {
    this.closeButtonRef = value;
    if (value && this.state.open) {
      value.nativeElement.focus();
      this.focusDialogWhenReady = false;
    }
  }

  state: SupportModalState = {
    open: false,
    placement: 'footer',
    postId: null,
    postSlug: null,
    conversionId: null
  };
  private stateSub?: Subscription;
  private previouslyFocused?: HTMLElement | null;
  private focusDialogWhenReady = false;
  private closeButtonRef?: ElementRef<HTMLButtonElement>;

  constructor(public support: SupportService) {}

  ngOnInit(): void {
    this.stateSub = this.support.state$.subscribe((state) => {
      const wasOpen = this.state.open;
      this.state = state;
      if (state.open && !wasOpen) {
        this.previouslyFocused = typeof document !== 'undefined'
          ? document.activeElement as HTMLElement
          : null;
        this.setBodyState(true);
        this.focusDialogWhenReady = true;
      } else if (!state.open && wasOpen) {
        this.setBodyState(false);
        const focusTarget = this.previouslyFocused;
        this.previouslyFocused = null;
        if (typeof window !== 'undefined') {
          window.setTimeout(() => focusTarget?.focus(), 0);
        }
      }
    });
  }

  ngAfterViewChecked(): void {
    if (!this.focusDialogWhenReady || !this.closeButtonRef?.nativeElement) return;
    this.focusDialogWhenReady = false;
    this.closeButtonRef.nativeElement.focus();
  }

  ngOnDestroy(): void {
    this.stateSub?.unsubscribe();
    this.setBodyState(false);
  }

  close(): void {
    this.support.close();
  }

  openFloatingSupport(): void {
    this.support.open({ placement: 'floating_support' });
  }

  onOutboundClick(): void {
    this.support.trackOutboundClick();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.state.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = this.getFocusableElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private getFocusableElements(): HTMLElement[] {
    if (!this.dialog?.nativeElement) return [];
    return Array.from(this.dialog.nativeElement.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hasAttribute('hidden'));
  }

  private setBodyState(open: boolean): void {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle('support-modal-active', open);
    document.body.classList.toggle('mobile-overlay-active', open);
  }
}
