import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from '../../guards/auth.guard';
import { DashboardComponent } from '../../pages/dashboard/dashboard.component';
import { ContentStudioComponent } from '../../pages/content-studio/content-studio.component';
import { SubscribersComponent } from '../../pages/subscribers/subscribers.component';
import { CollectionsComponent } from '../../pages/collections/collections.component';
import { TradingDashboardComponent } from '../../pages/trading/trading-dashboard.component';

const routes: Routes = [
  { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard] },
  { path: 'content', component: ContentStudioComponent, canActivate: [AuthGuard] },
  { path: 'subscribers', component: SubscribersComponent, canActivate: [AuthGuard] },
  { path: 'collections', component: CollectionsComponent, canActivate: [AuthGuard] },
  { path: 'trading', component: TradingDashboardComponent, canActivate: [AuthGuard] },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminRoutingModule {}

