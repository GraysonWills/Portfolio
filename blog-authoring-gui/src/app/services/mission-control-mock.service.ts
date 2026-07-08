import { Injectable } from '@angular/core';

/**
 * Mission Control demo data (design: Author Studio.dc.html, MC section).
 * UX-only for now — this service is the single seam to swap for the real
 * mesh API (GET /events/stream · /registry · /approvals · /jobs/{id}).
 */

export type EventFamily = 'neutral' | 'blue' | 'amber' | 'purple' | 'green' | 'red';

export interface MeshWorker {
  id: string;
  role: string;
  alias: string;
  desc: string;
  cx: number;
  cy: number;
  hb: 'ok' | 'warn' | 'down';
  gate?: boolean;
}

export interface MeshEdge {
  from: string;
  to: string;
  type: string;
  fam: EventFamily;
  kind: 'straight' | 'up' | 'vdown' | 'down' | 'down2' | 'term' | 'auto';
}

export interface FeedEvent {
  type: string;
  producer: string;
  fam: EventFamily;
  corr: string;
  ago: string;
  note?: string;
}

export interface JobStep {
  label: string;
  event: string;
  producer: string;
  fam: EventFamily;
  state: 'done' | 'pass' | 'fail' | 'gate' | 'parked';
  meta: string;
  dur: string;
}

export interface ApprovalItem {
  action: string;
  target: string;
  client: string;
  when: string;
}

export interface RegistryRow {
  id: string;
  alias: string;
  consumes: string;
  emits: string;
  hb: 'ok' | 'warn' | 'down';
}

export const FAMILY_COLORS: Record<EventFamily, string> = {
  neutral: '#8aa0bd',
  blue: '#5b9be8',
  amber: '#e0a83a',
  purple: '#b083ea',
  green: '#3fb27f',
  red: '#e0574a',
};

@Injectable({ providedIn: 'root' })
export class MissionControlMockService {
  readonly registeredTypes = [
    'source.audio.ready', 'transcript.ready', 'draft.ready', 'validation.completed',
    'approval.requested', 'approval.resolved', 'content.published',
    'announcement.scheduled', 'announcement.posted',
  ];

  readonly workers: MeshWorker[] = [
    { id: 'ingest_adapter', role: 'Ingest', alias: 'fast', desc: 'Normalizes any A/V → 16 kHz mono WAV, starts a job.', cx: 130, cy: 150, hb: 'ok' },
    { id: 'transcriber', role: 'Transcribe', alias: 'fast', desc: 'faster-whisper large-v3-turbo on the Spark.', cx: 420, cy: 150, hb: 'ok' },
    { id: 'blog_writer', role: 'Draft', alias: 'workhorse→voice', desc: 'LangGraph outline → draft → self-check.', cx: 710, cy: 150, hb: 'ok' },
    { id: 'validator', role: 'QC', alias: 'validator', desc: 'Rubric: structure · consistency · length · voice.', cx: 1000, cy: 150, hb: 'ok' },
    { id: 'approvals', role: 'Gate', alias: 'fast', desc: 'The Grayson gate — persists requests, halts the run.', cx: 1000, cy: 390, hb: 'ok', gate: true },
    { id: 'publisher', role: 'Publish', alias: 'fast', desc: 'Publishes granted drafts via back-of-shop.', cx: 710, cy: 390, hb: 'ok' },
    { id: 'announcer', role: 'Announce', alias: 'voice', desc: 'Per-platform copy, bundle gate, scheduling.', cx: 420, cy: 390, hb: 'warn' },
  ];

  readonly edges: MeshEdge[] = [
    { from: 'ingest_adapter', to: 'transcriber', type: 'source.audio.ready', fam: 'neutral', kind: 'straight' },
    { from: 'transcriber', to: 'blog_writer', type: 'transcript.ready', fam: 'neutral', kind: 'straight' },
    { from: 'blog_writer', to: 'validator', type: 'draft.ready', fam: 'blue', kind: 'straight' },
    { from: 'validator', to: 'blog_writer', type: 'validation.completed ↺', fam: 'amber', kind: 'up' },
    { from: 'validator', to: 'approvals', type: 'approval.requested', fam: 'purple', kind: 'vdown' },
    { from: 'approvals', to: 'publisher', type: 'approval.resolved', fam: 'purple', kind: 'straight' },
    { from: 'publisher', to: 'announcer', type: 'content.published', fam: 'green', kind: 'straight' },
    { from: 'approvals', to: 'announcer', type: 'approval.resolved', fam: 'purple', kind: 'down' },
    { from: 'announcer', to: 'approvals', type: 'approval.requested (bundle)', fam: 'purple', kind: 'down2' },
    { from: 'announcer', to: 'platforms', type: 'announcement.posted', fam: 'green', kind: 'term' },
  ];

  readonly legend: Array<{ label: string; fam: EventFamily }> = [
    { label: 'source / transcript', fam: 'neutral' },
    { label: 'draft', fam: 'blue' },
    { label: 'validation', fam: 'amber' },
    { label: 'approval (gate)', fam: 'purple' },
    { label: 'published / announce', fam: 'green' },
    { label: 'parked', fam: 'red' },
  ];

  readonly feedEvents: FeedEvent[] = [
    { type: 'announcement.posted', producer: 'announcer@0.1.0', fam: 'green', corr: '7Q3D9A', ago: 'just now' },
    { type: 'announcement.posted', producer: 'announcer@0.1.0', fam: 'green', corr: '7Q3D9A', ago: '4s' },
    { type: 'announcement.scheduled', producer: 'announcer@0.1.0', fam: 'green', corr: '7Q3D9A', ago: '9s' },
    { type: 'approval.resolved', producer: 'approvals@0.1.0', fam: 'purple', corr: '7Q3D9A', ago: '11s', note: 'bundle · granted' },
    { type: 'approval.requested', producer: 'announcer@0.1.0', fam: 'purple', corr: '7Q3D9A', ago: '1m 33s', note: 'announce bundle · 6 platforms' },
    { type: 'content.published', producer: 'publisher@0.1.0', fam: 'green', corr: '7Q3D9A', ago: '1m 39s' },
    { type: 'approval.resolved', producer: 'approvals@0.1.0', fam: 'purple', corr: '7Q3D9A', ago: '1m 45s', note: 'draft · edited → training pair' },
    { type: 'approval.requested', producer: 'validator@0.1.0', fam: 'purple', corr: '7Q3D9A', ago: '4m 49s', note: 'blog_draft · 1 open issue' },
    { type: 'validation.completed', producer: 'validator@0.1.0', fam: 'amber', corr: '7Q3D9A', ago: '4m 52s', note: 'pass · 88/100' },
    { type: 'draft.ready', producer: 'blog_writer@0.1.0', fam: 'blue', corr: '7Q3D9A', ago: '5m 04s', note: 'attempt 2' },
    { type: 'validation.completed', producer: 'validator@0.1.0', fam: 'amber', corr: '7Q3D9A', ago: '5m 20s', note: 'fail · 63/100 → regen' },
    { type: 'draft.ready', producer: 'blog_writer@0.1.0', fam: 'blue', corr: '7Q3D9A', ago: '7m 30s', note: 'attempt 1' },
    { type: 'transcript.ready', producer: 'transcriber@0.1.0', fam: 'neutral', corr: '7Q3D9A', ago: '7m 42s' },
    { type: 'source.audio.ready', producer: 'ingest_adapter@0.1.0', fam: 'neutral', corr: '7Q3D9A', ago: '7m 52s', note: 'talk.mp4 · 10m 04s' },
  ];

  readonly feedChips: Array<{ k: string; label: string }> = [
    { k: 'all', label: 'All' },
    { k: 'neutral', label: 'source · transcript' },
    { k: 'blue', label: 'draft' },
    { k: 'amber', label: 'validation' },
    { k: 'purple', label: 'approval' },
    { k: 'green', label: 'published · announce' },
  ];

  readonly job = {
    id: '#7Q3D9A',
    status: 'Published',
    source: 'talk.mp4',
    elapsed: '7m 52s',
  };

  readonly jobSteps: JobStep[] = [
    { label: 'Ingest', event: 'source.audio.ready', producer: 'ingest_adapter', fam: 'neutral', state: 'done', meta: 'talk.mp4 → 16 kHz WAV', dur: '—' },
    { label: 'Transcribe', event: 'transcript.ready', producer: 'transcriber', fam: 'neutral', state: 'done', meta: 'faster-whisper · 10m 04s audio', dur: '42s' },
    { label: 'Draft', event: 'draft.ready', producer: 'blog_writer', fam: 'blue', state: 'done', meta: 'attempt 2 · regenerated once', dur: '2m 18s' },
    { label: 'Validate', event: 'validation.completed', producer: 'validator', fam: 'amber', state: 'pass', meta: 'pass · 88/100 · voice fidelity ok', dur: '12s' },
    { label: 'Approval gate', event: 'approval.resolved', producer: 'approvals', fam: 'purple', state: 'gate', meta: 'granted · edited → training pair captured', dur: 'waited 3m 04s' },
    { label: 'Publish', event: 'content.published', producer: 'publisher', fam: 'green', state: 'done', meta: 'live · canonical URL + UTM', dur: '6s' },
    { label: 'Announce gate', event: 'approval.resolved', producer: 'announcer', fam: 'purple', state: 'gate', meta: 'bundle granted · 6 platforms', dur: '1m 22s' },
    { label: 'Scheduled & posted', event: 'announcement.posted', producer: 'announcer', fam: 'green', state: 'done', meta: 'staggered across X, LinkedIn, IG…', dur: '8s' },
  ];

  readonly approvalQueue: ApprovalItem[] = [
    { action: 'Publish', target: '“Loose Grip” → blog', client: 'Claude MCP client', when: 'Just now' },
    { action: 'Social send', target: '“Still Turning Out” → X, LinkedIn', client: 'Automation rule', when: '2m ago' },
  ];

  readonly registryRows: RegistryRow[] = [
    { id: 'ingest_adapter', alias: 'fast', consumes: '— (watch folder)', emits: 'source.audio.ready', hb: 'ok' },
    { id: 'transcriber', alias: 'fast', consumes: 'source.audio.ready', emits: 'transcript.ready', hb: 'ok' },
    { id: 'blog_writer', alias: 'workhorse→voice', consumes: 'transcript.ready, validation.completed', emits: 'draft.ready', hb: 'ok' },
    { id: 'validator', alias: 'validator', consumes: 'draft.ready', emits: 'validation.completed, approval.requested', hb: 'ok' },
    { id: 'approvals', alias: 'fast', consumes: 'approval.requested', emits: 'approval.resolved', hb: 'ok' },
    { id: 'publisher', alias: 'fast', consumes: 'approval.resolved', emits: 'content.published', hb: 'ok' },
    { id: 'announcer', alias: 'voice', consumes: 'content.published, approval.resolved', emits: 'approval.requested, announcement.scheduled, announcement.posted', hb: 'warn' },
  ];

  familyForType(t: string): EventFamily {
    if (t.startsWith('source') || t.startsWith('transcript')) return 'neutral';
    if (t.startsWith('draft')) return 'blue';
    if (t.startsWith('validation')) return 'amber';
    if (t.startsWith('approval')) return 'purple';
    if (t.startsWith('content') || t.startsWith('announcement')) return 'green';
    return 'red';
  }
}
