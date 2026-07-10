import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CarouselModule } from 'primeng/carousel';
import { SharedModule } from '../../../shared/shared.module';
import { BlogDetailComponent } from './blog-detail.component';

const routes: Routes = [
  {
    path: ':id',
    component: BlogDetailComponent,
    data: {
      title: 'Blog Post',
      description: 'A blog post by Grayson Wills.'
    }
  }
];

@NgModule({
  declarations: [BlogDetailComponent],
  imports: [
    SharedModule,
    CarouselModule,
    RouterModule.forChild(routes)
  ]
})
export class BlogDetailModule { }
