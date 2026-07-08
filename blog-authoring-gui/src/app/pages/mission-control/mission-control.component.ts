import { Component } from '@angular/core';

export type McView = 'topology' | 'feed' | 'jobs' | 'approvals' | 'registry';

/**
 * Mission Control (design: Author Studio.dc.html, MC section) — the dark
 * cockpit tab of the Author Studio. Hosts the sub-nav and the five views.
 * UX-only: data comes from MissionControlMockService until the mesh API is
 * wired (ADR-006).
 */
@Component({
  selector: 'app-mission-control',
  templateUrl: './mission-control.component.html',
  styleUrl: './mission-control.component.scss',
  standalone: false,
})
export class MissionControlComponent {
  view: McView = 'topology';
  editMode = false;
  jobCid: string | null = null;

  readonly tabs: Array<{ key: McView; label: string }> = [
    { key: 'topology', label: 'Topology' },
    { key: 'feed', label: 'Live Feed' },
    { key: 'jobs', label: 'Jobs' },
    { key: 'approvals', label: 'Approvals' },
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
