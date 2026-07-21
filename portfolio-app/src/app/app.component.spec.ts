import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { RedisService } from './services/redis.service';
import { SeoService } from './services/seo.service';
import { SubscriptionService } from './services/subscription.service';
import { AnalyticsService } from './services/analytics.service';
import { SiteConsentService } from './services/site-consent.service';

class RedisServiceStub {
  setApiEndpoint(): void {}
  setPreviewSessionToken(): void {}
  clearPreviewSessionToken(): void {}
}

class TitleStub {
  setTitle(): void {}
}

class SeoServiceStub {
  update(): void {}
}

class SubscriptionServiceStub {
  request() { return of({}); }
  getPromptState() { return null; }
  setPromptState(): void {}
  trackPromptRoute(): void {}
  shouldShowPromptForPath() { return false; }
  markPromptShown(): void {}
  dismissPrompt() { return { dismissCount: 1, permanentlyDismissed: false }; }
  getPromptInteractionState() { return { blogVisitCount: 0 }; }
  isPromptDismissedForSession() { return false; }
  setPromptDismissedForSession(): void {}
}

class AnalyticsServiceStub {
  trackPageView(): void {}
  track(): void {}
}

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, NoopAnimationsModule],
      declarations: [AppComponent],
      providers: [
        { provide: RedisService, useClass: RedisServiceStub },
        { provide: SeoService, useClass: SeoServiceStub },
        { provide: SubscriptionService, useClass: SubscriptionServiceStub },
        { provide: AnalyticsService, useClass: AnalyticsServiceStub },
        { provide: Title, useClass: TitleStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have the expected title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('Grayson Wills - Portfolio');
  });

  it('should render main content container', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const main = compiled.querySelector<HTMLElement>('main#main-content');
    expect(main).toBeTruthy();
  });

  it('does not render the cookie banner before the client UI is ready', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const compiled = fixture.nativeElement as HTMLElement;

    fixture.detectChanges();
    app.cookieUiReady = false;
    app.showCookieBanner = true;
    fixture.detectChanges();

    expect(compiled.querySelector('.cookie-banner')).toBeNull();
  });

  it('saves analytics consent and removes the banner from the DOM', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const consent = TestBed.inject(SiteConsentService);
    const compiled = fixture.nativeElement as HTMLElement;
    spyOn(consent, 'acceptAnalytics').and.callThrough();

    fixture.detectChanges();
    app.cookieUiReady = true;
    app.showCookieBanner = true;
    fixture.detectChanges();
    compiled
      .querySelector<HTMLButtonElement>('[data-consent-choice="analytics"]')
      ?.click();
    fixture.detectChanges();

    expect(consent.acceptAnalytics).toHaveBeenCalled();
    expect(consent.getConsentSnapshot().analytics).toBeTrue();
    expect(app.showCookieBanner).toBeFalse();
    expect(compiled.querySelector('.cookie-banner')).toBeNull();
    expect(compiled.querySelector('.consent-confirmation')).toBeNull();
    expect(compiled.querySelector('.consent-status')?.textContent).toContain('Analytics enabled');
    expect(app.consentConfirmation?.summary).toBe('Analytics enabled');
  });

  it('saves necessary-only consent and removes the banner from the DOM', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const consent = TestBed.inject(SiteConsentService);
    const compiled = fixture.nativeElement as HTMLElement;
    spyOn(consent, 'rejectAnalytics').and.callThrough();

    fixture.detectChanges();
    app.cookieUiReady = true;
    app.showCookieBanner = true;
    fixture.detectChanges();
    compiled
      .querySelector<HTMLButtonElement>('[data-consent-choice="necessary"]')
      ?.click();
    fixture.detectChanges();

    expect(consent.rejectAnalytics).toHaveBeenCalled();
    expect(consent.getConsentSnapshot().analytics).toBeFalse();
    expect(app.showCookieBanner).toBeFalse();
    expect(compiled.querySelector('.cookie-banner')).toBeNull();
    expect(compiled.querySelector('.consent-confirmation')).toBeNull();
    expect(compiled.querySelector('.consent-status')?.textContent).toContain('Preference saved');
    expect(app.consentConfirmation?.summary).toBe('Preference saved');
  });
});
