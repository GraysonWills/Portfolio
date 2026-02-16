/**
 * Scroll Reveal Directive
 * Adds 'visible' class to elements when they enter the viewport
 * Usage: <div appScrollReveal> or <div appScrollReveal="0.2"> (threshold)
 */

import { Directive, ElementRef, Input, OnInit, OnDestroy, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Directive({
  selector: '[appScrollReveal]',
  standalone: false
})
export class ScrollRevealDirective implements OnInit, OnDestroy {
  // Lower default so "below-the-fold" sections don't render as blank whitespace on load.
  @Input('appScrollReveal') threshold: string = '0.1';

  private observer: IntersectionObserver | null = null;

  constructor(
    private el: ElementRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // `parseFloat("0")` is `0`, so avoid `||` which would override it.
    const parsed = parseFloat(this.threshold);
    const thresholdValue = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 0.1;

    // Graceful fallback: if IO isn't available, just reveal immediately.
    if (typeof IntersectionObserver === 'undefined') {
      this.el.nativeElement.classList.add('visible');
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            // Once revealed, stop observing for performance
            this.observer?.unobserve(entry.target);
          }
        });
      },
      // Avoid negative root margins; they can delay initial reveals and create "blank" sections.
      { threshold: thresholdValue, rootMargin: '0px 0px 0px 0px' }
    );

    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
