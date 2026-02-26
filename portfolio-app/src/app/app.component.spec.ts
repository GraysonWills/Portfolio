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
import { MessageService } from 'primeng/api';

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
  isPromptDismissedForSession() { return false; }
  setPromptDismissedForSession(): void {}
}

class AnalyticsServiceStub {
  trackPageView(): void {}
  track(): void {}
}

class MessageServiceStub {
  add(): void {}
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
        { provide: MessageService, useClass: MessageServiceStub },
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

  it('should render a skip link', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const skipLink = compiled.querySelector<HTMLAnchorElement>('a.skip-link');
    expect(skipLink).toBeTruthy();
    expect(skipLink?.getAttribute('href')).toBe('#main-content');
  });
});
