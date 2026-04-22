import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import {
  TradingBotFlags,
  TradingBotService,
  TradingBotSummary,
  TradingBotTableResponse,
} from '../../services/trading-bot.service';

type LoadState = 'needs-key' | 'loading' | 'ready' | 'error' | 'disabled';

/**
 * Read-only dashboard for the AI/ML Stock Trading Bot.
 *
 * Gates behind an admin-key prompt (same key as /api/admin). Once unlocked,
 * polls /api/trading-bot/flags every 30s and refreshes the full summary
 * on user action. No write surface — kill-switch toggle lives in the
 * Python CLI (`python -m agentic_trader.cli.kill_switch`).
 */
@Component({
  selector: 'app-trading-dashboard',
  standalone: false,
  templateUrl: './trading-dashboard.component.html',
  styleUrl: './trading-dashboard.component.scss',
})
export class TradingDashboardComponent implements OnInit, OnDestroy {
  state: LoadState = 'needs-key';
  errorMessage = '';
  adminKey = '';

  summary: TradingBotSummary | null = null;
  journal: any[] = [];
  sentiment: any[] = [];
  drift: any[] = [];

  private pollSub: Subscription | null = null;

  constructor(private bot: TradingBotService) {}

  ngOnInit(): void {
    // If key is already stored in session (same tab), reuse it
    const cached = typeof window !== 'undefined' ? sessionStorage.getItem('tradingBotAdminKey') : null;
    if (cached) {
      this.adminKey = cached;
      this.submitKey();
    }
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  submitKey(): void {
    if (!this.adminKey?.trim()) {
      this.errorMessage = 'Admin key is required.';
      return;
    }
    this.bot.setAdminKey(this.adminKey.trim());
    try {
      sessionStorage.setItem('tradingBotAdminKey', this.adminKey.trim());
    } catch { /* ignore storage errors */ }
    this.refreshAll();
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
          this.errorMessage = err?.error?.hint || 'Trading bot dashboard is disabled on the server.';
          return;
        }
        if (err?.status === 401) {
          this.state = 'needs-key';
          this.errorMessage = 'Invalid admin key. Try again.';
          sessionStorage.removeItem('tradingBotAdminKey');
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
    if (mode === 'live') return 'mode-badge mode-live';
    if (mode === 'paper') return 'mode-badge mode-paper';
    return 'mode-badge mode-off';
  }

  resetKey(): void {
    sessionStorage.removeItem('tradingBotAdminKey');
    this.adminKey = '';
    this.state = 'needs-key';
    this.summary = null;
  }
}
