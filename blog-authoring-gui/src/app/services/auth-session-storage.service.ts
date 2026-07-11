import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

export type StoredAuthSession = {
  username: string;
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
};

type NativeCredential = {
  username: string;
  refreshToken: string;
};

interface SecureSessionPlugin {
  availability(): Promise<{ available: boolean; biometry: string }>;
  saveCredential(options: { value: string }): Promise<void>;
  unlockCredential(options: { reason: string }): Promise<{ value: string | null }>;
  clearCredential(): Promise<void>;
}

const SecureSession = registerPlugin<SecureSessionPlugin>('SecureSession');

@Injectable({ providedIn: 'root' })
export class AuthSessionStorageService {
  private readonly sessionKey = 'blog_authoring_cognito_session_v1';
  private readonly nativeInstallMarker = 'authorstudio_native_install_v1';
  private nativeInstallPrepared = false;

  get usesNativeVault(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  }

  async load(): Promise<StoredAuthSession | null> {
    if (!this.usesNativeVault) return this.loadBrowserSession();

    await this.prepareNativeInstall();
    this.removeBrowserSession();

    try {
      const result = await SecureSession.unlockCredential({
        reason: 'Unlock Author Studio to restore your signed-in session.'
      });
      if (!result?.value) return null;

      const credential = JSON.parse(result.value) as NativeCredential;
      const username = String(credential?.username || '').trim();
      const refreshToken = String(credential?.refreshToken || '').trim();
      if (!username || !refreshToken) return null;

      return {
        username,
        refreshToken,
        idToken: '',
        accessToken: '',
        expiresAtMs: 0
      };
    } catch {
      // Cancellation or invalidated biometric data leaves the app signed out;
      // the Keychain item remains available for another explicit launch/login.
      return null;
    }
  }

  async save(session: StoredAuthSession): Promise<boolean> {
    if (!this.usesNativeVault) {
      try {
        localStorage.setItem(this.sessionKey, JSON.stringify(session));
        return true;
      } catch {
        return false;
      }
    }

    await this.prepareNativeInstall();
    this.removeBrowserSession();
    const username = String(session?.username || '').trim();
    const refreshToken = String(session?.refreshToken || '').trim();
    if (!username || !refreshToken) return false;

    try {
      await SecureSession.saveCredential({
        value: JSON.stringify({ username, refreshToken } satisfies NativeCredential)
      });
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    this.removeBrowserSession();
    if (!this.usesNativeVault) return;
    try {
      await SecureSession.clearCredential();
    } catch {
      // The in-memory session is cleared regardless of native cleanup errors.
    }
  }

  async getNativeAvailability(): Promise<{ available: boolean; biometry: string }> {
    if (!this.usesNativeVault) return { available: false, biometry: 'none' };
    try {
      return await SecureSession.availability();
    } catch {
      return { available: false, biometry: 'none' };
    }
  }

  private loadBrowserSession(): StoredAuthSession | null {
    try {
      const raw = localStorage.getItem(this.sessionKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredAuthSession;
      if (!parsed?.idToken || !parsed?.expiresAtMs) return null;
      if (Date.now() >= parsed.expiresAtMs && !parsed.refreshToken) {
        this.removeBrowserSession();
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private removeBrowserSession(): void {
    try {
      localStorage.removeItem(this.sessionKey);
    } catch {
      // Ignore storage restrictions.
    }
  }

  private async prepareNativeInstall(): Promise<void> {
    if (this.nativeInstallPrepared) return;
    this.nativeInstallPrepared = true;

    try {
      if (localStorage.getItem(this.nativeInstallMarker) === '1') return;
      await SecureSession.clearCredential().catch(() => undefined);
      localStorage.setItem(this.nativeInstallMarker, '1');
    } catch {
      // Installation marker is defense in depth; Keychain access control remains.
    }
  }
}
