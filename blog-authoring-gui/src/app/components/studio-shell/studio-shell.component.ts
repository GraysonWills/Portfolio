import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

export type StudioTab =
  | 'dashboard'
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
  /** Pages that own post creation handle it; others navigate to dashboard. */
  @Output() createPost = new EventEmitter<void>();

  readonly publicSiteUrl = 'https://grayson-wills.com';

  readonly tabs: Array<{ key: StudioTab; label: string; route: string }> = [
    { key: 'dashboard', label: 'Dashboard', route: '/dashboard' },
    { key: 'collections', label: 'Collections', route: '/collections' },
    { key: 'subscribers', label: 'Subscribers', route: '/subscribers' },
    { key: 'distribution', label: 'Distribution', route: '/distribution' },
    { key: 'comments', label: 'Comments', route: '/comments' },
    { key: 'mission-control', label: 'Mission Control', route: '/mission-control' },
  ];

  constructor(
    private router: Router,
    private authService: AuthService,
  ) {}

  onCreatePost(): void {
    if (this.createPost.observed) {
      this.createPost.emit();
    } else {
      this.router.navigate(['/dashboard'], { queryParams: { create: 1 } });
    }
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
