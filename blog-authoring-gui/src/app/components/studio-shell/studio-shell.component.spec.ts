import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NativePlatformService } from '../../services/native-platform.service';
import { StudioShellComponent } from './studio-shell.component';

describe('StudioShellComponent mobile navigation', () => {
  it('does not replace an active editor when post creation is disabled', () => {
    const { component, router } = createComponent();
    const emitted = jasmine.createSpy('emitted');
    component.createPost.subscribe(emitted);
    component.createDisabled = true;

    component.onCreatePost();

    expect(emitted).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('emits post creation to a page that owns the editor', () => {
    const { component } = createComponent();
    const emitted = jasmine.createSpy('emitted');
    component.createPost.subscribe(emitted);

    component.onCreatePost();

    expect(emitted).toHaveBeenCalled();
  });

  it('closes the More dialog with Escape', () => {
    const { component } = createComponent();
    component.mobileMoreOpen = true;
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    component.handleDocumentKeydown(event);

    expect(component.mobileMoreOpen).toBeFalse();
    expect(event.defaultPrevented).toBeTrue();
  });

  function createComponent(): { component: StudioShellComponent; router: jasmine.SpyObj<Router> } {
    const router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['logout']);
    const nativePlatform = {
      isNative: false,
      openExternalUrl: jasmine.createSpy('openExternalUrl')
    } as unknown as NativePlatformService;

    return {
      component: new StudioShellComponent(router, auth, nativePlatform),
      router
    };
  }
});
