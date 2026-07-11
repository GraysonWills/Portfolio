import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from './services/auth.service';
import { HotkeyDescriptor, HotkeysService, HotkeyContext } from './services/hotkeys.service';
import { NativePlatformService } from './services/native-platform.service';

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
  nativeLockVisible = false;
  nativeUnlocking = false;
  private readonly destroyRef = inject(DestroyRef);
  private cleanupGlobalHotkeys: (() => void) | null = null;
  private hotkeyBindingsUpdateQueued = false;
  private nativeBackgroundedAt = 0;
  private readonly nativeRelockAfterMs = 30_000;
  private readonly publicRoutes = new Set(['/login', '/register', '/forgot-password']);

  constructor(
    private router: Router,
    private authService: AuthService,
    private hotkeys: HotkeysService,
    private nativePlatform: NativePlatformService
  ) {}

  ngOnInit(): void {
    void this.nativePlatform.initialize();
    this.nativePlatform.appState$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        if (!this.nativePlatform.isNative) return;
        if (!state.isActive) {
          this.nativeBackgroundedAt = Date.now();
          return;
        }

        if (this.nativeBackgroundedAt
          && Date.now() - this.nativeBackgroundedAt >= this.nativeRelockAfterMs
          && this.authService.isAuthenticated()) {
          this.authService.lockNativeSessionInMemory();
          this.nativeLockVisible = true;
          void this.unlockNativeApp();
        }
        this.nativeBackgroundedAt = 0;
      });
    this.registerGlobalHotkeys();

    this.hotkeys.helpVisible$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((visible) => {
        this.hotkeyHelpVisible = visible;
      });

    this.hotkeys.bindingsChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.scheduleHotkeyBindingsUpdate();
      });

    // Redirect to login if not authenticated and not already on login page
    this.router.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(event => {
        if (event instanceof NavigationEnd) {
          void this.handleNavigation(event);
        }
      });
  }

  private async handleNavigation(event: NavigationEnd): Promise<void> {
    await this.authService.ensureReady();
    const currentRoute = String(event.urlAfterRedirects || event.url || '').split('?')[0] || '/';
    this.hotkeys.setContext(this.resolveContextFromUrl(currentRoute));
    if (!this.authService.isAuthenticated() && !this.publicRoutes.has(currentRoute)) {
      await this.router.navigate(['/login']);
    }
    this.scheduleHotkeyBindingsUpdate();
  }

  private scheduleHotkeyBindingsUpdate(): void {
    if (this.hotkeyBindingsUpdateQueued) return;
    this.hotkeyBindingsUpdateQueued = true;
    queueMicrotask(() => {
      this.hotkeyBindingsUpdateQueued = false;
      this.hotkeyBindings = this.hotkeys.getDisplayBindings();
    });
  }

  closeHotkeysDialog(): void {
    this.hotkeys.hideHelp();
  }

  async unlockNativeApp(): Promise<void> {
    if (this.nativeUnlocking) return;
    this.nativeUnlocking = true;
    const unlocked = await this.authService.unlockNativeSession();
    this.nativeUnlocking = false;
    this.nativeLockVisible = !unlocked;
  }

  async signInFromNativeLock(): Promise<void> {
    this.authService.logout();
    this.nativeLockVisible = false;
    await this.router.navigate(['/login']);
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
        description: 'Go to Comments',
        action: () => this.router.navigate(['/comments']),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+6',
        description: 'Go to Distribution',
        action: () => this.router.navigate(['/distribution']),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+7',
        description: 'Go to Mission Control',
        action: () => this.router.navigate(['/mission-control']),
        allowInInputs: true
      }
    ]);
  }

  private resolveContextFromUrl(url: string): HotkeyContext {
    const clean = String(url || '').split('?')[0].toLowerCase();
    if (clean.startsWith('/dashboard')) return 'dashboard';
    if (clean.startsWith('/content')) return 'content';
    if (clean.startsWith('/subscribers')) return 'subscribers';
    if (clean.startsWith('/comments')) return 'comments';
    if (clean.startsWith('/distribution')) return 'distribution';
    if (clean.startsWith('/collections')) return 'collections';
    if (clean.startsWith('/register')) return 'register';
    if (clean.startsWith('/forgot-password')) return 'forgot-password';
    if (clean.startsWith('/login')) return 'login';
    return 'global';
  }
}
