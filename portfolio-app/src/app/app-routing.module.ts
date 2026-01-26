import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LandingComponent } from './pages/landing/landing.component';
import { WorkComponent } from './pages/work/work.component';
import { ProjectsComponent } from './pages/projects/projects.component';
import { BlogComponent } from './pages/blog/blog.component';

const routes: Routes = [
  { path: '', component: LandingComponent, data: { title: 'Home' } },
  { path: 'work', component: WorkComponent, data: { title: 'Work Experience' } },
  { path: 'projects', component: ProjectsComponent, data: { title: 'Projects' } },
  { path: 'blog', component: BlogComponent, data: { title: 'Blog' } },
  { path: '**', redirectTo: '', pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'top' })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
