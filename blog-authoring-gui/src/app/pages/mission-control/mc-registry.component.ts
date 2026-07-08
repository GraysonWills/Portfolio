import { Component, OnInit } from '@angular/core';
import { MissionControlMockService, RegistryRow } from '../../services/mission-control-mock.service';
import { MissionControlApiService } from '../../services/mission-control-api.service';

@Component({
  selector: 'app-mc-registry',
  templateUrl: './mc-registry.component.html',
  styleUrl: './mc-registry.component.scss',
  standalone: false,
})
export class McRegistryComponent implements OnInit {
  rows: RegistryRow[] = [];
  /** True when the mesh API was unreachable and demo data is shown. */
  demo = false;

  constructor(
    public mc: MissionControlMockService,
    private api: MissionControlApiService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      const live = await this.api.registry();
      this.rows = live.map((r) => {
        const hbS = r.manifest?.heartbeat_s || 30;
        const age = r.last_heartbeat
          ? (Date.now() - new Date(r.last_heartbeat).getTime()) / 1000
          : Infinity;
        return {
          id: r.worker_id,
          alias: r.manifest?.model_alias || '—',
          consumes: (r.manifest?.consumes || []).map((c) => c.type).join(', ') || '—',
          emits: (r.manifest?.emits || []).map((e) => e.type).join(', ') || '—',
          hb: age < 2 * hbS ? 'ok' : age < 5 * hbS ? 'warn' : 'down',
        } as RegistryRow;
      });
    } catch {
      this.rows = this.mc.registryRows;
      this.demo = true;
    }
  }

  hbText(hb: RegistryRow['hb']): string {
    return hb === 'ok' ? 'fresh' : hb === 'warn' ? 'stale' : 'down';
  }
}
