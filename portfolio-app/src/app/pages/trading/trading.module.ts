import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { TradingDashboardComponent } from './trading-dashboard.component';

const routes: Routes = [
  {
    path: '',
    component: TradingDashboardComponent,
    data: {
      title: 'Trading Bot Dashboard',
      description: 'Live state of the AI/ML stock trading bot — positions, orders, trades, journal, drift, sentiment.',
    },
  },
];

@NgModule({
  declarations: [TradingDashboardComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class TradingModule {}
