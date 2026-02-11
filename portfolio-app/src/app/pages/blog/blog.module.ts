import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { BlogComponent } from './blog.component';
import { BlogDetailComponent } from './blog-detail/blog-detail.component';

const routes: Routes = [
  { path: '', component: BlogComponent, data: { title: 'Blog' } },
  { path: ':id', component: BlogDetailComponent, data: { title: 'Blog Post' } }
];

@NgModule({
  declarations: [BlogComponent, BlogDetailComponent],
  imports: [
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class BlogModule { }
