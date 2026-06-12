import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Subject } from 'rxjs';
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
    const blogApi = {
      getSocialAuthStatus: jasmine.createSpy('getSocialAuthStatus').and.returnValue(status$.asObservable())
    } as unknown as BlogApiService;
    const automation = new SocialDistributionAutomationService();
    spyOn(automation, 'loadSettings').and.returnValue(automation.getDefaultSettings());

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
