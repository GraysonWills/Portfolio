import { Injectable } from '@angular/core';

type StoredRouteViewState = Record<string, unknown> & {
  scrollY?: number;
  updatedAt?: number;
};

@Injectable({
  providedIn: 'root'
})
export class RouteViewStateService {
  private readonly storageKeyPrefix = 'portfolio_route_view_state_v1_';

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
    if (typeof window === 'undefined') return;
    this.patchState(routeKey, { scrollY: window.scrollY } as Partial<StoredRouteViewState>);
  }

  restoreScroll(routeKey: string, fallbackTop: number = 0): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return Promise.resolve();
    }

    const state = this.getState<StoredRouteViewState>(routeKey);
    const desiredTop = Number.isFinite(Number(state?.scrollY)) ? Number(state?.scrollY) : fallbackTop;
    if (desiredTop <= 0) {
      window.scrollTo({ top: Math.max(0, fallbackTop), behavior: 'auto' });
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 18;
      const tryRestore = () => {
        attempts += 1;
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const targetTop = Math.min(desiredTop, maxScroll);

        window.scrollTo({ top: targetTop, behavior: 'auto' });

        const closeEnough = Math.abs(window.scrollY - targetTop) < 4;
        if (closeEnough || attempts >= maxAttempts) {
          resolve();
          return;
        }

        window.setTimeout(() => requestAnimationFrame(tryRestore), 80);
      };

      requestAnimationFrame(tryRestore);
    });
  }

  private buildKey(routeKey: string): string {
    return `${this.storageKeyPrefix}${routeKey}`;
  }

  private canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
  }
}
