import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import {
  TradingBotFlags,
  TradingBotService,
  TradingBotSummary,
  TradingBotTableResponse,
} from '../../services/trading-bot.service';

type LoadState = 'loading' | 'ready' | 'error' | 'disabled';

/**
 * Read-only dashboard for the AI/ML Stock Trading Bot.
 *
 * Sits inside the blog-authoring-gui admin area — auth is handled by
 * the Cognito AuthGuard + AuthInterceptor at the shell level, so this
 * component just focuses on data. Polls /flags every 30s; full
 * refresh on user action.
 *
 * No write surface — kill-switch toggle lives in the Python CLI
 * (`python -m agentic_trader.cli.kill_switch`).
 */
@Component({
  selector: 'app-trading-dashboard',
  standalone: false,
  templateUrl: './trading-dashboard.component.html',
  styleUrl: './trading-dashboard.component.scss',
})
export class TradingDashboardComponent implements OnInit, OnDestroy {
  state: LoadState = 'loading';
  errorMessage = '';

  summary: TradingBotSummary | null = null;
  journal: any[] = [];
  sentiment: any[] = [];
  drift: any[] = [];

  private pollSub: Subscription | null = null;

  constructor(private bot: TradingBotService) {}

  ngOnInit(): void {
    this.refreshAll();
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  refreshAll(): void {
    this.state = 'loading';
    this.errorMessage = '';
    this.bot.getSummary().subscribe({
      next: (s) => {
        this.summary = s;
        this.state = 'ready';
        this.startPolling();
        this.loadAuxiliaryTables();
      },
      error: (err) => {
        if (err?.status === 503) {
          this.state = 'disabled';
          this.errorMessage =
            err?.error?.hint ||
            'Trading bot API is disabled on the server. Set TRADING_BOT_API_ENABLED=true after the CDK stack is deployed.';
          return;
        }
        if (err?.status === 401 || err?.status === 403) {
          this.state = 'error';
          this.errorMessage =
            'Authentication failed. Your session may have expired — try signing in again.';
          return;
        }
        this.state = 'error';
        this.errorMessage = err?.error?.error || err?.message || 'Failed to load dashboard.';
      },
    });
  }

  private loadAuxiliaryTables(): void {
    this.bot.getJournal(50).subscribe({
      next: (r: TradingBotTableResponse) => { this.journal = r.items; },
      error: () => { this.journal = []; },
    });
    this.bot.getSentiment(30).subscribe({
      next: (r: TradingBotTableResponse) => { this.sentiment = r.items; },
      error: () => { this.sentiment = []; },
    });
    this.bot.getDrift(10).subscribe({
      next: (r: TradingBotTableResponse) => { this.drift = r.items; },
      error: () => { this.drift = []; },
    });
  }

  private startPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = interval(30_000).subscribe(() => {
      this.bot.getFlags().subscribe({
        next: (flags) => {
          if (this.summary) this.summary.flags = flags;
        },
        error: () => { /* silent — keep last known state */ },
      });
    });
  }

  get flags(): TradingBotFlags | null {
    return this.summary?.flags || null;
  }

  get killSwitchOn(): boolean {
    return this.flags?.killSwitch === 'on';
  }

  get modeBadgeClass(): string {
    const mode = this.flags?.mode;
    if (mode === 'live') return 'flag-chip mode-live';
    if (mode === 'paper') return 'flag-chip mode-paper';
    return 'flag-chip mode-off';
  }
}
