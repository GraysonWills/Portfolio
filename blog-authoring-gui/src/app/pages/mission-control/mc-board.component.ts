import {
  Component, EventEmitter, OnDestroy, OnInit, Output,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  LiveApproval, LiveBatchSummary, LiveJobSummary, MissionControlApiService,
} from '../../services/mission-control-api.service';

/**
 * The pipeline board (MC v1) — batch lanes × golden-path stage columns with
 * three semantic zoom levels (mesh dots / chips / cards). Mirrors the mesh's
 * own Mission Control board: zoom trades detail for density, never CSS scale.
 */

interface Lane {
  batch: LiveBatchSummary | null;   // null = the "direct" lane
  meta: string;
  gatePending: boolean;
  cells: LiveJobSummary[][];        // one bucket per stage column
  empty: boolean;
}

interface Section {
  pipeline: string;
  label: string;
  stages: string[];
  stageCounts: number[];
  lanes: Lane[];
  count: number;
}

const ZOOM_KEY = 'studio-mc-zoom';
export const ZOOM_LEVELS = ['mesh', 'chips', 'cards'] as const;
const PIPE_LABELS: Record<string, string> = {
  blog: 'Blog / golden path', linkedin: 'LinkedIn posts',
  snippet: 'Social snippets', video: 'Video clips',
};
const PIPE_ORDER = ['blog', 'linkedin', 'snippet', 'video'];

@Component({
  selector: 'app-mc-board',
  templateUrl: './mc-board.component.html',
  styleUrl: './mc-board.component.scss',
  standalone: false,
})
export class McBoardComponent implements OnInit, OnDestroy {
  @Output() openJob = new EventEmitter<string>();
  @Output() openApprovals = new EventEmitter<void>();
  @Output() openBatches = new EventEmitter<void>();

  pipelines: Record<string, string[]> = {
    blog: ['ingest', 'transcript', 'topics', 'draft', 'validate',
           'review', 'publish', 'announce', 'posted'],
  };
  sections: Section[] = [];
  gatesWaiting = 0;
  parkedCount = 0;
  demo = false;
  loaded = false;
  zoom = 1;
  readonly zoomLevels = ZOOM_LEVELS;

  private jobs: LiveJobSummary[] = [];
  private batches: LiveBatchSummary[] = [];
  private approvals: LiveApproval[] = [];
  private sub: Subscription | null = null;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private wheelAcc = 0;

  constructor(private api: MissionControlApiService) {}

  ngOnInit(): void {
    const raw = localStorage.getItem(ZOOM_KEY);
    const saved = raw === null ? NaN : Number(raw);
    this.zoom = Number.isInteger(saved) && saved >= 0 && saved <= 2 ? saved : 1;
    void this.reload();
    // SSE-driven debounced refetch — the client never mirrors the stage
    // machine, it just re-asks the server (same contract as the mesh page)
    this.sub = this.api.eventStream().subscribe(() => this.scheduleRefetch());
    this.pollTimer = setInterval(() => void this.reload(), 30000);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private scheduleRefetch(): void {
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = setTimeout(() => void this.reload(), 1200);
  }

  async reload(): Promise<void> {
    try {
      const [jobsResp, batches, approvals] = await Promise.all([
        this.api.jobs(), this.api.batches(), this.api.approvals('pending'),
      ]);
      this.pipelines = jobsResp.pipelines || { blog: jobsResp.stages };
      this.jobs = jobsResp.jobs;
      this.batches = batches;
      this.approvals = approvals;
      this.demo = false;
    } catch {
      this.demo = true;
      this.jobs = [];
      this.batches = [];
      this.approvals = [];
    }
    this.rebuild();
    this.loaded = true;
  }

  private rebuild(): void {
    const onBoard = this.jobs.filter((j) =>
      j.kind !== 'batch' &&
      !(j.status === 'done' &&
        Date.now() - new Date(j.last_event_at).getTime() > 24 * 3600e3));

    this.gatesWaiting = this.approvals.length;
    this.parkedCount = this.jobs.filter((j) => j.status === 'parked').length;

    // group jobs by pipeline (default blog for legacy rows without the field),
    // then render each pipeline as its own section with its own stage columns —
    // otherwise a linkedin/video job's stage matches no blog column and vanishes
    const byPipe = new Map<string, LiveJobSummary[]>();
    for (const j of onBoard) {
      const p = j.pipeline && this.pipelines[j.pipeline] ? j.pipeline : 'blog';
      (byPipe.get(p) ?? byPipe.set(p, []).get(p)!).push(j);
    }

    const order = [...PIPE_ORDER, ...Object.keys(this.pipelines)
      .filter((p) => !PIPE_ORDER.includes(p))];
    const sections: Section[] = [];
    for (const pipe of order) {
      const stages = this.pipelines[pipe];
      if (!stages) continue;
      const jobs = byPipe.get(pipe) ?? [];
      // blog keeps its batch × direct lanes; every other pipeline is one lane
      const lanes = pipe === 'blog'
        ? this.blogLanes(jobs, stages)
        : (jobs.length
            ? [{ batch: null, meta: this.flatMeta(jobs), gatePending: false,
                 cells: this.bucket(jobs, stages), empty: false }]
            : []);
      if (!lanes.length) continue;   // hide empty non-blog pipelines
      sections.push({
        pipeline: pipe, label: PIPE_LABELS[pipe] ?? pipe, stages,
        stageCounts: stages.map((s) => jobs.filter((j) => j.stage === s).length),
        lanes, count: jobs.length,
      });
    }
    this.sections = sections;
  }

  /** blog's batch-threaded lanes (collecting/gated batches + a direct lane). */
  private blogLanes(onBoard: LiveJobSummary[], stages: string[]): Lane[] {
    // a batch earns a lane if it has live jobs, is collecting, or its gate is
    // actually pending — resolved history belongs to the Batches view
    const pendingIds = new Set(this.approvals.map((a) => a.request_id));
    const laneWorthy = (b: LiveBatchSummary) =>
      onBoard.some((j) => j.batch_id === b.batch_id) ||
      b.status === 'collecting' ||
      (b.status === 'gated' && !!b.request_id && pendingIds.has(b.request_id));

    const lanes: Lane[] = this.batches.filter(laneWorthy).map((b) => {
      const mine = onBoard.filter((j) => j.batch_id === b.batch_id);
      return {
        batch: b,
        meta: this.laneMeta(b),
        gatePending: b.status === 'gated' && !!b.request_id && pendingIds.has(b.request_id),
        cells: this.bucket(mine, stages),
        empty: mine.length === 0,
      };
    });
    const direct = onBoard.filter((j) => !j.batch_id);
    if (direct.length) {
      lanes.push({ batch: null, meta: 'jobs outside any batch',
                   gatePending: false, cells: this.bucket(direct, stages), empty: false });
    }
    return lanes;
  }

  private flatMeta(jobs: LiveJobSummary[]): string {
    const gated = jobs.filter((j) => j.status === 'gated').length;
    const n = jobs.length;
    return `${n} job${n === 1 ? '' : 's'}${gated ? ` · ${gated} at gate` : ''}`;
  }

  private bucket(jobs: LiveJobSummary[], stages: string[]): LiveJobSummary[][] {
    return stages.map((stage) =>
      jobs.filter((j) => j.stage === stage)
        .sort((a, b) =>
          (a.status === 'parked' ? -1 : 1) - (b.status === 'parked' ? -1 : 1) ||
          a.last_event_at.localeCompare(b.last_event_at))
        .slice(0, 30));
  }

  private laneMeta(b: LiveBatchSummary): string {
    if (b.status === 'collecting') {
      let deadline = '';
      if (b.deadline) {
        const dt = new Date(b.deadline).getTime() - Date.now();
        deadline = dt > 0 ? ` · sweeper gates in ${this.fmtDur(dt)}`
                          : ` · sweeper overdue ${this.fmtDur(-dt)}`;
      }
      return `${b.assessed_count}/${b.expected_count} recordings assessed${deadline}`;
    }
    if (b.status === 'gated') {
      return `${b.candidate_count} candidate${b.candidate_count === 1 ? '' : 's'} assessed`;
    }
    return `${b.selected_count ?? 0} of ${b.candidate_count} topics chosen`;
  }

  /* ---- zoom: Ctrl/Cmd+wheel steps levels; buttons; persisted ---- */
  setZoom(z: number): void {
    this.zoom = Math.max(0, Math.min(2, z));
    localStorage.setItem(ZOOM_KEY, String(this.zoom));
  }

  onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;  // plain wheel scrolls normally
    e.preventDefault();
    this.wheelAcc += e.deltaY;
    if (this.wheelAcc <= -60) { this.setZoom(this.zoom + 1); this.wheelAcc = 0; }
    if (this.wheelAcc >= 60) { this.setZoom(this.zoom - 1); this.wheelAcc = 0; }
  }

  /* ---- template helpers ---- */
  short(id: string | null): string { return (id || '').slice(-6); }

  jobLabel(j: LiveJobSummary): string { return j.title || ''; }

  jobTitleAttr(j: LiveJobSummary): string {
    return `${j.title || '…' + this.short(j.correlation_id)} — ${j.stage} (${j.status})`;
  }

  jobExtra(j: LiveJobSummary): string {
    if (j.status === 'parked') return `parked at ${j.parked_type || '?'}`;
    if (j.status === 'gated') return `gate: ${j.pending_kind || '?'} · ${this.ago(j.last_event_at)}`;
    return `${j.last_type} · ${this.ago(j.last_event_at)} ago`;
  }

  stageIndex(j: LiveJobSummary, stages: string[]): number {
    return stages.indexOf(j.stage);
  }

  ago(iso: string): string {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
  }

  private fmtDur(ms: number): string {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
    return `${Math.floor(ms / 3600000)}h ${Math.round((ms % 3600000) / 60000)}m`;
  }
}
