import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { WorkComponent } from './work.component';

const routes: Routes = [
  {
    path: '',
    component: WorkComponent,
    data: {
      title: 'Work Experience',
      description: 'Work experience of Grayson Wills across AI engineering, data science, and full-stack development.'
    }
  }
];

@NgModule({
  declarations: [WorkComponent],
  imports: [
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class WorkModule { }
