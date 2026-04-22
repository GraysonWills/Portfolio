import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { FileUploadModule } from 'primeng/fileupload';
import { TagModule } from 'primeng/tag';
import { DropdownModule } from 'primeng/dropdown';
import { CalendarModule } from 'primeng/calendar';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { EditorModule } from 'primeng/editor';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';

import { DashboardComponent } from '../../pages/dashboard/dashboard.component';
import { ContentStudioComponent } from '../../pages/content-studio/content-studio.component';
import { SubscribersComponent } from '../../pages/subscribers/subscribers.component';
import { CollectionsComponent } from '../../pages/collections/collections.component';
import { TradingDashboardComponent } from '../../pages/trading/trading-dashboard.component';
import { BlogEditorComponent } from '../../components/blog-editor/blog-editor.component';
import { ImageUploaderComponent } from '../../components/image-uploader/image-uploader.component';
import { AdminRoutingModule } from './admin-routing.module';

@NgModule({
  declarations: [
    DashboardComponent,
    ContentStudioComponent,
    SubscribersComponent,
    CollectionsComponent,
    TradingDashboardComponent,
    BlogEditorComponent,
    ImageUploaderComponent,
  ],
  imports: [
    CommonModule,
    DragDropModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    CardModule,
    DialogModule,
    ToastModule,
    FileUploadModule,
    TagModule,
    DropdownModule,
    CalendarModule,
    ToggleButtonModule,
    EditorModule,
    ConfirmDialogModule,
    TooltipModule,
    AdminRoutingModule,
  ],
})
export class AdminModule {}
