import { Injectable } from '@angular/core';

type StoredRouteViewState = Record<string, unknown> & {
  scrollY?: number;
  pageHeight?: number;
  updatedAt?: number;
};

@Injectable({
  providedIn: 'root'
})
export class RouteViewStateService {
  private readonly storageKeyPrefix = 'portfolio_route_view_state_v1_';
  private readonly pendingCaptureFrames = new Map<string, number>();
  private readonly queuedCapturePatches = new Map<string, Partial<StoredRouteViewState>>();
  private activePrimedRouteKey: string | null = null;

  getState<T extends StoredRouteViewState>(routeKey: string): T | null {
    if (!this.canUseStorage()) return null;

    try {
      const raw = sessionStorage.getItem(this.buildKey(routeKey));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  setState<T extends StoredRouteViewState>(routeKey: string, state: T): void {
    if (!this.canUseStorage()) return;

    try {
      const next = {
        ...state,
        scrollY: this.resolveScrollY(state.scrollY),
        pageHeight: this.resolvePageHeight(state.pageHeight),
        updatedAt: Date.now()
      };
      sessionStorage.setItem(this.buildKey(routeKey), JSON.stringify(next));
    } catch {
      // Ignore storage failures. Route state persistence is best-effort only.
    }
  }

  patchState<T extends StoredRouteViewState>(routeKey: string, patch: Partial<T>): void {
    const current = this.getState<T>(routeKey) || {} as T;
    this.setState(routeKey, {
      ...current,
      ...patch
    } as T);
  }

  captureScroll(routeKey: string): void {
    if (typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') return;

    this.queuedCapturePatches.set(routeKey, {
      scrollY: this.resolveScrollY(),
      pageHeight: this.resolvePageHeight()
    });

    if (this.pendingCaptureFrames.has(routeKey)) return;

    const frameId = requestAnimationFrame(() => {
      this.pendingCaptureFrames.delete(routeKey);
      const patch = this.queuedCapturePatches.get(routeKey);
      this.queuedCapturePatches.delete(routeKey);
      if (!patch) return;
      this.patchState(routeKey, patch);
    });

    this.pendingCaptureFrames.set(routeKey, frameId);
  }

  primeRestore(routeKey: string): void {
    if (typeof document === 'undefined') return;

    const state = this.getState<StoredRouteViewState>(routeKey);
    const savedHeight = Number(state?.pageHeight);

    if (!Number.isFinite(savedHeight) || savedHeight <= 0) {
      this.clearRestorePrime();
      return;
    }

    document.body.style.minHeight = `${Math.max(savedHeight, window.innerHeight)}px`;
    this.activePrimedRouteKey = routeKey;
  }

  restoreScrollImmediate(routeKey: string, fallbackTop: number = 0): void {
    if (typeof window === 'undefined') return;
    const desiredTop = this.getDesiredTop(routeKey, fallbackTop);
    window.scrollTo({ top: Math.max(0, desiredTop), behavior: 'auto' });
  }

  restoreScrollFinal(routeKey: string, fallbackTop: number = 0): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return Promise.resolve();
    }

    const desiredTop = this.getDesiredTop(routeKey, fallbackTop);
    if (desiredTop <= 0) {
      window.scrollTo({ top: Math.max(0, fallbackTop), behavior: 'auto' });
      this.clearRestorePrime(routeKey);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 3;
      const tryRestore = () => {
        attempts += 1;
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const targetTop = Math.min(desiredTop, maxScroll);

        window.scrollTo({ top: targetTop, behavior: 'auto' });

        const closeEnough = Math.abs(window.scrollY - targetTop) < 4;
        if (closeEnough || attempts >= maxAttempts) {
          this.clearRestorePrime(routeKey);
          resolve();
          return;
        }

        requestAnimationFrame(tryRestore);
      };

      requestAnimationFrame(tryRestore);
    });
  }

  restoreScroll(routeKey: string, fallbackTop: number = 0): Promise<void> {
    this.restoreScrollImmediate(routeKey, fallbackTop);
    return this.restoreScrollFinal(routeKey, fallbackTop);
  }

  private buildKey(routeKey: string): string {
    return `${this.storageKeyPrefix}${routeKey}`;
  }

  private getDesiredTop(routeKey: string, fallbackTop: number): number {
    const state = this.getState<StoredRouteViewState>(routeKey);
    const stored = Number(state?.scrollY);
    if (Number.isFinite(stored) && stored > 0) {
      return stored;
    }
    return Math.max(0, fallbackTop);
  }

  private canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
  }

  private resolveScrollY(explicit?: unknown): number {
    const direct = Number(explicit);
    if (Number.isFinite(direct) && direct >= 0) {
      return direct;
    }
    if (typeof window !== 'undefined') {
      return Math.max(0, window.scrollY || 0);
    }
    return 0;
  }

  private resolvePageHeight(explicit?: unknown): number {
    const direct = Number(explicit);
    if (Number.isFinite(direct) && direct > 0) {
      return direct;
    }
    if (typeof document !== 'undefined') {
      return Math.max(
        document.body?.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
        typeof window !== 'undefined' ? window.innerHeight : 0
      );
    }
    return 0;
  }

  private clearRestorePrime(routeKey?: string): void {
    if (typeof document === 'undefined') return;
    if (routeKey && this.activePrimedRouteKey && this.activePrimedRouteKey !== routeKey) return;
    document.body.style.minHeight = '';
    this.activePrimedRouteKey = null;
  }
}
