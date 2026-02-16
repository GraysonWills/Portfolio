import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LandingComponent } from './pages/landing/landing.component';

const routes: Routes = [
  {
    path: '',
    component: LandingComponent,
    data: {
      title: 'Grayson Wills — Solution Architect & Data Specialist',
      description: 'Portfolio of Grayson Wills — Solution Architect and Data Specialist. Expertise in cloud architecture, full-stack development, and data engineering.'
    }
  },
  {
    path: 'work',
    loadChildren: () => import('./pages/work/work.module').then(m => m.WorkModule),
    data: {
      title: 'Work Experience',
      description: 'Work experience of Grayson Wills across AI engineering, data science, and full-stack development.'
    }
  },
  {
    path: 'projects',
    loadChildren: () => import('./pages/projects/projects.module').then(m => m.ProjectsModule),
    data: {
      title: 'Projects',
      description: 'Selected projects by Grayson Wills across cloud architecture, full-stack development, and AI systems.'
    }
  },
  {
    path: 'blog',
    loadChildren: () => import('./pages/blog/blog.module').then(m => m.BlogModule),
    data: {
      title: 'Blog',
      description: 'Engineering writing and notes by Grayson Wills.'
    }
  },
  {
    path: 'notifications',
    loadChildren: () => import('./pages/notifications/notifications.module').then(m => m.NotificationsModule),
    data: {
      title: 'Email Notifications',
      description: 'Confirm or unsubscribe from email notifications.'
    }
  },
  { path: '**', redirectTo: '', pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'top' })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
