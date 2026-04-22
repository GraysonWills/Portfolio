import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import {
  TradingBotFlags,
  TradingBotService,
  TradingBotSummary,
  TradingBotTableResponse,
} from '../../services/trading-bot.service';
import {
  computeMetrics,
  PerformanceMetrics,
  PresetPeriod,
  resolvePeriod,
  Trade,
} from './trading-metrics';

type LoadState = 'loading' | 'ready' | 'error' | 'disabled';

const DEFAULT_STARTING_EQUITY = 100_000;  // paper-trading default; real starting equity comes from user setting later

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

  // Performance tab — all trades (not just the summary preview) feed this
  allTrades: Trade[] = [];
  presetPeriods: PresetPeriod[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', 'ALL'];
  selectedPeriod: PresetPeriod = '1M';
  customFrom: string | null = null;
  customTo: string | null = null;
  startingEquity = DEFAULT_STARTING_EQUITY;
  metrics: PerformanceMetrics | null = null;

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
    // Fetch every trade so the performance metrics can do historical
    // windowing client-side instead of re-calling the backend.
    this.bot.getTrades(1000).subscribe({
      next: (r: TradingBotTableResponse<Trade>) => {
        this.allTrades = r.items ?? [];
        this.recomputeMetrics();
      },
      error: () => {
        this.allTrades = [];
        this.recomputeMetrics();
      },
    });
  }

  // ─── Performance metrics controls ─────────────────────────────────
  selectPeriod(p: PresetPeriod): void {
    this.selectedPeriod = p;
    this.customFrom = null;
    this.customTo = null;
    this.recomputeMetrics();
  }

  applyCustomRange(): void {
    if (!this.customFrom || !this.customTo) return;
    this.recomputeMetrics();
  }

  setStartingEquity(value: number | string | null): void {
    const parsed = typeof value === 'string' ? parseFloat(value) : value;
    if (!parsed || !Number.isFinite(parsed) || parsed <= 0) return;
    this.startingEquity = parsed;
    this.recomputeMetrics();
  }

  recomputeMetrics(): void {
    const { from, to, label } = resolvePeriod(
      this.customFrom ? null : this.selectedPeriod,
      this.customFrom,
      this.customTo,
    );
    this.metrics = computeMetrics(this.allTrades, {
      from,
      to,
      periodLabel: label,
      startingEquity: this.startingEquity,
    });
  }

  // Formatting helpers for the template
  fmtPct(v: number | null | undefined, digits = 2): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return `${(v * 100).toFixed(digits)}%`;
  }

  fmtSigned(v: number | null | undefined, digits = 2): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(digits)}`;
  }

  fmtDollars(v: number | null | undefined): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const sign = v >= 0 ? '+' : '-';
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  }

  fmtRatio(v: number | null | undefined, digits = 2): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return v.toFixed(digits);
  }

  signClass(v: number | null | undefined): string {
    if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return '';
    return v > 0 ? 'positive' : 'negative';
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
