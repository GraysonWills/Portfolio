import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LandingComponent } from './pages/landing/landing.component';
import { NotFoundComponent } from './pages/not-found/not-found.component';

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
    pathMatch: 'full',
    loadChildren: () => import('./pages/blog/blog.module').then(m => m.BlogModule),
    data: {
      title: 'Blog',
      description: 'Engineering writing and notes by Grayson Wills.'
    }
  },
  {
    path: 'blog',
    loadChildren: () => import('./pages/blog/blog-detail/blog-detail.module').then(m => m.BlogDetailModule),
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
  {
    path: 'account',
    loadChildren: () => import('./pages/account/account.module').then(m => m.AccountModule),
    data: {
      title: 'Account',
      description: 'Manage your reader account, profile, and email subscriptions.'
    }
  },
  {
    path: '**',
    component: NotFoundComponent,
    data: {
      title: 'Page Not Found',
      description: 'The requested page could not be found.',
      robots: 'noindex, nofollow'
    }
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'disabled' })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
