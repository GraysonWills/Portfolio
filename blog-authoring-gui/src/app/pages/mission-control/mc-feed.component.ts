import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FeedEvent, MissionControlMockService } from '../../services/mission-control-mock.service';
import { LiveMeshEvent, MissionControlApiService } from '../../services/mission-control-api.service';

interface FeedRow extends FeedEvent {
  /** Full correlation id (live rows) — mock rows fall back to their short id. */
  cid?: string;
  at?: number;
}

@Component({
  selector: 'app-mc-feed',
  templateUrl: './mc-feed.component.html',
  styleUrl: './mc-feed.component.scss',
  standalone: false,
})
export class McFeedComponent implements OnInit, OnDestroy {
  @Output() openJob = new EventEmitter<string | void>();

  filter = 'all';
  paused = false;
  demo = false;
  live = false;
  rows: FeedRow[] = [];
  private buffer: FeedRow[] = [];
  private subs: Subscription[] = [];

  constructor(
    public mc: MissionControlMockService,
    private api: MissionControlApiService,
  ) {}

  ngOnInit(): void {
    // Demo rows until the stream produces something; replaced on first event.
    this.demo = true;
    this.rows = this.mc.feedEvents.map((e) => ({ ...e }));
    this.subs.push(
      this.api.eventStream().subscribe((ev) => this.onLive(ev)),
      this.api.streamState().subscribe((s) => (this.live = s === 'live')),
    );
  }

  private onLive(ev: LiveMeshEvent): void {
    if (this.demo) {
      this.demo = false;
      this.rows = [];
    }
    const row: FeedRow = {
      type: ev.type,
      producer: ev.producer,
      fam: this.mc.familyForType(ev.type),
      corr: (ev.correlation_id || '').slice(-6),
      cid: ev.correlation_id,
      ago: '',
      at: new Date(ev.occurred_at).getTime(),
      note: this.noteFor(ev),
    };
    const target = this.paused ? this.buffer : this.rows;
    target.unshift(row);
    if (target.length > 200) target.pop();
  }

  private noteFor(ev: LiveMeshEvent): string | undefined {
    const p = ev.payload || {};
    if (typeof p['title'] === 'string') return p['title'] as string;
    if (p['verdict']) return `${p['verdict']}${p['score'] != null ? ' · ' + p['score'] + '/100' : ''}`;
    if (p['attempt'] != null) return `attempt ${p['attempt']}`;
    if (p['platform']) return String(p['platform']);
    if (p['kind']) return String(p['kind']);
    return undefined;
  }

  togglePause(): void {
    this.paused = !this.paused;
    if (!this.paused && this.buffer.length) {
      this.rows = [...this.buffer, ...this.rows].slice(0, 200);
      this.buffer = [];
    }
  }

  agoFor(r: FeedRow): string {
    if (!r.at) return r.ago;
    const s = Math.max(0, Math.round((Date.now() - r.at) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  rowClicked(r: FeedRow): void {
    this.openJob.emit(r.cid);
  }

  setFilter(k: string): void {
    this.filter = k;
  }

  get filteredEvents(): FeedRow[] {
    return this.filter === 'all'
      ? this.rows
      : this.rows.filter((e) => e.fam === this.filter);
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }
}
