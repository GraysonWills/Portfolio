import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type HotkeyContext =
  | 'global'
  | 'login'
  | 'register'
  | 'forgot-password'
  | 'dashboard'
  | 'content'
  | 'subscribers'
  | 'collections';

export type HotkeyDefinition = {
  combo: string;
  description: string;
  action: () => void;
  allowInInputs?: boolean;
};

export type HotkeyDescriptor = {
  combo: string;
  comboLabel: string;
  description: string;
  scope: 'Global' | 'Page';
};

type RegisteredHotkey = HotkeyDefinition & {
  id: string;
  context: HotkeyContext;
};

@Injectable({
  providedIn: 'root'
})
export class HotkeysService {
  private readonly registries = new Map<HotkeyContext, Map<string, RegisteredHotkey>>();
  private currentContext: HotkeyContext = 'global';
  private readonly bindingsChangedSubject = new BehaviorSubject<number>(0);
  readonly bindingsChanged$ = this.bindingsChangedSubject.asObservable();
  private readonly helpVisibleSubject = new BehaviorSubject<boolean>(false);
  readonly helpVisible$ = this.helpVisibleSubject.asObservable();

  constructor(
    @Inject(DOCUMENT) private readonly documentRef: Document
  ) {
    this.documentRef.addEventListener('keydown', this.handleKeydown, true);
  }

  register(context: HotkeyContext, definitions: HotkeyDefinition[]): () => void {
    if (!this.registries.has(context)) {
      this.registries.set(context, new Map<string, RegisteredHotkey>());
    }
    const contextMap = this.registries.get(context)!;
    const ids: string[] = [];

    for (const definition of definitions) {
      const id = this.createId();
      contextMap.set(id, {
        ...definition,
        combo: this.normalizeCombo(definition.combo),
        id,
        context
      });
      ids.push(id);
    }

    this.signalBindingsChanged();

    return () => {
      const active = this.registries.get(context);
      if (!active) return;
      ids.forEach((id) => active.delete(id));
      this.signalBindingsChanged();
    };
  }

  setContext(context: HotkeyContext): void {
    this.currentContext = context;
    this.signalBindingsChanged();
  }

  getCurrentContext(): HotkeyContext {
    return this.currentContext;
  }

  showHelp(): void {
    this.helpVisibleSubject.next(true);
  }

  hideHelp(): void {
    this.helpVisibleSubject.next(false);
  }

  toggleHelp(): void {
    this.helpVisibleSubject.next(!this.helpVisibleSubject.getValue());
  }

  isHelpVisible(): boolean {
    return this.helpVisibleSubject.getValue();
  }

  getDisplayBindings(): HotkeyDescriptor[] {
    const globalBindings = this.getRegisteredForContext('global');
    const localBindings = this.currentContext === 'global' ? [] : this.getRegisteredForContext(this.currentContext);

    const toDescriptor = (binding: RegisteredHotkey, scope: 'Global' | 'Page'): HotkeyDescriptor => ({
      combo: binding.combo,
      comboLabel: this.formatComboLabel(binding.combo),
      description: binding.description,
      scope
    });

    const descriptors = [
      ...globalBindings.map((binding) => toDescriptor(binding, 'Global')),
      ...localBindings.map((binding) => toDescriptor(binding, 'Page'))
    ];

    return descriptors.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'Global' ? -1 : 1;
      return a.combo.localeCompare(b.combo);
    });
  }

  private getRegisteredForContext(context: HotkeyContext): RegisteredHotkey[] {
    const map = this.registries.get(context);
    if (!map) return [];
    return Array.from(map.values());
  }

  private getActiveBindings(): RegisteredHotkey[] {
    const globalBindings = this.getRegisteredForContext('global');
    const contextBindings = this.currentContext === 'global'
      ? []
      : this.getRegisteredForContext(this.currentContext);
    return [...globalBindings, ...contextBindings];
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (this.isHelpVisible() && event.key === 'Escape') {
      event.preventDefault();
      this.hideHelp();
      return;
    }

    const combo = this.eventToCombo(event);
    if (!combo) return;

    const binding = this.getActiveBindings().find((entry) => entry.combo === combo);
    if (!binding) return;

    if (!binding.allowInInputs && this.targetIsEditable(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      binding.action();
    } catch (error) {
      console.error('Hotkey action failed:', error);
    }
  };

  private eventToCombo(event: KeyboardEvent): string {
    let key = this.resolveKey(event);
    if (!key) return '';

    if (key.length > 1 && !['/', 'space'].includes(key)) {
      return '';
    }

    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) parts.push('mod');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey) parts.push('shift');
    parts.push(key);

    return this.normalizeCombo(parts.join('+'));
  }

  private resolveKey(event: KeyboardEvent): string {
    const code = String(event.code || '');
    if (code === 'Escape') return 'esc';
    if (code === 'Space') return 'space';
    if (code === 'Slash') return '/';
    if (code === 'Comma') return ',';
    if (code === 'Period') return '.';

    const keyMatch = code.match(/^Key([A-Z])$/);
    if (keyMatch) {
      return keyMatch[1].toLowerCase();
    }

    const digitMatch = code.match(/^Digit([0-9])$/);
    if (digitMatch) {
      return digitMatch[1];
    }

    const numpadMatch = code.match(/^Numpad([0-9])$/);
    if (numpadMatch) {
      return numpadMatch[1];
    }

    let key = String(event.key || '').toLowerCase();
    if (!key) return '';
    if (key === 'escape' || key === 'esc') return 'esc';
    if (key === '?') return '/';
    if (key === ' ') return 'space';
    return key;
  }

  private normalizeCombo(combo: string): string {
    return String(combo || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/\+\+/g, '+');
  }

  private formatComboLabel(combo: string): string {
    return combo
      .split('+')
      .map((part) => {
        if (part === 'mod') return 'Cmd/Ctrl';
        if (part === 'alt') return 'Alt/Option';
        if (part === 'shift') return 'Shift';
        if (part === 'space') return 'Space';
        if (part === 'esc') return 'Esc';
        if (part === '/') return '/';
        return part.toUpperCase();
      })
      .join(' + ');
  }

  private targetIsEditable(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;

    const editableSelector = [
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '.ql-editor',
      '.p-inputtext'
    ].join(',');

    return !!target.closest(editableSelector);
  }

  private createId(): string {
    return `hk-${Math.random().toString(36).slice(2, 10)}`;
  }

  private signalBindingsChanged(): void {
    this.bindingsChangedSubject.next(Date.now());
  }
}
