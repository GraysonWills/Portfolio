import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from './services/auth.service';
import { HotkeyDescriptor, HotkeysService, HotkeyContext } from './services/hotkeys.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  standalone: false
})
export class AppComponent implements OnInit {
  title = 'Blog Authoring GUI';
  hotkeyHelpVisible = false;
  hotkeyBindings: HotkeyDescriptor[] = [];
  private readonly destroyRef = inject(DestroyRef);
  private cleanupGlobalHotkeys: (() => void) | null = null;
  private readonly publicRoutes = new Set(['/login', '/register', '/forgot-password']);

  constructor(
    private router: Router,
    private authService: AuthService,
    private hotkeys: HotkeysService
  ) {}

  ngOnInit(): void {
    this.registerGlobalHotkeys();

    this.hotkeys.helpVisible$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((visible) => {
        this.hotkeyHelpVisible = visible;
      });

    this.hotkeys.bindingsChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.hotkeyBindings = this.hotkeys.getDisplayBindings();
      });

    // Redirect to login if not authenticated and not already on login page
    this.router.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(event => {
        if (event instanceof NavigationEnd) {
          const currentRoute = String(event.urlAfterRedirects || event.url || '').split('?')[0] || '/';
          this.hotkeys.setContext(this.resolveContextFromUrl(currentRoute));
          if (!this.authService.isAuthenticated() && !this.publicRoutes.has(currentRoute)) {
            this.router.navigate(['/login']);
          }
          this.hotkeyBindings = this.hotkeys.getDisplayBindings();
        }
      });
  }

  closeHotkeysDialog(): void {
    this.hotkeys.hideHelp();
  }

  private registerGlobalHotkeys(): void {
    if (this.cleanupGlobalHotkeys) {
      this.cleanupGlobalHotkeys();
      this.cleanupGlobalHotkeys = null;
    }

    this.cleanupGlobalHotkeys = this.hotkeys.register('global', [
      {
        combo: 'mod+alt+/',
        description: 'Show/hide hotkeys',
        action: () => this.hotkeys.toggleHelp(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+1',
        description: 'Go to Blog Dashboard',
        action: () => this.router.navigate(['/dashboard']),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+2',
        description: 'Go to Site Content Studio',
        action: () => this.router.navigate(['/content']),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+3',
        description: 'Go to Subscribers',
        action: () => this.router.navigate(['/subscribers']),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+4',
        description: 'Go to Collections',
        action: () => this.router.navigate(['/collections']),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+5',
        description: 'Go to Trading Bot',
        action: () => this.router.navigate(['/trading']),
        allowInInputs: true
      }
    ]);
  }

  private resolveContextFromUrl(url: string): HotkeyContext {
    const clean = String(url || '').split('?')[0].toLowerCase();
    if (clean.startsWith('/dashboard')) return 'dashboard';
    if (clean.startsWith('/content')) return 'content';
    if (clean.startsWith('/subscribers')) return 'subscribers';
    if (clean.startsWith('/collections')) return 'collections';
    if (clean.startsWith('/register')) return 'register';
    if (clean.startsWith('/forgot-password')) return 'forgot-password';
    if (clean.startsWith('/login')) return 'login';
    return 'global';
  }
}
