import { AuthService } from './auth.service';
import { AuthSessionStorageService, StoredAuthSession } from './auth-session-storage.service';

describe('AuthService native session lifecycle', () => {
  let service: AuthService | null = null;

  afterEach(() => {
    const timer = (service as any)?.refreshTimer as ReturnType<typeof setInterval> | null;
    if (timer) clearInterval(timer);
    service = null;
  });

  it('does not let an in-flight refresh restore a logged-out session', async () => {
    const stored = currentSession();
    const storage = nativeStorage(stored);
    const refreshResponse = deferred<Response>();
    spyOn(window, 'fetch').and.callFake((_input, init) => {
      const target = String((init?.headers as Record<string, string>)?.['X-Amz-Target'] || '');
      if (target.endsWith('.RevokeToken')) return Promise.resolve(jsonResponse({}));
      return refreshResponse.promise;
    });

    service = new AuthService(storage);
    await service.ensureReady();
    (service as any).session.expiresAtMs = 0;

    const pendingToken = service.getValidIdToken();
    await Promise.resolve();
    service.logout();
    refreshResponse.resolve(jsonResponse({
      AuthenticationResult: {
        IdToken: jwt(Date.now() + 60 * 60 * 1000),
        AccessToken: 'new-access'
      }
    }));

    expect(await pendingToken).toBeNull();
    await (service as any).storageMutation;
    expect(service.isAuthenticated()).toBeFalse();
    expect(storage.save).not.toHaveBeenCalled();
    expect(storage.clear).toHaveBeenCalled();
  });

  it('does not let an in-flight refresh bypass the native memory lock', async () => {
    const stored = currentSession();
    const storage = nativeStorage(stored);
    const refreshResponse = deferred<Response>();
    spyOn(window, 'fetch').and.returnValue(refreshResponse.promise);

    service = new AuthService(storage);
    await service.ensureReady();
    (service as any).session.expiresAtMs = 0;

    const pendingToken = service.getValidIdToken();
    await Promise.resolve();
    service.lockNativeSessionInMemory();
    refreshResponse.resolve(jsonResponse({
      AuthenticationResult: {
        IdToken: jwt(Date.now() + 60 * 60 * 1000),
        AccessToken: 'new-access'
      }
    }));

    expect(await pendingToken).toBeNull();
    expect(service.isAuthenticated()).toBeFalse();
    expect(storage.save).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
  });

  function nativeStorage(stored: StoredAuthSession): AuthSessionStorageService {
    return {
      usesNativeVault: true,
      load: jasmine.createSpy('load').and.resolveTo(stored),
      save: jasmine.createSpy('save').and.resolveTo(true),
      clear: jasmine.createSpy('clear').and.resolveTo()
    } as unknown as AuthSessionStorageService;
  }

  function currentSession(): StoredAuthSession {
    return {
      username: 'grayson',
      idToken: jwt(Date.now() + 60 * 60 * 1000),
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAtMs: Date.now() + 60 * 60 * 1000
    };
  }

  function jwt(expiresAtMs: number): string {
    const payload = btoa(JSON.stringify({ exp: Math.floor(expiresAtMs / 1000), sub: 'grayson' }))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    return `header.${payload}.signature`;
  }

  function jsonResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => { resolve = next; });
    return { promise, resolve };
  }
});
