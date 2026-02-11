/**
 * Shared Module
 * Common PrimeNG imports and utilities shared across feature modules
 */
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

// PrimeNG Modules
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CarouselModule } from 'primeng/carousel';
import { TimelineModule } from 'primeng/timeline';
import { ChipModule } from 'primeng/chip';
import { TagModule } from 'primeng/tag';
import { DataViewModule } from 'primeng/dataview';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { DialogModule } from 'primeng/dialog';
import { ProgressBarModule } from 'primeng/progressbar';

import { ScrollRevealDirective } from '../directives/scroll-reveal.directive';

@NgModule({
  declarations: [ScrollRevealDirective],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    CarouselModule,
    TimelineModule,
    ChipModule,
    TagModule,
    DataViewModule,
    InputTextModule,
    DropdownModule,
    DialogModule,
    ProgressBarModule
  ],
  exports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    CarouselModule,
    TimelineModule,
    ChipModule,
    TagModule,
    DataViewModule,
    InputTextModule,
    DropdownModule,
    DialogModule,
    ProgressBarModule,
    ScrollRevealDirective
  ]
})
export class SharedModule { }
