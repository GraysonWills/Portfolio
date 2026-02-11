import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { WorkComponent } from './work.component';

const routes: Routes = [
  { path: '', component: WorkComponent, data: { title: 'Work Experience' } }
];

@NgModule({
  declarations: [WorkComponent],
  imports: [
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class WorkModule { }
