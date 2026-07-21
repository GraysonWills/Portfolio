/**
 * Shared Module
 * Common PrimeNG imports and utilities shared across feature modules
 */
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

// PrimeNG directive used by root and feature templates.
import { InputTextModule } from 'primeng/inputtext';

import { ScrollRevealDirective } from '../directives/scroll-reveal.directive';
import { GrowthCtaImpressionDirective } from '../directives/growth-cta-impression.directive';
import { SubscriptionCtaComponent } from '../components/subscription-cta/subscription-cta.component';

@NgModule({
  declarations: [
    ScrollRevealDirective,
    GrowthCtaImpressionDirective,
    SubscriptionCtaComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    InputTextModule
  ],
  exports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    InputTextModule,
    ScrollRevealDirective,
    GrowthCtaImpressionDirective,
    SubscriptionCtaComponent
  ]
})
export class SharedModule { }
