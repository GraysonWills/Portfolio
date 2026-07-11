import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { App, AppState } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { PrivacyScreen } from '@capacitor/privacy-screen';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NativePlatformService {
  private readonly stateSubject = new BehaviorSubject<AppState>({ isActive: true });
  private listeners: PluginListenerHandle[] = [];
  private initialization: Promise<void> | null = null;

  readonly appState$ = this.stateSubject.asObservable();

  constructor(
    private readonly router: Router,
    private readonly zone: NgZone
  ) {}

  get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  get isIos(): boolean {
    return this.isNative && Capacitor.getPlatform() === 'ios';
  }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeNativeRuntime();
    return this.initialization;
  }

  getSocialOAuthReturnUrl(browserReturnUrl: string): string {
    return this.isNative ? 'authorstudio://oauth/social' : browserReturnUrl;
  }

  async openExternalAuth(url: string): Promise<void> {
    if (!this.isNative) {
      window.location.assign(url);
      return;
    }

    await Browser.open({
      url,
      presentationStyle: 'popover',
      toolbarColor: '#16273c'
    });
  }

  async openExternalUrl(url: string): Promise<void> {
    if (!this.isNative) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    await Browser.open({ url, presentationStyle: 'fullscreen', toolbarColor: '#16273c' });
  }

  private async initializeNativeRuntime(): Promise<void> {
    if (!this.isNative) return;

    document.documentElement.classList.add('native-app');
    if (this.isIos) document.documentElement.classList.add('native-ios');

    await Promise.allSettled([
      PrivacyScreen.enable({ ios: { blurEffect: 'dark' } }),
      StatusBar.setStyle({ style: Style.Dark }),
      SplashScreen.hide()
    ]);

    this.listeners.push(
      await App.addListener('appStateChange', (state) => {
        this.zone.run(() => this.stateSubject.next(state));
        if (!state.isActive) void Keyboard.hide();
      }),
      await App.addListener('appUrlOpen', ({ url }) => {
        void this.handleAppUrl(url);
      })
    );

    const launch = await App.getLaunchUrl();
    if (launch?.url) await this.handleAppUrl(launch.url);
  }

  private async handleAppUrl(rawUrl: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return;
    }

    if (url.protocol !== 'authorstudio:' || url.hostname !== 'oauth') return;

    if (url.pathname === '/social') {
      await Browser.close().catch(() => undefined);
      const queryParams = Object.fromEntries(url.searchParams.entries());
      await this.zone.run(() => this.router.navigate(['/distribution'], { queryParams }));
    }
  }
}
