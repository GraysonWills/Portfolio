import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NativePlatformService } from '../../services/native-platform.service';

export type StudioTab =
  | 'dashboard'
  | 'content'
  | 'ai'
  | 'collections'
  | 'subscribers'
  | 'distribution'
  | 'comments'
  | 'mission-control';

/**
 * The Author Studio top bar (design: Author Studio.dc.html, TOP BAR).
 * One persistent header across every studio page: brand mark, connection
 * pill, primary actions, and the studio tab nav.
 */
@Component({
  selector: 'app-studio-shell',
  templateUrl: './studio-shell.component.html',
  styleUrl: './studio-shell.component.scss',
  standalone: false,
})
export class StudioShellComponent {
  /** Which tab renders as active. */
  @Input() active: StudioTab = 'dashboard';
  /** API connection state — drives the pill next to the title. */
  @Input() apiConnected: boolean | null = null;
  /** Optional connection label override (e.g. "API Connected (redis)"). */
  @Input() connectionLabel: string | null = null;
  /** Prevents an in-progress editor from being replaced by a second draft. */
  @Input() createDisabled = false;
  /** Pages that own post creation handle it; others navigate to dashboard. */
  @Output() createPost = new EventEmitter<void>();
  @ViewChild('mobileMoreSheet') private mobileMoreSheet?: ElementRef<HTMLElement>;
  @ViewChild('mobileMoreTrigger') private mobileMoreTrigger?: ElementRef<HTMLButtonElement>;
  mobileMoreOpen = false;

  readonly publicSiteUrl = 'https://grayson-wills.com';

  readonly tabs: Array<{ key: StudioTab; label: string; route: string; icon: string }> = [
    { key: 'dashboard', label: 'Dashboard', route: '/dashboard', icon: 'pi-home' },
    { key: 'collections', label: 'Collections', route: '/collections', icon: 'pi-folder' },
    { key: 'subscribers', label: 'Subscribers', route: '/subscribers', icon: 'pi-users' },
    { key: 'distribution', label: 'Distribution', route: '/distribution', icon: 'pi-send' },
    { key: 'comments', label: 'Comments', route: '/comments', icon: 'pi-comments' },
    { key: 'mission-control', label: 'Mission Control', route: '/mission-control', icon: 'pi-sitemap' },
  ];

  constructor(
    private router: Router,
    private authService: AuthService,
    private nativePlatform: NativePlatformService,
  ) {}

  onCreatePost(): void {
    if (this.createDisabled) return;
    this.mobileMoreOpen = false;
    if (this.createPost.observed) {
      this.createPost.emit();
    } else {
      this.router.navigate(['/dashboard'], { queryParams: { create: 1 } });
    }
  }

  toggleMobileMore(): void {
    if (this.mobileMoreOpen) {
      this.closeMobileMore();
      return;
    }

    this.mobileMoreOpen = true;
    setTimeout(() => {
      const sheet = this.mobileMoreSheet?.nativeElement;
      const firstControl = sheet?.querySelector<HTMLElement>('button:not([disabled]), a[href]');
      (firstControl || sheet)?.focus();
    });
  }

  closeMobileMore(): void {
    if (!this.mobileMoreOpen) return;
    this.mobileMoreOpen = false;
    setTimeout(() => this.mobileMoreTrigger?.nativeElement.focus());
  }

  @HostListener('document:keydown', ['$event'])
  handleDocumentKeydown(event: KeyboardEvent): void {
    if (!this.mobileMoreOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMobileMore();
      return;
    }
    if (event.key !== 'Tab') return;

    const sheet = this.mobileMoreSheet?.nativeElement;
    if (!sheet) return;
    const controls = Array.from(sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]'));
    if (!controls.length) {
      event.preventDefault();
      sheet.focus();
      return;
    }

    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  openPublicSite(event: Event): void {
    if (!this.nativePlatform.isNative) return;
    event.preventDefault();
    void this.nativePlatform.openExternalUrl(this.publicSiteUrl);
  }

  get mobileMoreActive(): boolean {
    return this.active === 'subscribers'
      || this.active === 'distribution'
      || this.active === 'mission-control'
      || this.active === 'content'
      || this.active === 'ai';
  }

  logout(): void {
    this.mobileMoreOpen = false;
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
