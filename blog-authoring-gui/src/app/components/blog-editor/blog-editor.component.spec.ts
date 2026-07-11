import { FormBuilder } from '@angular/forms';
import { BehaviorSubject, of } from 'rxjs';
import { BlogEditorComponent } from './blog-editor.component';

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
