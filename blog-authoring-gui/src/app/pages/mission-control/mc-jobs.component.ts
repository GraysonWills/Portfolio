import { Component, Input, OnChanges } from '@angular/core';
import { JobStep, MissionControlMockService } from '../../services/mission-control-mock.service';
import { MissionControlApiService } from '../../services/mission-control-api.service';

const STEP_LABELS: Record<string, string> = {
  'source.audio.ready': 'Ingest',
  'transcript.ready': 'Transcribe',
  'draft.ready': 'Draft',
  'validation.completed': 'Validate',
  'approval.requested': 'Approval gate',
  'approval.resolved': 'Gate resolved',
  'content.published': 'Publish',
  'announcement.scheduled': 'Announce scheduled',
  'announcement.posted': 'Posted',
};

@Component({
  selector: 'app-mc-jobs',
  templateUrl: './mc-jobs.component.html',
  styleUrl: './mc-jobs.component.scss',
  standalone: false,
})
export class McJobsComponent implements OnChanges {
  /** Correlation id to load live; null renders the demo job. */
  @Input() cid: string | null = null;

  demo = true;
  job: { id: string; status: string; source: string; elapsed: string };
  steps: JobStep[];

  constructor(
    public mc: MissionControlMockService,
    private api: MissionControlApiService,
  ) {
    this.job = mc.job;
    this.steps = mc.jobSteps;
  }

  async ngOnChanges(): Promise<void> {
    if (!this.cid) return;
    try {
      const live = await this.api.job(this.cid);
      const steps = live.steps;
      const t0 = new Date(steps[0].occurred_at).getTime();
      const tN = new Date(steps[steps.length - 1].occurred_at).getTime();
      this.steps = steps.map((s, i) => {
        const fam = this.mc.familyForType(s.type);
        const prev = i ? new Date(steps[i - 1].occurred_at).getTime() : null;
        return {
          label: STEP_LABELS[s.type] || s.type,
          event: s.type,
          producer: s.producer,
          fam,
          state: s.type === 'approval.requested' ? 'gate' : 'done',
          meta: `${s.producer} · ${new Date(s.occurred_at).toLocaleTimeString()}`,
          dur: prev == null ? '—' : this.fmt(new Date(s.occurred_at).getTime() - prev),
        } as JobStep;
      });
      const last = steps[steps.length - 1];
      this.job = {
        id: '#' + (this.cid || '').slice(-6),
        status: last.type === 'announcement.posted' ? 'Published'
          : last.type.startsWith('approval.requested') ? 'At gate' : 'In flight',
        source: `${steps.length} events`,
        elapsed: this.fmt(tN - t0),
      };
      this.demo = false;
    } catch {
      this.demo = true;
      this.job = this.mc.job;
      this.steps = this.mc.jobSteps;
    }
  }

  private fmt(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  stepColor(s: JobStep): string {
    if (s.state === 'pass') return 'green';
    if (s.state === 'fail' || s.state === 'parked') return 'red';
    if (s.state === 'gate') return 'purple';
    return s.fam;
  }
}
