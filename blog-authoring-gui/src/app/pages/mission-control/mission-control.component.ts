import { Component } from '@angular/core';

export type McView = 'board' | 'topology' | 'feed' | 'jobs' | 'batches'
  | 'approvals' | 'registry';

/**
 * Mission Control (design: Author Studio.dc.html, MC section) — the dark
 * cockpit tab of the Author Studio. Hosts the sub-nav and the views; the
 * Board (MC v1 — batch lanes × pipeline stages, semantic zoom) is home.
 */
@Component({
  selector: 'app-mission-control',
  templateUrl: './mission-control.component.html',
  styleUrl: './mission-control.component.scss',
  standalone: false,
})
export class MissionControlComponent {
  view: McView = 'board';
  editMode = false;
  jobCid: string | null = null;

  readonly tabs: Array<{ key: McView; label: string }> = [
    { key: 'board', label: 'Board' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'batches', label: 'Batches' },
    { key: 'topology', label: 'Topology' },
    { key: 'feed', label: 'Live Feed' },
    { key: 'jobs', label: 'Jobs' },
    { key: 'registry', label: 'Registry' },
  ];

  setView(v: McView): void {
    this.view = v;
  }

  onOpenJob(cid: string | void): void {
    this.jobCid = cid || null;
    this.view = 'jobs';
  }

  toggleEdit(): void {
    this.editMode = !this.editMode;
    if (this.editMode) {
      this.view = 'topology';
    }
  }
}
