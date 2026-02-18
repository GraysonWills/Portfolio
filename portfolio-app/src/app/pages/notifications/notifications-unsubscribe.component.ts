import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SubscriptionService } from '../../services/subscription.service';

@Component({
  selector: 'app-notifications-unsubscribe',
  standalone: false,
  templateUrl: './notifications-unsubscribe.component.html',
  styleUrl: './notifications-unsubscribe.component.scss'
})
export class NotificationsUnsubscribeComponent implements OnInit {
  state: 'confirm' | 'loading' | 'success' | 'error' = 'confirm';
  errorMessage: string = '';
  token: string = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private subs: SubscriptionService
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token') || '';
    this.token = token.trim();
    if (!this.token) {
      this.state = 'error';
      this.errorMessage = 'Missing unsubscribe token.';
      return;
    }
  }

  confirmUnsubscribe(): void {
    if (!this.token) {
      this.state = 'error';
      this.errorMessage = 'Missing unsubscribe token.';
      return;
    }

    this.state = 'loading';
    this.subs.unsubscribe(this.token).subscribe({
      next: () => { this.state = 'success'; },
      error: (err) => {
        this.state = 'error';
        this.errorMessage = err?.error?.error || err?.message || 'Failed to unsubscribe.';
      }
    });
  }

  cancel(): void {
    void this.router.navigate(['/blog']);
  }
}
