/**
 * Client-side performance metrics for the trading dashboard.
 *
 * Computes daily-return-level statistics from the raw trades list so we
 * don't need a dedicated backend route per metric. Mirrors what
 * `agentic_trader/backtest/advanced_metrics.py` does on the server side.
 *
 * Input: closed trades with `timestamp_sold` and `net_pnl`. Open
 * positions and their unrealized P&L are not counted — we only mark
 * returns when a trade closes, matching how the walk-forward evaluator
 * scores things.
 */

export interface Trade {
  trade_id: string;
  symbol?: string;
  strategy_id?: string;
  side?: string;
  net_pnl?: number;
  gross_pnl?: number;
  timestamp_sold?: string;   // ISO
  timestamp_bought?: string; // ISO
  quantity?: number;
  bought_price?: number;
  sold_price?: number;
}

export interface DailyReturn {
  date: string;              // YYYY-MM-DD
  pnl: number;               // $
  pct?: number;              // filled when a starting-equity baseline is supplied
  tradeCount: number;
}

export interface PerformanceMetrics {
  periodLabel: string;
  tradeCount: number;
  totalPnl: number;
  totalReturnPct: number | null;   // vs. starting equity (null if unknown)
  annualizedReturnPct: number | null;
  todayPnl: number;
  todayReturnPct: number | null;
  yesterdayPnl: number;
  yesterdayReturnPct: number | null;
  bestDayPnl: number;
  bestDayDate: string | null;
  worstDayPnl: number;
  worstDayDate: string | null;
  sharpe: number | null;       // annualized
  sortino: number | null;
  calmar: number | null;
  maxDrawdownPct: number | null;
  hitRatePct: number | null;
  profitFactor: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  winLossRatio: number | null;
  currentStreak: number;       // positive = winning days in a row, negative = losing
}

// ─── Date helpers ──────────────────────────────────────────────────────
function toDay(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

export type PresetPeriod = '1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y' | 'ALL';

export function resolvePeriod(
  preset: PresetPeriod | null,
  customFrom?: string | null,
  customTo?: string | null,
): { from: Date; to: Date; label: string } {
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = customTo ? new Date(customTo) : now;

  if (customFrom) {
    return {
      from: new Date(customFrom),
      to: end,
      label: `${customFrom.slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
    };
  }

  switch (preset) {
    case '1D':  return { from: todayMidnight, to: end, label: 'Today' };
    case '1W':  return { from: new Date(Date.now() - 7 * 86_400_000),   to: end, label: 'Last 7 days' };
    case '1M':  return { from: new Date(Date.now() - 30 * 86_400_000),  to: end, label: 'Last 30 days' };
    case '3M':  return { from: new Date(Date.now() - 90 * 86_400_000),  to: end, label: 'Last 90 days' };
    case 'YTD': return { from: new Date(now.getFullYear(), 0, 1),       to: end, label: 'Year to date' };
    case '1Y':  return { from: new Date(Date.now() - 365 * 86_400_000), to: end, label: 'Last 12 months' };
    case 'ALL':
    default:    return { from: new Date(0),                             to: end, label: 'All time' };
  }
}

// ─── Trade → daily return aggregation ──────────────────────────────────
export function tradesToDailyReturns(
  trades: Trade[],
  startingEquity: number | null = null,
): DailyReturn[] {
  const byDay = new Map<string, DailyReturn>();
  for (const t of trades) {
    const day = toDay(t.timestamp_sold);
    if (!day) continue;
    const pnl = Number(t.net_pnl ?? t.gross_pnl ?? 0);
    if (!Number.isFinite(pnl)) continue;
    const prior = byDay.get(day);
    if (prior) {
      prior.pnl += pnl;
      prior.tradeCount += 1;
    } else {
      byDay.set(day, { date: day, pnl, tradeCount: 1 });
    }
  }
  const sorted = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (startingEquity && startingEquity > 0) {
    let equity = startingEquity;
    for (const d of sorted) {
      d.pct = d.pnl / equity;
      equity += d.pnl;
    }
  }
  return sorted;
}

// ─── Metric primitives ─────────────────────────────────────────────────
function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: number[], bias = 1): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - bias);
  return Math.sqrt(v);
}

function downsideStdDev(xs: number[]): number {
  const below = xs.filter((x) => x < 0);
  return stdDev(below);
}

function maxDrawdown(returns: number[]): number {
  let peak = 1;
  let cumulative = 1;
  let worst = 0;
  for (const r of returns) {
    cumulative *= 1 + r;
    peak = Math.max(peak, cumulative);
    worst = Math.min(worst, cumulative / peak - 1);
  }
  return -worst;
}

// ─── The public metric builder ─────────────────────────────────────────
export function computeMetrics(
  trades: Trade[],
  options: {
    from: Date;
    to: Date;
    periodLabel: string;
    startingEquity?: number | null;
    barsPerYear?: number;
  },
): PerformanceMetrics {
  const starting = options.startingEquity ?? null;
  const barsPerYear = options.barsPerYear ?? 252;

  // Filter trades into the requested window
  const inPeriod = trades.filter((t) => {
    const day = toDay(t.timestamp_sold);
    if (!day) return false;
    const d = new Date(day);
    return d >= options.from && d <= options.to;
  });

  const daily = tradesToDailyReturns(inPeriod, starting);
  const pctReturns = daily.map((d) => d.pct ?? 0);
  const totalPnl = daily.reduce((a, d) => a + d.pnl, 0);

  // Today / yesterday
  const todayKey = new Date().toISOString().slice(0, 10);
  const yesterdayDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const todayRow = daily.find((d) => d.date === todayKey);
  const yesterdayRow = daily.find((d) => d.date === yesterdayDate);

  // Best / worst day
  let bestRow: DailyReturn | undefined;
  let worstRow: DailyReturn | undefined;
  for (const d of daily) {
    if (!bestRow || d.pnl > bestRow.pnl) bestRow = d;
    if (!worstRow || d.pnl < worstRow.pnl) worstRow = d;
  }

  // Risk-adjusted
  const mu = mean(pctReturns);
  const sd = stdDev(pctReturns);
  const sharpe = sd > 0 ? (mu / sd) * Math.sqrt(barsPerYear) : null;
  const downsideSd = downsideStdDev(pctReturns);
  const sortino = downsideSd > 0 ? (mu / downsideSd) * Math.sqrt(barsPerYear) : null;
  const maxDD = daily.length > 1 ? maxDrawdown(pctReturns) : null;
  const periodYears = Math.max((options.to.getTime() - options.from.getTime()) / (365 * 86_400_000), 1 / 252);
  const annualized = starting && starting > 0 && totalPnl !== 0
    ? Math.pow(1 + totalPnl / starting, 1 / periodYears) - 1
    : null;
  const calmar = annualized !== null && maxDD !== null && maxDD > 0 ? annualized / maxDD : null;

  // Trade quality
  const wins = inPeriod.filter((t) => Number(t.net_pnl ?? 0) > 0);
  const losses = inPeriod.filter((t) => Number(t.net_pnl ?? 0) < 0);
  const hitRate = inPeriod.length > 0 ? wins.length / inPeriod.length : null;
  const winSum = wins.reduce((a, t) => a + Number(t.net_pnl ?? 0), 0);
  const lossSum = Math.abs(losses.reduce((a, t) => a + Number(t.net_pnl ?? 0), 0));
  const profitFactor = lossSum > 0 ? winSum / lossSum : null;
  const averageWin = wins.length > 0 ? winSum / wins.length : null;
  const averageLoss = losses.length > 0 ? -lossSum / losses.length : null;
  const winLossRatio = averageWin !== null && averageLoss !== null && averageLoss < 0
    ? Math.abs(averageWin / averageLoss)
    : null;

  // Streak: consecutive days of same sign ending at the most recent trading day
  let currentStreak = 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    const sign = Math.sign(daily[i].pnl);
    if (sign === 0) break;
    if (currentStreak === 0) {
      currentStreak = sign;
    } else if (Math.sign(currentStreak) === sign) {
      currentStreak += sign;
    } else {
      break;
    }
  }

  return {
    periodLabel: options.periodLabel,
    tradeCount: inPeriod.length,
    totalPnl,
    totalReturnPct: starting && starting > 0 ? totalPnl / starting : null,
    annualizedReturnPct: annualized,
    todayPnl: todayRow?.pnl ?? 0,
    todayReturnPct: todayRow?.pct ?? null,
    yesterdayPnl: yesterdayRow?.pnl ?? 0,
    yesterdayReturnPct: yesterdayRow?.pct ?? null,
    bestDayPnl: bestRow?.pnl ?? 0,
    bestDayDate: bestRow?.date ?? null,
    worstDayPnl: worstRow?.pnl ?? 0,
    worstDayDate: worstRow?.date ?? null,
    sharpe,
    sortino,
    calmar,
    maxDrawdownPct: maxDD,
    hitRatePct: hitRate,
    profitFactor,
    averageWin,
    averageLoss,
    winLossRatio,
    currentStreak,
  };
}
