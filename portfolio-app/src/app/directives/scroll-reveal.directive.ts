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
  @Input('appScrollReveal') threshold: string = '0.15';

  private observer: IntersectionObserver | null = null;

  constructor(
    private el: ElementRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const thresholdValue = parseFloat(this.threshold) || 0.15;

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
      { threshold: thresholdValue, rootMargin: '0px 0px -50px 0px' }
    );

    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
