import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AccountComponent } from './account.component';

const routes: Routes = [
  {
    path: '',
    component: AccountComponent,
    data: {
      title: 'Account',
      description: 'Manage your Grayson Wills reader account, profile, and email subscriptions.'
    }
  }
];

@NgModule({
  declarations: [AccountComponent],
  imports: [
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class AccountModule {}
