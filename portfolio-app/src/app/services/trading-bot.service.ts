import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TradingBotFlags {
  mode: string | null;           // paper | live | off
  killSwitch: string | null;     // on | off
  armed: string | null;          // "true" | "false"
  activeModel: string | null;    // S3 key or ""
  strategyWeights: string | null;// JSON-encoded map
}

export interface TradingBotCounts {
  positions: number;
  openOrders: number;
  recentTrades: number;
}

export interface TradingBotSummary {
  flags: TradingBotFlags;
  counts: TradingBotCounts;
  positionsPreview: any[];
  ordersPreview: any[];
  tradesPreview: any[];
  generatedAt: string;
}

export interface TradingBotTableResponse<T = any> {
  count: number;
  items: T[];
}

/**
 * Client for the /api/trading-bot/* endpoints hosted by redis-api-server.
 *
 * Requires an admin key (same one used for /api/admin). The key is stored
 * in the browser only for the current session — the component that loads
 * the dashboard prompts for it once and passes it to this service.
 *
 * Everything here is best-effort: individual endpoints may 503 (feature
 * off) or 500 (DynamoDB unreachable), and the UI degrades gracefully.
 */
@Injectable({ providedIn: 'root' })
export class TradingBotService {
  private readonly baseUrl = `${environment.redisApiUrl}/trading-bot`;
  private adminKey: string | null = null;

  setAdminKey(key: string): void {
    this.adminKey = key?.trim() || null;
  }

  hasAdminKey(): boolean {
    return !!this.adminKey;
  }

  private headers(): HttpHeaders {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.adminKey) h['X-Admin-Key'] = this.adminKey;
    return new HttpHeaders(h);
  }

  getSummary(): Observable<TradingBotSummary> {
    return this.http.get<TradingBotSummary>(`${this.baseUrl}/summary`, { headers: this.headers() });
  }

  getFlags(): Observable<TradingBotFlags> {
    return this.http.get<TradingBotFlags>(`${this.baseUrl}/flags`, { headers: this.headers() });
  }

  getPositions(limit = 200): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/positions?limit=${limit}`, { headers: this.headers() });
  }

  getOrders(limit = 200): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/orders?limit=${limit}`, { headers: this.headers() });
  }

  getTrades(limit = 200): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/trades?limit=${limit}`, { headers: this.headers() });
  }

  getJournal(limit = 200): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/journal?limit=${limit}`, { headers: this.headers() });
  }

  getSentiment(limit = 50): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/sentiment?limit=${limit}`, { headers: this.headers() });
  }

  getDrift(limit = 50): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/drift?limit=${limit}`, { headers: this.headers() });
  }

  constructor(private http: HttpClient) {}
}
