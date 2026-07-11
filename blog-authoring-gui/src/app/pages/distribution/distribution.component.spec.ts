import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { BlogApiService, SocialAuthStatusResponse } from '../../services/blog-api.service';
import { SocialDistributionAutomationService } from '../../services/social-distribution-automation.service';
import { DistributionComponent } from './distribution.component';
import { NativePlatformService } from '../../services/native-platform.service';

describe('DistributionComponent', () => {
  function createComponent(queryParams: Record<string, string> = {}) {
    const status$ = new Subject<SocialAuthStatusResponse>();
    const queryParamMap$ = new BehaviorSubject(convertToParamMap(queryParams));
    const route = {
      snapshot: {
        queryParamMap: convertToParamMap(queryParams)
      },
      queryParamMap: queryParamMap$.asObservable()
    } as unknown as ActivatedRoute;
    const router = {
      navigate: jasmine.createSpy('navigate')
    } as unknown as Router;
    const authService = {
      logout: jasmine.createSpy('logout')
    } as unknown as AuthService;
    const automation = new SocialDistributionAutomationService();
    spyOn(automation, 'loadSettings').and.returnValue(automation.getDefaultSettings());
    const blogApi = {
      getSocialAuthStatus: jasmine.createSpy('getSocialAuthStatus').and.returnValue(status$.asObservable()),
      getSocialDistributionSettings: jasmine.createSpy('getSocialDistributionSettings').and.returnValue(of(automation.getDefaultSettings())),
      saveSocialDistributionSettings: jasmine.createSpy('saveSocialDistributionSettings').and.callFake((settings) => of(settings)),
      getSocialDistributionDeliveries: jasmine.createSpy('getSocialDistributionDeliveries').and.returnValue(of({ deliveries: [] })),
      importSocialAuthToken: jasmine.createSpy('importSocialAuthToken').and.returnValue(of({
        provider: 'mastodon',
        selectedAccount: {
          id: '109123456789',
          label: '@graysonwills',
          handle: '@graysonwills',
          platform: 'mastodon'
        },
        accountLabel: '@graysonwills',
        expiresAt: null,
        refreshed: false
      }))
    } as unknown as BlogApiService;
    const nativePlatform = {
      getSocialOAuthReturnUrl: (url: string) => url,
      openExternalAuth: jasmine.createSpy('openExternalAuth'),
      openExternalUrl: jasmine.createSpy('openExternalUrl')
    } as unknown as NativePlatformService;

    return {
      component: new DistributionComponent(route, router, authService, blogApi, automation, nativePlatform),
      blogApi,
      nativePlatform,
      queryParamMap$,
      router,
      status$
    };
  }

  it('preserves OAuth callback errors when status refresh fails afterward', () => {
    const { component, router, status$ } = createComponent({
      socialProvider: 'x',
      socialStatus: 'error',
      socialError: 'access_denied'
    });

    component.ngOnInit();

    expect(component.socialAuthError).toBe('access_denied');
    expect(component.draftNotice).toBe('x connection failed.');

    status$.error(new Error('Network unavailable'));

    expect(component.socialAuthError).toBe('access_denied');
    expect(component.draftNotice).toBe('x connection failed.');
    expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({
      queryParams: {
        socialProvider: null,
        socialStatus: null,
        socialError: null
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    }));
  });

  it('handles a native OAuth return while the distribution route is already active', () => {
    const { component, blogApi, queryParamMap$, router } = createComponent();
    component.ngOnInit();
    expect(blogApi.getSocialAuthStatus).toHaveBeenCalledTimes(1);

    queryParamMap$.next(convertToParamMap({
      socialProvider: 'linkedin',
      socialStatus: 'connected'
    }));

    expect(component.draftNotice).toBe('linkedin connected.');
    expect(blogApi.getSocialAuthStatus).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ replaceUrl: true }));
    component.ngOnDestroy();
  });

  it('shows reconnect state when X is missing newly requested scopes', () => {
    const { component, status$ } = createComponent();

    component.ngOnInit();
    status$.next({
      providers: [{
        provider: 'x',
        label: 'X / Twitter',
        family: 'x',
        configured: true,
        scopes: ['tweet.read', 'tweet.write', 'users.read', 'dm.read', 'dm.write', 'offline.access'],
        redirectUri: 'https://api.grayson-wills.com/api/social-auth/x/callback',
        connected: false,
        status: 'needs-reconnect',
        needsReconnect: true,
        missingScopes: ['dm.read', 'dm.write'],
        connectedAt: '2026-06-22T23:33:06.659Z',
        updatedAt: '2026-06-22T23:33:06.659Z',
        expiresAt: '2026-06-23T01:33:06.478Z',
        accountLabel: '@GraysonWil91957',
        selectedAccount: {
          id: '2030858381473525760',
          label: '@GraysonWil91957',
          handle: '@GraysonWil91957',
          platform: 'x'
        },
        scope: 'tweet.write users.read tweet.read offline.access',
        credentialArtifacts: null
      }]
    });

    const xPlatform = component.platforms.find((platform) => platform.id === 'x');
    expect(xPlatform?.connectionState).toBe('attention');
    expect(xPlatform?.connectionLabel).toBe('Reconnect needed');
    expect(xPlatform?.connectionDetail).toContain('dm.read, dm.write');
  });

  it('shows automatic refresh for connected X credentials with a refresh token', () => {
    const { component, status$ } = createComponent();

    component.ngOnInit();
    status$.next({
      providers: [{
        provider: 'x',
        label: 'X / Twitter',
        family: 'x',
        configured: true,
        scopes: ['tweet.read', 'tweet.write', 'users.read', 'dm.read', 'dm.write', 'offline.access'],
        redirectUri: 'https://api.grayson-wills.com/api/social-auth/x/callback',
        connected: true,
        status: 'connected',
        connectedAt: '2026-06-22T23:33:06.659Z',
        updatedAt: '2026-06-22T23:33:06.659Z',
        expiresAt: '2026-06-23T01:33:06.478Z',
        accountLabel: '@GraysonWil91957',
        selectedAccount: {
          id: '2030858381473525760',
          label: '@GraysonWil91957',
          handle: '@GraysonWil91957',
          platform: 'x'
        },
        scope: 'tweet.read tweet.write users.read dm.read dm.write offline.access',
        credentialArtifacts: {
          tokenType: 'bearer',
          hasAccessToken: true,
          hasRefreshToken: true,
          hasIdToken: false,
          scope: 'tweet.read tweet.write users.read dm.read dm.write offline.access',
          expiresInSeconds: 7200,
          providerFields: ['expires_in', 'scope', 'token_type']
        }
      }]
    });

    const xPlatform = component.platforms.find((platform) => platform.id === 'x');
    expect(xPlatform?.connectionState).toBe('connected');
    expect(xPlatform?.expiresIn).toBe('Auto-refresh enabled');
  });

  it('shows Google APIs as an OAuth connection with automatic refresh', () => {
    const { component, status$ } = createComponent();

    component.ngOnInit();
    status$.next({
      providers: [{
        provider: 'google',
        label: 'Google APIs',
        family: 'google',
        configured: true,
        scopes: [
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/youtube.upload'
        ],
        redirectUri: 'https://api.grayson-wills.com/api/social-auth/google/callback',
        connected: true,
        status: 'connected',
        connectedAt: '2026-07-01T14:00:00.000Z',
        updatedAt: '2026-07-01T14:00:00.000Z',
        expiresAt: '2026-07-01T15:00:00.000Z',
        accountLabel: 'grayson@example.test',
        selectedAccount: {
          id: 'google-sub',
          label: 'grayson@example.test',
          handle: 'grayson@example.test',
          platform: 'google'
        },
        scope: 'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/youtube.upload',
        credentialArtifacts: {
          tokenType: 'Bearer',
          hasAccessToken: true,
          hasRefreshToken: true,
          hasIdToken: true,
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/youtube.upload',
          expiresInSeconds: 3600,
          providerFields: ['expires_in', 'scope', 'token_type']
        }
      }]
    });

    const google = component.platforms.find((platform) => platform.id === 'google');
    expect(component.platformCanUseOAuth(google!)).toBeTrue();
    expect(google?.connectionState).toBe('connected');
    expect(google?.handle).toBe('grayson@example.test');
    expect(google?.expiresIn).toBe('Auto-refresh enabled');
    expect(google?.connectionDetail).toContain('refresh token');
  });

  it('keeps Medium as a manual import workflow even when legacy OAuth status is returned', () => {
    const { component, status$ } = createComponent();

    component.ngOnInit();
    status$.next({
      providers: [{
        provider: 'medium',
        label: 'Medium',
        family: 'medium',
        configured: true,
        scopes: ['basicProfile', 'publishPost'],
        redirectUri: 'https://api.grayson-wills.com/api/social-auth/medium/callback',
        connected: true,
        status: 'connected',
        connectedAt: '2026-06-25T00:00:00.000Z',
        updatedAt: '2026-06-25T00:00:00.000Z',
        expiresAt: null,
        accountLabel: 'Legacy Medium account',
        selectedAccount: null,
        scope: 'basicProfile,publishPost',
        credentialArtifacts: null
      }]
    });

    const medium = component.platforms.find((platform) => platform.id === 'medium');
    expect(component.platformCanUseOAuth(medium!)).toBeFalse();
    expect(component.platformUsesManualImport(medium!)).toBeTrue();
    expect(medium?.connectionState).toBe('manual');
    expect(medium?.connectionLabel).toBe('Manual import');
    expect(medium?.destination).toBe('manual-import');
    expect(component.getTargetReadiness(medium!)).toContain('Manual import');
  });

  it('opens the official Medium import handoff', () => {
    const { component, nativePlatform } = createComponent();

    component.openMediumImport();

    expect(nativePlatform.openExternalUrl).toHaveBeenCalledWith('https://medium.com/p/import');
    expect(component.draftNotice).toContain('Medium import opened');
  });

  it('supports token-only imports for Instagram, Threads, and Mastodon', () => {
    const { component, blogApi } = createComponent();
    const instagram = component.platforms.find((platform) => platform.id === 'instagram')!;
    const threads = component.platforms.find((platform) => platform.id === 'threads')!;
    const mastodon = component.platforms.find((platform) => platform.id === 'mastodon')!;
    const facebook = component.platforms.find((platform) => platform.id === 'facebook')!;

    expect(component.canImportAccessToken(instagram)).toBeTrue();
    expect(component.canImportAccessToken(threads)).toBeTrue();
    expect(component.canImportAccessToken(mastodon)).toBeTrue();
    expect(component.canImportAccessToken(facebook)).toBeFalse();

    component.openTokenImport(mastodon);
    component.tokenImportValue = 'mastodon-access-token-for-import';
    component.tokenImportInstanceUrl = 'https://mastodon.social';
    component.importPlatformToken(mastodon);

    expect(blogApi.importSocialAuthToken).toHaveBeenCalledWith(
      'mastodon',
      'mastodon-access-token-for-import',
      { instanceUrl: 'https://mastodon.social' }
    );
    expect(component.tokenImportProviderId).toBe('');
    expect(mastodon.connectionState).toBe('connected');
  });

  it('stages enabled publish automation rules into the delivery queue', () => {
    const { component } = createComponent();

    component.ngOnInit();
    component.queueAutomationRules();

    expect(component.queueItems.length).toBe(3);
    expect(component.queueItems.map((item) => item.platform)).toEqual([
      'X / Twitter',
      'LinkedIn',
      'Facebook Page'
    ]);
    expect(component.activeWorkspaceTab).toBe('queue');
    expect(component.automationNotice).toContain('automated posts staged');
  });
});
