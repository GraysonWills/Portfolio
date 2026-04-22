import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
 * Auth is handled by the shared AuthInterceptor — it attaches the
 * Cognito Bearer token to every /api/ request. No per-request config
 * needed here.
 *
 * Every endpoint may 503 (feature off) or 500 (DynamoDB unreachable);
 * the dashboard component handles those states.
 */
@Injectable({ providedIn: 'root' })
export class TradingBotService {
  private readonly baseUrl = `${environment.redisApiUrl}/trading-bot`;

  constructor(private http: HttpClient) {}

  getSummary(): Observable<TradingBotSummary> {
    return this.http.get<TradingBotSummary>(`${this.baseUrl}/summary`);
  }

  getFlags(): Observable<TradingBotFlags> {
    return this.http.get<TradingBotFlags>(`${this.baseUrl}/flags`);
  }

  getPositions(limit = 200): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/positions?limit=${limit}`);
  }

  getOrders(limit = 200): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/orders?limit=${limit}`);
  }

  getTrades(limit = 200): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/trades?limit=${limit}`);
  }

  getJournal(limit = 200): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/journal?limit=${limit}`);
  }

  getSentiment(limit = 50): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/sentiment?limit=${limit}`);
  }

  getDrift(limit = 50): Observable<TradingBotTableResponse> {
    return this.http.get<TradingBotTableResponse>(`${this.baseUrl}/drift?limit=${limit}`);
  }
}
