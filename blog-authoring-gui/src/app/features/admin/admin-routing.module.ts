import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from '../../guards/auth.guard';
import { DashboardComponent } from '../../pages/dashboard/dashboard.component';
import { ContentStudioComponent } from '../../pages/content-studio/content-studio.component';
import { SubscribersComponent } from '../../pages/subscribers/subscribers.component';
import { CollectionsComponent } from '../../pages/collections/collections.component';
import { CommentsComponent } from '../../pages/comments/comments.component';
import { DistributionComponent } from '../../pages/distribution/distribution.component';
import { AiQueueComponent } from '../../pages/ai-queue/ai-queue.component';
import { MissionControlComponent } from '../../pages/mission-control/mission-control.component';

const routes: Routes = [
  { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard] },
  { path: 'content', component: ContentStudioComponent, canActivate: [AuthGuard] },
  { path: 'subscribers', component: SubscribersComponent, canActivate: [AuthGuard] },
  { path: 'comments', component: CommentsComponent, canActivate: [AuthGuard] },
  { path: 'collections', component: CollectionsComponent, canActivate: [AuthGuard] },
  { path: 'distribution', component: DistributionComponent, canActivate: [AuthGuard] },
  { path: 'ai', component: AiQueueComponent, canActivate: [AuthGuard] },
  { path: 'mission-control', component: MissionControlComponent, canActivate: [AuthGuard] },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminRoutingModule {}
