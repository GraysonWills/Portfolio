import { Component, OnInit } from '@angular/core';
import { MissionControlMockService } from '../../services/mission-control-mock.service';
import { LiveApproval, MissionControlApiService } from '../../services/mission-control-api.service';

interface GateCard {
  requestId: string | null;   // null = demo row, actions disabled
  action: string;
  target: string;
  client: string;
  when: string;
}

const KIND_LABELS: Record<string, string> = {
  blog_draft: 'Publish draft',
  announce_bundle: 'Announce bundle',
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
        action: KIND_LABELS[a.kind] || a.kind,
        target: a.summary,
        client: `mesh · job …${(a.correlation_id || '').slice(-6) || '—'}`,
        when: new Date(a.requested_at).toLocaleString(),
      }));
      this.demo = false;
    } catch {
      this.cards = this.mc.approvalQueue.map((q) => ({
        requestId: null, action: q.action, target: q.target,
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
    try {
      this.editText = await this.api.preview(c.requestId);
    } catch {
      this.editText = '';
    }
  }

  async confirmEdit(): Promise<void> {
    if (!this.editingId || !this.editText.trim()) return;
    await this.decide(this.editingId, 'edited', undefined, this.editText);
    this.editingId = null;
  }

  private async decide(id: string, decision: 'granted' | 'denied' | 'edited',
                       note?: string, edited?: string): Promise<void> {
    this.busyId = id;
    try {
      await this.api.decide(id, decision, note, edited);
      this.showToast(decision === 'edited'
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
