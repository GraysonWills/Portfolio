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

@NgModule({
  declarations: [ScrollRevealDirective],
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
    ScrollRevealDirective
  ]
})
export class SharedModule { }
