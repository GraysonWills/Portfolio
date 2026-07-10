import { fakeAsync, tick } from '@angular/core/testing';
import { LandingComponent } from './landing.component';

describe('LandingComponent hero prefetching', () => {
  let requestIdleCallbackSpy: jasmine.Spy;
  let originalRequestIdleCallback: PropertyDescriptor | undefined;
  let originalCancelIdleCallback: PropertyDescriptor | undefined;
  let originalConnection: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalRequestIdleCallback = Object.getOwnPropertyDescriptor(window, 'requestIdleCallback');
    originalCancelIdleCallback = Object.getOwnPropertyDescriptor(window, 'cancelIdleCallback');
    originalConnection = Object.getOwnPropertyDescriptor(navigator, 'connection');

    requestIdleCallbackSpy = jasmine.createSpy('requestIdleCallback').and.returnValue(1);
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: requestIdleCallbackSpy
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: jasmine.createSpy('cancelIdleCallback')
    });
  });

  afterEach(() => {
    restoreProperty(window, 'requestIdleCallback', originalRequestIdleCallback);
    restoreProperty(window, 'cancelIdleCallback', originalCancelIdleCallback);
    restoreProperty(navigator, 'connection', originalConnection);
  });

  it('waits for the active image load and post-load delay before requesting idle time', fakeAsync(() => {
    const component = createComponent();
    component.heroSlides = heroSlides(2);

    tick(5000);
    expect(requestIdleCallbackSpy).not.toHaveBeenCalled();

    component.onHeroImageLoad();
    tick(1499);
    expect(requestIdleCallbackSpy).not.toHaveBeenCalled();

    tick(1);
    expect(requestIdleCallbackSpy).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  }));

  it('schedules the following slide when the new active image loads from cache', fakeAsync(() => {
    const component = createComponent();
    component.heroSlides = heroSlides(3);

    component.onHeroImageLoad();
    tick(1500);
    expect(requestIdleCallbackSpy).toHaveBeenCalledTimes(1);

    component.goToHeroSlide(1);
    component.onHeroImageLoad();
    tick(1500);
    expect(requestIdleCallbackSpy).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  }));

  it('does not prefetch when the user has enabled data saving', fakeAsync(() => {
    setConnection({ saveData: true, effectiveType: '4g' });
    const component = createComponent();
    component.heroSlides = heroSlides(2);

    component.onHeroImageLoad();
    tick(3000);
    expect(requestIdleCallbackSpy).not.toHaveBeenCalled();
    component.ngOnDestroy();
  }));

  for (const effectiveType of ['slow-2g', '2g']) {
    it(`does not prefetch on a ${effectiveType} connection`, fakeAsync(() => {
      setConnection({ saveData: false, effectiveType });
      const component = createComponent();
      component.heroSlides = heroSlides(2);

      component.onHeroImageLoad();
      tick(3000);
      expect(requestIdleCallbackSpy).not.toHaveBeenCalled();
      component.ngOnDestroy();
    }));
  }

  it('builds bounded responsive candidates for Unsplash hero images', () => {
    const component = createComponent();
    const slide = (component as unknown as {
      createHeroSlide(photo: string, alt: string): {
        photo: string;
        displaySrc?: string;
        srcset?: string;
      };
    }).createHeroSlide(
      'https://images.unsplash.com/photo-example?fm=webp&w=1920&q=80',
      'Example hero'
    );

    expect(slide.photo).toContain('w=1920');
    expect(slide.displaySrc).toContain('w=1600');
    expect(slide.displaySrc).toContain('q=72');
    expect(slide.displaySrc).not.toContain('fm=');
    expect(slide.srcset?.match(/\s\d+w/g)?.length).toBe(4);
  });

  it('leaves non-Unsplash media URLs unchanged', () => {
    const component = createComponent();
    const photo = 'https://d10d6kv3med0wp.cloudfront.net/uploads/hero.jpg';
    const slide = (component as unknown as {
      createHeroSlide(photo: string, alt: string): {
        photo: string;
        displaySrc?: string;
        srcset?: string;
      };
    }).createHeroSlide(photo, 'Managed hero');

    expect(slide.photo).toBe(photo);
    expect(slide.displaySrc).toBeUndefined();
    expect(slide.srcset).toBeUndefined();
  });

  function setConnection(connection: { saveData: boolean; effectiveType: string }): void {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: connection
    });
  }
});

function createComponent(): LandingComponent {
  const routeViewState = {
    setState(): void {}
  };

  return new LandingComponent(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    routeViewState as never,
    {} as never,
    {} as never
  );
}

function heroSlides(count: number): Array<{ photo: string; alt: string }> {
  return Array.from({ length: count }, (_, index) => ({
    photo: `https://cdn.example.com/hero-${index + 1}.webp`,
    alt: `Hero ${index + 1}`
  }));
}

function restoreProperty(
  target: Window | Navigator,
  property: string,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
    return;
  }
  delete (target as unknown as Record<string, unknown>)[property];
}
