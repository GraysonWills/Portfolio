import { BlogDraftRecoveryService, BlogDraftRecoverySnapshot } from './blog-draft-recovery.service';

describe('BlogDraftRecoveryService', () => {
  const service = new BlogDraftRecoveryService();
  const key = service.keyFor('post-1');

  afterEach(() => localStorage.removeItem(key));

  it('stores and restores a versioned recovery snapshot', () => {
    const snapshot: BlogDraftRecoverySnapshot = {
      version: 1,
      savedAt: '2026-07-10T20:00:00.000Z',
      sourceUpdatedAt: null,
      formValue: { title: 'Recovered draft', status: 'draft' },
      publicTags: ['mobile'],
      privateSeoTags: [],
      pendingPublicTag: '',
      pendingPrivateTag: '',
      uploadedImage: null
    };

    expect(service.save(key, snapshot)).toBeTrue();
    expect(service.load(key)).toEqual(snapshot);
  });

  it('clears invalid recovery data', () => {
    localStorage.setItem(key, JSON.stringify({ version: 0, savedAt: 'bad' }));
    expect(service.load(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });
});
