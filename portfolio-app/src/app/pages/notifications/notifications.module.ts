import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { NotificationsConfirmComponent } from './notifications-confirm.component';
import { NotificationsUnsubscribeComponent } from './notifications-unsubscribe.component';

const routes: Routes = [
  {
    path: 'confirm',
    component: NotificationsConfirmComponent,
    data: {
      title: 'Subscription Confirmed',
      description: 'Confirm your email subscription for Grayson Wills blog updates.'
    }
  },
  {
    path: 'unsubscribe',
    component: NotificationsUnsubscribeComponent,
    data: {
      title: 'Unsubscribe',
      description: 'Unsubscribe from Grayson Wills blog update emails.'
    }
  },
  { path: '', redirectTo: 'confirm', pathMatch: 'full' }
];

@NgModule({
  declarations: [
    NotificationsConfirmComponent,
    NotificationsUnsubscribeComponent
  ],
  imports: [
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class NotificationsModule {}

