import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { BlogApiService, SocialAuthStatusResponse } from '../../services/blog-api.service';
import { SocialDistributionAutomationService } from '../../services/social-distribution-automation.service';
import { DistributionComponent } from './distribution.component';

describe('DistributionComponent', () => {
  function createComponent(queryParams: Record<string, string> = {}) {
    const status$ = new Subject<SocialAuthStatusResponse>();
    const route = {
      snapshot: {
        queryParamMap: convertToParamMap(queryParams)
      }
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
      getSocialDistributionDeliveries: jasmine.createSpy('getSocialDistributionDeliveries').and.returnValue(of({ deliveries: [] }))
    } as unknown as BlogApiService;

    return {
      component: new DistributionComponent(route, router, authService, blogApi, automation),
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
