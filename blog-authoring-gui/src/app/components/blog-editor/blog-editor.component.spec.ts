import { FormBuilder } from '@angular/forms';
import { BehaviorSubject, of } from 'rxjs';
import { BlogEditorComponent } from './blog-editor.component';

function createComponent(
  initialData?: any,
  signatureSettings: any = { enabled: true, defaultSignatureId: '', signatures: [] }
): BlogEditorComponent {
  const appState$ = new BehaviorSubject({ isActive: true });
  const draftRecovery = {
    keyFor: jasmine.createSpy('keyFor').and.returnValue('draft:new-post'),
    load: jasmine.createSpy('load').and.returnValue(null),
    save: jasmine.createSpy('save').and.returnValue(true),
    clear: jasmine.createSpy('clear')
  };
  const automationSettings = { templates: [], rules: [] };
  const blogApi = {
    getDefaultSignatureSettings: () => signatureSettings,
    getSignatureSettings: () => of(signatureSettings),
    getSocialDistributionSettings: () => of(automationSettings)
  };
  const component = new BlogEditorComponent(
    new FormBuilder(),
    blogApi as any,
    draftRecovery as any,
    { loadSettings: () => automationSettings, saveSettings: jasmine.createSpy('saveSettings') } as any,
    { appState$: appState$.asObservable() } as any,
    { register: () => () => undefined } as any,
    {} as any,
    { add: jasmine.createSpy('add') } as any,
    { confirm: jasmine.createSpy('confirm') } as any,
    {} as any
  );
  component.initialData = initialData;
  return component;
}

describe('BlogEditorComponent mobile draft safety', () => {
  it('flushes a dirty recovery snapshot as soon as the native app backgrounds', () => {
    const appState$ = new BehaviorSubject({ isActive: true });
    const draftRecovery = {
      keyFor: jasmine.createSpy('keyFor').and.returnValue('draft:new-post'),
      load: jasmine.createSpy('load').and.returnValue(null),
      save: jasmine.createSpy('save').and.returnValue(true),
      clear: jasmine.createSpy('clear')
    };
    const signatureSettings = { enabled: true, defaultSignatureId: '', signatures: [] };
    const automationSettings = { templates: [], rules: [] };
    const blogApi = {
      getDefaultSignatureSettings: () => signatureSettings,
      getSignatureSettings: () => of(signatureSettings),
      getSocialDistributionSettings: () => of(automationSettings)
    };
    const component = new BlogEditorComponent(
      new FormBuilder(),
      blogApi as any,
      draftRecovery as any,
      { loadSettings: () => automationSettings, saveSettings: jasmine.createSpy('saveSettings') } as any,
      { appState$: appState$.asObservable() } as any,
      { register: () => () => undefined } as any,
      {} as any,
      { add: jasmine.createSpy('add') } as any,
      { confirm: jasmine.createSpy('confirm') } as any,
      {} as any
    );

    component.ngOnInit();
    component.blogForm.patchValue({ title: 'An unsaved phone draft' });
    component.blogForm.markAsDirty();
    appState$.next({ isActive: false });

    expect(draftRecovery.save).toHaveBeenCalledTimes(1);
    expect(draftRecovery.save).toHaveBeenCalledWith(
      'draft:new-post',
      jasmine.objectContaining({ formValue: jasmine.objectContaining({ title: 'An unsaved phone draft' }) })
    );
    component.ngOnDestroy();
  });
});

describe('BlogEditorComponent post signature snapshots', () => {
  it('ignores a null post snapshot and uses the library default', () => {
    const librarySignature = {
      id: 'library-default',
      label: 'Library default',
      quote: 'A saved quote',
      quoteAuthor: 'Saved Author',
      signOffName: 'Grayson Wills'
    };
    const component = createComponent({
      listItemID: 'post-with-null-snapshot',
      signatureSnapshot: null
    }, {
      enabled: true,
      defaultSignatureId: librarySignature.id,
      signatures: [librarySignature]
    });

    component.ngOnInit();

    expect(component.getSelectedSignature()).toEqual(librarySignature);
    component.ngOnDestroy();
  });

  it('ignores a malformed post snapshot instead of inventing missing quote data', () => {
    const component = createComponent({
      listItemID: 'post-with-malformed-snapshot',
      signatureSnapshot: {
        id: 'broken-snapshot',
        quote: 'The author field is missing.'
      }
    });

    component.ngOnInit();

    expect(component.getSelectedSignature()).toBeNull();
    expect(component.getSignatureOptions()).not.toContain(jasmine.objectContaining({
      value: 'broken-snapshot'
    }));
    component.ngOnDestroy();
  });

  it('preserves a Mesh signature snapshot that is not in the global library', () => {
    const component = createComponent({
      listItemID: 'mesh-blog-123',
      signatureId: 'mesh-signature-123',
      signatureSnapshot: {
        id: 'mesh-signature-123',
        label: 'Quote by Marianne Williamson',
        quote: 'And as we let our own light shine, we unconsciously give other people permission to do the same',
        quoteAuthor: 'Marianne Williamson',
        signOffName: 'Grayson Wills'
      }
    });

    component.ngOnInit();

    expect(component.blogForm.get('signatureId')?.value).toBe('mesh-signature-123');
    expect(component.getSignatureOptions()).toContain(jasmine.objectContaining({
      label: 'Quote by Marianne Williamson (This post)',
      value: 'mesh-signature-123'
    }));
    expect(component.getSelectedSignature()).toEqual(jasmine.objectContaining({
      quoteAuthor: 'Marianne Williamson',
      signOffName: 'Grayson Wills'
    }));
    component.ngOnDestroy();
  });

  it('normalizes legacy snake-case Mesh signature fields when editing an affected post', () => {
    const component = createComponent({
      listItemID: 'legacy-mesh-blog',
      signatureSnapshot: {
        quote: 'The future depends on what you do today.',
        quote_author: 'Mahatma Gandhi',
        sign_off_name: 'Grayson Wills'
      }
    });

    component.ngOnInit();

    expect(component.getSelectedSignature()).toEqual({
      id: 'post-signature-legacy-mesh-blog',
      label: 'Quote by Mahatma Gandhi',
      quote: 'The future depends on what you do today.',
      quoteAuthor: 'Mahatma Gandhi',
      signOffName: 'Grayson Wills'
    });
    component.ngOnDestroy();
  });

  it('allows a different global library signature to replace the post snapshot', () => {
    const librarySignature = {
      id: 'library-signature',
      label: 'Library quote',
      quote: 'A different quote',
      quoteAuthor: 'Another Author',
      signOffName: 'Grayson Wills'
    };
    const component = createComponent({
      listItemID: 'mesh-blog-123',
      signatureSnapshot: {
        id: 'mesh-signature-123',
        label: 'Mesh quote',
        quote: 'Original quote',
        quoteAuthor: 'Original Author',
        signOffName: 'Grayson Wills'
      }
    }, {
      enabled: true,
      defaultSignatureId: librarySignature.id,
      signatures: [librarySignature]
    });

    component.ngOnInit();
    component.useLibrarySignatureForPost(librarySignature.id);

    expect(component.getSelectedSignature()).toEqual(librarySignature);
    component.ngOnDestroy();
  });
});
