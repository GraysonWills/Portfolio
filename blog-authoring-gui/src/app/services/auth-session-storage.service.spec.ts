import { AuthSessionStorageService, StoredAuthSession } from './auth-session-storage.service';

describe('AuthSessionStorageService browser fallback', () => {
  const storage = new AuthSessionStorageService();
  const key = 'blog_authoring_cognito_session_v1';

  afterEach(() => localStorage.removeItem(key));

  it('persists the browser session when no native vault is available', async () => {
    const session: StoredAuthSession = {
      username: 'author',
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtMs: Date.now() + 60_000
    };

    expect(storage.usesNativeVault).toBeFalse();
    expect(await storage.save(session)).toBeTrue();
    expect(await storage.load()).toEqual(session);
  });

  it('removes the browser session on clear', async () => {
    localStorage.setItem(key, JSON.stringify({ idToken: 'token', expiresAtMs: Date.now() + 60_000 }));
    await storage.clear();
    expect(localStorage.getItem(key)).toBeNull();
  });
});
