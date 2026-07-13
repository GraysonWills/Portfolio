import { Component, OnInit } from '@angular/core';
import { MissionControlMockService } from '../../services/mission-control-mock.service';
import { LiveApproval, MissionControlApiService } from '../../services/mission-control-api.service';

interface GateCard {
  requestId: string | null;   // null = demo row, actions disabled
  kind: string;
  action: string;
  target: string;
  client: string;
  when: string;
}

/** One checkbox row in the topic_selection picker (parsed preview JSON). */
interface PickRow {
  candidate_id: string;
  title: string;
  angle: string;
  novelty_score: number | null;
  novelty_verdict: string | null;
  closest_ref: string | null;
  checked: boolean;
}

const KIND_LABELS: Record<string, string> = {
  blog_draft: 'Publish draft',
  announce_bundle: 'Announce bundle',
  topic_selection: 'Pick topics',
  snippet_selection: 'Pick snippets',
  clip_selection: 'Pick clips',
};

/** The pick-list gate kinds — same candidates[]/{selected:[…]} contract, one
 *  checkbox picker, kind-specific verbs (ADR-008/011/012). */
interface PickMeta {
  pick: string; all: string; deny: string; confirm: string; toast: string; unit: 'batch' | 'run';
}
const PICK_KINDS: Record<string, PickMeta> = {
  topic_selection: {
    pick: 'Pick topics…', all: 'Draft all', deny: 'Deny batch', confirm: 'Draft',
    toast: '✓ selection recorded — drafting begins', unit: 'batch',
  },
  snippet_selection: {
    pick: 'Pick snippets…', all: 'Schedule all', deny: 'Deny run', confirm: 'Schedule',
    toast: '✓ selection recorded — scheduling posts', unit: 'run',
  },
  clip_selection: {
    pick: 'Pick clips…', all: 'Render all', deny: 'Deny run', confirm: 'Render',
    toast: '✓ selection recorded — rendering clips', unit: 'run',
  },
};

@Component({
  selector: 'app-mc-approvals',
  templateUrl: './mc-approvals.component.html',
  styleUrl: './mc-approvals.component.scss',
  standalone: false,
})
export class McApprovalsComponent implements OnInit {
  cards: GateCard[] = [];
  demo = false;
  busyId: string | null = null;
  denyingId: string | null = null;
  denyNote = '';
  editingId: string | null = null;
  editText = '';
  pickingId: string | null = null;
  pickKind: string | null = null;
  pickRows: PickRow[] = [];
  toast = '';

  constructor(
    public mc: MissionControlMockService,
    private api: MissionControlApiService,
  ) {}

  ngOnInit(): void {
    void this.reload();
  }

  async reload(): Promise<void> {
    try {
      const live = await this.api.approvals('pending');
      this.cards = live.map((a) => ({
        requestId: a.request_id,
        kind: a.kind,
        action: KIND_LABELS[a.kind] || a.kind,
        target: a.summary,
        client: `mesh · ${PICK_KINDS[a.kind]?.unit || 'job'} …${(a.correlation_id || '').slice(-6) || '—'}`,
        when: new Date(a.requested_at).toLocaleString(),
      }));
      this.demo = false;
    } catch {
      this.cards = this.mc.approvalQueue.map((q) => ({
        requestId: null, kind: 'blog_draft', action: q.action, target: q.target,
        client: q.client, when: q.when,
      }));
      this.demo = true;
    }
  }

  async approve(c: GateCard): Promise<void> {
    if (!c.requestId) return;
    await this.decide(c.requestId, 'granted');
  }

  startDeny(c: GateCard): void {
    if (!c.requestId) return;
    this.denyingId = c.requestId;
    this.editingId = null;
    this.pickingId = null;
    this.denyNote = '';
  }

  async confirmDeny(): Promise<void> {
    if (!this.denyingId || !this.denyNote.trim()) return;
    await this.decide(this.denyingId, 'denied', this.denyNote.trim());
    this.denyingId = null;
  }

  async startEdit(c: GateCard): Promise<void> {
    if (!c.requestId) return;
    this.editingId = c.requestId;
    this.denyingId = null;
    this.pickingId = null;
    try {
      this.editText = await this.api.preview(c.requestId);
    } catch {
      this.editText = '';
    }
  }

  /* ---- pick-list picker: topic/snippet/clip selection (ADR-008/011/012) ---- */

  isPick(kind: string): boolean { return kind in PICK_KINDS; }
  pickLabel(kind: string): string { return PICK_KINDS[kind]?.pick || 'Pick…'; }
  allLabel(kind: string): string { return PICK_KINDS[kind]?.all || 'Approve all'; }
  denyLabel(kind: string): string { return PICK_KINDS[kind]?.deny || 'Deny'; }
  confirmVerb(kind: string): string { return PICK_KINDS[kind]?.confirm || 'Approve'; }

  async startPick(c: GateCard): Promise<void> {
    if (!c.requestId) return;
    this.pickingId = c.requestId;
    this.pickKind = c.kind;
    this.denyingId = null;
    this.editingId = null;
    this.pickRows = [];
    try {
      const preview = JSON.parse(await this.api.preview(c.requestId)) as {
        candidates?: Array<Omit<PickRow, 'checked' | 'angle'> & { angle?: string | null }>;
      };
      this.pickRows = (preview.candidates || []).map((cand) => ({
        candidate_id: cand.candidate_id,
        title: cand.title,
        angle: cand.angle || '',
        novelty_score: cand.novelty_score ?? null,
        novelty_verdict: cand.novelty_verdict ?? null,
        closest_ref: cand.closest_ref ?? null,
        // topics carry a novelty verdict (duplicates opt-in only); snippet/clip
        // candidates have none → default them all checked
        checked: cand.novelty_verdict ? cand.novelty_verdict === 'novel' : true,
      }));
    } catch {
      this.pickRows = [];
    }
  }

  pickedCount(): number {
    return this.pickRows.filter((r) => r.checked).length;
  }

  noveltyPct(score: number | null): number {
    return Math.round(100 * (1 - (score ?? 0)));
  }

  async confirmPick(): Promise<void> {
    if (!this.pickingId || !this.pickedCount()) return;
    const ids = this.pickRows.filter((r) => r.checked).map((r) => r.candidate_id);
    // all picked == a plain grant; otherwise the dispatcher's exact
    // {"selected": [...]} contract rides the edited-markdown channel
    if (ids.length === this.pickRows.length) {
      await this.decide(this.pickingId, 'granted');
    } else {
      await this.decide(this.pickingId, 'edited', undefined,
                        JSON.stringify({ selected: ids }));
    }
    this.pickingId = null;
  }

  async confirmEdit(): Promise<void> {
    if (!this.editingId || !this.editText.trim()) return;
    await this.decide(this.editingId, 'edited', undefined, this.editText);
    this.editingId = null;
  }

  private async decide(id: string, decision: 'granted' | 'denied' | 'edited',
                       note?: string, edited?: string): Promise<void> {
    this.busyId = id;
    const wasPick = this.pickingId === id;
    const pickToast = (this.pickKind && PICK_KINDS[this.pickKind]?.toast)
      || '✓ selection recorded';
    try {
      await this.api.decide(id, decision, note, edited);
      this.showToast(wasPick ? pickToast
        : decision === 'edited'
        ? '✓ approved — edit captured for voice training' : `✓ ${decision}`);
      await this.reload();
    } catch (e) {
      this.showToast('✗ decision failed — ' + ((e as Error).message || 'mesh unreachable'));
    } finally {
      this.busyId = null;
    }
  }

  private showToast(msg: string): void {
    this.toast = msg;
    setTimeout(() => (this.toast = ''), 3000);
  }
}
