import { Injectable } from '@angular/core';

export type BlogDraftRecoverySnapshot = {
  version: 1;
  savedAt: string;
  sourceUpdatedAt: string | null;
  formValue: Record<string, unknown>;
  publicTags: string[];
  privateSeoTags: string[];
  pendingPublicTag: string;
  pendingPrivateTag: string;
  uploadedImage: string | null;
};

@Injectable({ providedIn: 'root' })
export class BlogDraftRecoveryService {
  private readonly prefix = 'blog_authoring_recovery_v1:';
  private readonly maxSnapshotChars = 2_500_000;

  keyFor(listItemId?: string): string {
    const id = String(listItemId || 'new-post').trim() || 'new-post';
    return `${this.prefix}${id}`;
  }

  load(key: string): BlogDraftRecoverySnapshot | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as BlogDraftRecoverySnapshot;
      if (parsed?.version !== 1 || !parsed?.savedAt || !parsed?.formValue) {
        this.clear(key);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  save(key: string, snapshot: BlogDraftRecoverySnapshot): boolean {
    try {
      const raw = JSON.stringify(snapshot);
      if (raw.length > this.maxSnapshotChars) return false;
      localStorage.setItem(key, raw);
      return true;
    } catch {
      return false;
    }
  }

  clear(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable in locked-down browser contexts.
    }
  }
}
