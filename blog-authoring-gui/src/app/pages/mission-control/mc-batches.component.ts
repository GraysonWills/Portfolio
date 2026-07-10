import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import {
  LiveApproval, LiveBatchDetail, MissionControlApiService,
} from '../../services/mission-control-api.service';

/**
 * Batches (MC v1) — the ADR-008 outer-flow audit view: every batch with its
 * candidate topics, novelty verdicts, what Grayson picked, and the child job
 * each pick spawned. Live batches also appear on the Board; this is history.
 */
@Component({
  selector: 'app-mc-batches',
  templateUrl: './mc-batches.component.html',
  styleUrl: './mc-batches.component.scss',
  standalone: false,
})
export class McBatchesComponent implements OnInit {
  @Output() openJob = new EventEmitter<string>();
  @Output() openApprovals = new EventEmitter<void>();

  batches: LiveBatchDetail[] = [];
  pendingGateIds = new Set<string>();
  demo = false;
  loaded = false;

  constructor(private api: MissionControlApiService) {}

  ngOnInit(): void {
    void this.reload();
  }

  async reload(): Promise<void> {
    try {
      const [list, approvals] = await Promise.all([
        this.api.batches(), this.api.approvals('pending'),
      ]);
      this.pendingGateIds = new Set(
        approvals.map((a: LiveApproval) => a.request_id));
      this.batches = await Promise.all(
        list.map((b) => this.api.batchDetail(b.batch_id)));
      this.demo = false;
    } catch {
      this.demo = true;
      this.batches = [];
    }
    this.loaded = true;
  }

  gatePending(b: LiveBatchDetail): boolean {
    return b.status === 'gated' && !!b.request_id &&
      this.pendingGateIds.has(b.request_id);
  }

  meta(b: LiveBatchDetail): string {
    const bits = [`${b.expected_count} recording(s) expected`,
                  `created ${new Date(b.created_at).toLocaleString()}`];
    if (b.gate_raised_at) {
      bits.push(`gate raised ${new Date(b.gate_raised_at).toLocaleString()}`);
    }
    return bits.join(' · ');
  }

  noveltyPct(score: number | null): number {
    return Math.round(100 * (1 - (score ?? 0)));
  }

  short(id: string | null): string { return (id || '').slice(-6); }
}
