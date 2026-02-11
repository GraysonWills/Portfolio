import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ProjectsComponent } from './projects.component';

const routes: Routes = [
  { path: '', component: ProjectsComponent, data: { title: 'Projects' } }
];

@NgModule({
  declarations: [ProjectsComponent],
  imports: [
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class ProjectsModule { }
