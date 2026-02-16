import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SubscriptionService } from '../../services/subscription.service';

@Component({
  selector: 'app-notifications-confirm',
  standalone: false,
  templateUrl: './notifications-confirm.component.html',
  styleUrl: './notifications-confirm.component.scss'
})
export class NotificationsConfirmComponent implements OnInit {
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
      this.errorMessage = 'Missing confirmation token.';
      return;
    }

    this.subs.confirm(token).subscribe({
      next: () => { this.state = 'success'; },
      error: (err) => {
        this.state = 'error';
        this.errorMessage = err?.error?.error || err?.message || 'Failed to confirm subscription.';
      }
    });
  }
}

