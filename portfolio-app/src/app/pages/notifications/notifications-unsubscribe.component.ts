import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SubscriptionService } from '../../services/subscription.service';

@Component({
  selector: 'app-notifications-unsubscribe',
  standalone: false,
  templateUrl: './notifications-unsubscribe.component.html',
  styleUrl: './notifications-unsubscribe.component.scss'
})
export class NotificationsUnsubscribeComponent implements OnInit {
  state: 'loading' | 'success' | 'error' = 'loading';
  errorMessage: string = '';

  constructor(
    private route: ActivatedRoute,
    private subs: SubscriptionService
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!token.trim()) {
      this.state = 'error';
      this.errorMessage = 'Missing unsubscribe token.';
      return;
    }

    this.subs.unsubscribe(token).subscribe({
      next: () => { this.state = 'success'; },
      error: (err) => {
        this.state = 'error';
        this.errorMessage = err?.error?.error || err?.message || 'Failed to unsubscribe.';
      }
    });
  }
}

