import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Live client for the mesh Mission Control API on the DGX Spark
 * (services/api/app.py in the mesh repo — /registry, /approvals,
 * /events/stream SSE, /jobs/{correlation_id}).
 *
 * Consumers should treat every call as fallible and fall back to
 * MissionControlMockService demo data when the mesh is unreachable
 * (off-tailnet, Spark asleep) — the UI stays useful either way.
 */

export interface LiveRegistryRow {
  worker_id: string;
  version: string;
  manifest: {
    model_alias: string;
    heartbeat_s: number;
    autonomy: { level: string };
    consumes: Array<{ type: string }>;
    emits: Array<{ type: string }>;
  };
  last_heartbeat: string | null;
}

export interface LiveApproval {
  request_id: string;
  kind: string;
  summary: string;
  preview_uri: string | null;
  risk: string;
  status: string;
  correlation_id: string | null;
  requested_at: string;
  expires_at: string | null;
}

export interface LiveMeshEvent {
  event_id: string;
  type: string;
  occurred_at: string;
  producer: string;
  correlation_id: string;
  causation_id: string | null;
  payload: Record<string, unknown>;
}

export interface LiveJobStep {
  event_id: string;
  type: string;
  occurred_at: string;
  producer: string;
  causation_id: string | null;
}

/** One folded job from GET /jobs — the mesh's whole-board view (MC v1). */
export interface LiveJobSummary {
  correlation_id: string;
  kind: 'post' | 'recording' | 'batch';
  batch_id: string | null;
  title: string | null;
  stage: string;
  status: 'running' | 'gated' | 'parked' | 'done';
  first_event_at: string;
  last_event_at: string;
  last_type: string;
  last_producer: string;
  event_count: number;
  pending_request_id: string | null;
  pending_kind: string | null;
  parked_type: string | null;
}

export interface LiveJobsResponse {
  generated_at: string;
  stages: string[];
  jobs: LiveJobSummary[];
}

export interface LiveBatchSummary {
  batch_id: string;
  expected_count: number;
  status: 'collecting' | 'gated' | 'resolved' | 'expired';
  request_id: string | null;
  created_at: string;
  gate_raised_at: string | null;
  deadline: string | null;
  candidate_count: number;
  assessed_count: number;
  selected_count: number | null;
}

export interface LiveBatchCandidate {
  candidate_id: string;
  batch_id: string;
  source_correlation_id: string;
  title: string;
  angle: string | null;
  brief_uri: string;
  novelty_score: number | null;
  novelty_verdict: string | null;
  closest_ref: string | null;
  selected: boolean | null;
  child_correlation_id: string | null;
  created_at: string;
}

export type LiveBatchDetail = Omit<LiveBatchSummary,
  'candidate_count' | 'assessed_count' | 'selected_count'> & {
  candidates: LiveBatchCandidate[];
};

@Injectable({ providedIn: 'root' })
export class MissionControlApiService implements OnDestroy {
  private readonly base = environment.meshApiUrl;
  private eventSource: EventSource | null = null;
  private readonly events$ = new Subject<LiveMeshEvent>();
  private readonly streamState$ = new Subject<'live' | 'reconnecting'>();

  constructor(
    private http: HttpClient,
    private zone: NgZone,
  ) {}

  health(): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.get<{ ok: boolean }>(`${this.base}/health`));
  }

  registry(): Promise<LiveRegistryRow[]> {
    return firstValueFrom(this.http.get<LiveRegistryRow[]>(`${this.base}/registry`));
  }

  approvals(status = 'pending'): Promise<LiveApproval[]> {
    return firstValueFrom(
      this.http.get<LiveApproval[]>(`${this.base}/approvals`, { params: { status } }),
    );
  }

  preview(requestId: string): Promise<string> {
    return firstValueFrom(
      this.http.get(`${this.base}/approvals/${encodeURIComponent(requestId)}/preview`,
        { responseType: 'text' }),
    );
  }

  decide(requestId: string, decision: 'granted' | 'denied' | 'edited',
         note?: string, editedMarkdown?: string): Promise<{ resolved: boolean; event_id: string }> {
    return firstValueFrom(
      this.http.post<{ resolved: boolean; event_id: string }>(
        `${this.base}/approvals/${encodeURIComponent(requestId)}/decision`,
        { decision, note: note || null, edited_markdown: editedMarkdown || null }),
    );
  }

  job(correlationId: string): Promise<{ correlation_id: string; steps: LiveJobStep[] }> {
    return firstValueFrom(
      this.http.get<{ correlation_id: string; steps: LiveJobStep[] }>(
        `${this.base}/jobs/${encodeURIComponent(correlationId)}`),
    );
  }

  /** MC v1: every job folded from the event log — feeds the pipeline board. */
  jobs(): Promise<LiveJobsResponse> {
    return firstValueFrom(this.http.get<LiveJobsResponse>(`${this.base}/jobs`));
  }

  batches(): Promise<LiveBatchSummary[]> {
    return firstValueFrom(this.http.get<LiveBatchSummary[]>(`${this.base}/batches`));
  }

  batchDetail(batchId: string): Promise<LiveBatchDetail> {
    return firstValueFrom(this.http.get<LiveBatchDetail>(
      `${this.base}/batches/${encodeURIComponent(batchId)}`));
  }

  /** SSE firehose. One shared EventSource; auto-reconnects on fatal close. */
  eventStream(): Observable<LiveMeshEvent> {
    if (!this.eventSource) this.connect();
    return this.events$.asObservable();
  }

  streamState(): Observable<'live' | 'reconnecting'> {
    return this.streamState$.asObservable();
  }

  private connect(): void {
    this.eventSource = new EventSource(`${this.base}/events/stream`);
    this.eventSource.onopen = () =>
      this.zone.run(() => this.streamState$.next('live'));
    this.eventSource.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as LiveMeshEvent;
        this.zone.run(() => this.events$.next(ev));
      } catch {
        /* malformed frame — skip */
      }
    };
    this.eventSource.onerror = () => {
      this.zone.run(() => this.streamState$.next('reconnecting'));
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.eventSource = null;
        setTimeout(() => this.connect(), 4000);
      }
    };
  }

  ngOnDestroy(): void {
    this.eventSource?.close();
  }
}
