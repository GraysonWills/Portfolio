import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import {
  EventFamily,
  FAMILY_COLORS,
  MeshEdge,
  MeshWorker,
  MissionControlMockService,
} from '../../services/mission-control-mock.service';

type EdgeStatus = 'base' | 'removed' | 'added';

interface DrawEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  fam: EventFamily;
  kind: MeshEdge['kind'];
  status: EdgeStatus;
  addIdx?: number;
}

interface RenderedEdge {
  d: string;
  color: string;
  width: number;
  dash: string | null;
  marker: string;
  opacity: number;
}

interface EdgeLabel {
  x: number;
  y: number;
  text: string;
  color: string;
  border: string;
  removed: boolean;
  added: boolean;
  glyph: string;
  edge: DrawEdge;
}

interface DiffLine {
  text: string;
  add: boolean;
}

interface DiffGroup {
  worker: string;
  lines: DiffLine[];
}

interface NodeVm extends MeshWorker {
  left: number;
  top: number;
  hbColor: string;
  accent: string;
  isGate: boolean;
}

/**
 * Worker Mesh — Topology (design: Author Studio.dc.html, MC topology section).
 * Renders the manifest-derived mesh graph on a 1180×580 canvas and, in edit
 * mode, stages manifest diffs (remove ⨯ / add connections) that "apply" as a
 * pull request — the running mesh is never mutated live.
 */
@Component({
  selector: 'app-mc-topology',
  templateUrl: './mc-topology.component.html',
  styleUrl: './mc-topology.component.scss',
  standalone: false,
})
export class McTopologyComponent implements OnChanges {
  @Input() editMode = false;

  readonly famColors = FAMILY_COLORS;
  readonly families = Object.keys(FAMILY_COLORS) as EventFamily[];

  // ---- staged-edit state (local to this view) ----
  removedIds: Record<string, boolean> = {};
  addedEdges: Array<{ from: string; to: string; type: string }> = [];
  addForm: { from: string; type: string; target: string } = { from: '', type: '', target: '' };
  applyOpen = false;
  applied = false;

  // ---- computed view models ----
  nodes: NodeVm[] = [];
  renderedEdges: RenderedEdge[] = [];
  edgeLabels: EdgeLabel[] = [];
  diffGroups: DiffGroup[] = [];
  warnings: string[] = [];
  errors: string[] = [];
  changeCount = 0;

  constructor(public mc: MissionControlMockService) {
    this.nodes = this.mc.workers.map((w) => ({
      ...w,
      left: w.cx - 75,
      top: w.cy - 46,
      hbColor: w.hb === 'ok' ? FAMILY_COLORS.green : w.hb === 'warn' ? FAMILY_COLORS.amber : FAMILY_COLORS.red,
      accent: w.gate ? FAMILY_COLORS.purple : 'rgba(255,255,255,.14)',
      isGate: !!w.gate,
    }));
    this.recompute();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editMode']) {
      this.applyOpen = false;
    }
  }

  get workerOptions(): string[] {
    return this.mc.workers.map((w) => w.id);
  }

  // ---- edit actions ----
  onLabelToggle(l: EdgeLabel): void {
    if (l.edge.status === 'removed') {
      this.restoreEdge(l.edge.id);
    } else if (l.edge.status === 'added') {
      this.undoAdd(l.edge.addIdx ?? -1);
    } else {
      this.removeEdge(l.edge.id);
    }
  }

  removeEdge(id: string): void {
    this.removedIds = { ...this.removedIds, [id]: true };
    this.recompute();
  }

  restoreEdge(id: string): void {
    const r = { ...this.removedIds };
    delete r[id];
    this.removedIds = r;
    this.recompute();
  }

  commitAdd(): void {
    const { from, type, target } = this.addForm;
    if (!from || !type || !target || from === target) {
      return;
    }
    this.addedEdges = [...this.addedEdges, { from, to: target, type }];
    this.addForm = { from: '', type: '', target: '' };
    this.recompute();
  }

  undoAdd(i: number): void {
    this.addedEdges = this.addedEdges.filter((_, idx) => idx !== i);
    this.recompute();
  }

  discardChanges(): void {
    this.removedIds = {};
    this.addedEdges = [];
    this.addForm = { from: '', type: '', target: '' };
    this.applyOpen = false;
    this.recompute();
  }

  openApply(): void {
    this.applyOpen = true;
  }

  closeApply(): void {
    this.applyOpen = false;
  }

  confirmApply(): void {
    this.applied = true;
    this.applyOpen = false;
    this.removedIds = {};
    this.addedEdges = [];
    this.recompute();
  }

  clearApplied(): void {
    this.applied = false;
  }

  // ---- mesh + diff computation (ported 1:1 from the design prototype) ----
  private recompute(): void {
    const baseEdges: DrawEdge[] = this.mc.edges.map((e) => ({
      id: `${e.from}>${e.to}>${e.type}`,
      from: e.from,
      to: e.to,
      type: e.type,
      fam: e.fam,
      kind: e.kind,
      status: 'base' as EdgeStatus,
    }));
    const added: DrawEdge[] = this.addedEdges.map((a, i) => ({
      id: `add>${i}`,
      from: a.from,
      to: a.to,
      type: a.type,
      fam: this.mc.familyForType(a.type),
      kind: 'auto' as const,
      status: 'added' as EdgeStatus,
      addIdx: i,
    }));
    const drawList = baseEdges
      .map((e) => (this.removedIds[e.id] ? { ...e, status: 'removed' as EdgeStatus } : e))
      .concat(added);
    const activeEdges = baseEdges.filter((e) => !this.removedIds[e.id]).concat(added);

    this.buildMesh(drawList);

    const real = new Set(this.mc.workers.map((w) => w.id));
    const clean = (t: string) => t.replace(' ↺', '').replace(' (bundle)', '');
    const setsOf = (edges: DrawEdge[]) => {
      const emit: Record<string, Set<string>> = {};
      const cons: Record<string, Set<string>> = {};
      edges.forEach((e) => {
        const t = clean(e.type);
        if (real.has(e.from)) {
          (emit[e.from] = emit[e.from] || new Set()).add(t);
        }
        if (real.has(e.to)) {
          (cons[e.to] = cons[e.to] || new Set()).add(t);
        }
      });
      return { emit, cons };
    };
    const baseS = setsOf(baseEdges);
    const workS = setsOf(activeEdges);

    const groups: DiffGroup[] = [];
    this.mc.workers.forEach((w) => {
      const lines: DiffLine[] = [];
      const be = baseS.emit[w.id] || new Set<string>();
      const we = workS.emit[w.id] || new Set<string>();
      const bc = baseS.cons[w.id] || new Set<string>();
      const wc = workS.cons[w.id] || new Set<string>();
      [...we].filter((t) => !be.has(t)).forEach((t) => lines.push({ text: `+ emits: ${t}`, add: true }));
      [...be].filter((t) => !we.has(t)).forEach((t) => lines.push({ text: `- emits: ${t}`, add: false }));
      [...wc].filter((t) => !bc.has(t)).forEach((t) => lines.push({ text: `+ consumes: ${t}`, add: true }));
      [...bc].filter((t) => !wc.has(t)).forEach((t) => lines.push({ text: `- consumes: ${t}`, add: false }));
      if (lines.length) {
        groups.push({ worker: w.id, lines });
      }
    });
    this.diffGroups = groups;

    const consumedAll = new Set<string>();
    const emittedAll = new Set<string>();
    const unreg = new Set<string>();
    activeEdges.forEach((e) => {
      const t = clean(e.type);
      if (real.has(e.to)) {
        consumedAll.add(t);
      }
      if (real.has(e.from)) {
        emittedAll.add(t);
      }
      if (!this.mc.registeredTypes.includes(t)) {
        unreg.add(t);
      }
    });
    const warnings: string[] = [];
    [...consumedAll].filter((t) => !emittedAll.has(t)).sort().forEach((t) => warnings.push(`'${t}' consumed but nothing emits it`));
    [...emittedAll].filter((t) => !consumedAll.has(t)).sort().forEach((t) => warnings.push(`'${t}' emitted but nothing consumes it`));
    this.warnings = warnings;
    this.errors = [...unreg].sort().map((t) => `unregistered event type '${t}'`);
    this.changeCount = added.length + Object.keys(this.removedIds).length;
  }

  /** Geometry port of the prototype's buildMesh() — path math preserved exactly. */
  private buildMesh(drawList: DrawEdge[]): void {
    const F = FAMILY_COLORS;
    const W: Record<string, { cx: number; cy: number }> = {};
    this.mc.workers.forEach((w) => (W[w.id] = w));
    W['platforms'] = { cx: 150, cy: 390 };
    const HW = 75;
    const HH = 46;
    const R = (w: { cx: number }) => w.cx + HW;
    const L = (w: { cx: number }) => w.cx - HW;
    const T = (w: { cy: number }) => w.cy - HH;
    const B = (w: { cy: number }) => w.cy + HH;

    const edges: RenderedEdge[] = [];
    const labels: EdgeLabel[] = [];
    drawList.forEach((e) => {
      const a = W[e.from];
      const b = W[e.to];
      if (!a || !b) {
        return;
      }
      const removed = e.status === 'removed';
      const added = e.status === 'added';
      const color = removed ? F.red : F[e.fam];
      let dash: string | null = e.kind === 'up' || e.kind === 'down2' ? '5 4' : null;
      if (added) {
        dash = '6 4';
      }
      let d: string;
      let lx: number;
      let ly: number;
      const kind = e.kind;
      if (kind === 'straight') {
        const x1 = a.cx < b.cx ? R(a) : L(a);
        const x2 = a.cx < b.cx ? L(b) : R(b);
        d = `M${x1} ${a.cy} L${x2} ${b.cy}`;
        lx = (x1 + x2) / 2;
        ly = a.cy - 16;
      } else if (kind === 'up') {
        d = `M${a.cx} ${T(a)} C${a.cx} 46 ${b.cx} 46 ${b.cx} ${T(b)}`;
        lx = (a.cx + b.cx) / 2;
        ly = 44;
      } else if (kind === 'vdown') {
        d = `M${a.cx} ${B(a)} L${b.cx} ${T(b)}`;
        lx = a.cx + 82;
        ly = (B(a) + T(b)) / 2;
      } else if (kind === 'down') {
        d = `M${a.cx} ${B(a)} C${a.cx} 505 ${b.cx} 505 ${b.cx} ${B(b)}`;
        lx = (a.cx + b.cx) / 2;
        ly = 500;
      } else if (kind === 'down2') {
        d = `M${a.cx} ${B(a)} C${a.cx} 548 ${b.cx} 548 ${b.cx} ${B(b)}`;
        lx = (a.cx + b.cx) / 2;
        ly = 548;
      } else if (kind === 'term') {
        d = `M${L(a)} ${a.cy} L200 ${a.cy}`;
        lx = (L(a) + 200) / 2;
        ly = a.cy - 16;
      } else {
        const x1 = a.cx <= b.cx ? R(a) : L(a);
        const x2 = a.cx <= b.cx ? L(b) : R(b);
        const dx = Math.max(50, Math.abs(x2 - x1) / 2);
        const c1 = a.cx <= b.cx ? x1 + dx : x1 - dx;
        const c2 = a.cx <= b.cx ? x2 - dx : x2 + dx;
        d = `M${x1} ${a.cy} C${c1} ${a.cy} ${c2} ${b.cy} ${x2} ${b.cy}`;
        lx = (x1 + x2) / 2;
        ly = (a.cy + b.cy) / 2 - 14;
      }
      edges.push({
        d,
        color,
        width: added ? 2.5 : 2,
        dash,
        marker: `url(#arw-${removed ? 'red' : e.fam})`,
        opacity: removed ? 0.38 : 0.95,
      });
      labels.push({
        x: lx,
        y: ly,
        text: (added ? '+ ' : '') + e.type,
        color,
        border: color + (added ? '' : '55'),
        removed,
        added,
        glyph: removed ? '↩' : '⨯',
        edge: e,
      });
    });
    this.renderedEdges = edges;
    this.edgeLabels = labels;
  }
}
