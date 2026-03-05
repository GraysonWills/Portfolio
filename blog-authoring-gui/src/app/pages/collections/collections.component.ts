import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { AuthService } from '../../services/auth.service';
import {
  BlogApiService,
  CollectionsEntryDraft,
  CollectionsEntryRecord
} from '../../services/blog-api.service';
import {
  CollectionsCategory,
  CollectionsCategoryRegistry,
  CollectionsEntryType
} from '../../models/redis-content.model';
import { HotkeysService } from '../../services/hotkeys.service';

type EntryEditorDraft = {
  id?: string;
  listItemID?: string;
  title: string;
  summary: string;
  body: string;
  entryType: CollectionsEntryType;
  categoryId: string;
  tagsInput: string;
  isPublic: boolean;
};

@Component({
  selector: 'app-collections',
  standalone: false,
  templateUrl: './collections.component.html',
  styleUrl: './collections.component.scss'
})
export class CollectionsComponent implements OnInit, OnDestroy {
  isLoading = false;
  isSaving = false;
  showArchivedCategories = false;

  categories: CollectionsCategory[] = [];
  entries: CollectionsEntryRecord[] = [];
  selectedCategoryId = '';
  searchQuery = '';
  selectedTypeFilter: CollectionsEntryType | 'all' = 'all';
  selectedVisibilityFilter: 'all' | 'public' | 'hidden' = 'all';

  newCategoryName = '';
  newCategoryDescription = '';

  editorOpen = false;
  editorDraft: EntryEditorDraft = this.createEmptyDraft();
  private cleanupHotkeys: (() => void) | null = null;

  readonly typeOptions: Array<{ label: string; value: CollectionsEntryType | 'all' }> = [
    { label: 'All Types', value: 'all' },
    { label: 'Lyrics', value: 'lyrics' },
    { label: 'Poem', value: 'poem' },
    { label: 'Quote', value: 'quote' },
    { label: 'Transcript', value: 'transcript' },
    { label: 'Interview', value: 'interview' },
    { label: 'Article', value: 'article' },
    { label: 'Note', value: 'note' },
    { label: 'Custom', value: 'custom' }
  ];

  readonly visibilityOptions: Array<{ label: string; value: 'all' | 'public' | 'hidden' }> = [
    { label: 'All Visibility', value: 'all' },
    { label: 'Public', value: 'public' },
    { label: 'Hidden', value: 'hidden' }
  ];

  constructor(
    private readonly authService: AuthService,
    private readonly blogApi: BlogApiService,
    private readonly messageService: MessageService,
    private readonly confirmationService: ConfirmationService,
    private readonly router: Router,
    private readonly hotkeys: HotkeysService
  ) {}

  ngOnInit(): void {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadData();
    this.registerHotkeys();
  }

  ngOnDestroy(): void {
    this.cleanupHotkeys?.();
    this.cleanupHotkeys = null;
  }

  get visibleCategories(): CollectionsCategory[] {
    const rows = this.categories
      .filter((category) => this.showArchivedCategories || !category.isArchived)
      .sort((a, b) => {
        const aOrder = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
        const bOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
        return aOrder - bOrder;
      });
    return rows;
  }

  get selectedCategory(): CollectionsCategory | null {
    return this.categories.find((category) => category.id === this.selectedCategoryId) || null;
  }

  get filteredEntries(): CollectionsEntryRecord[] {
    const q = String(this.searchQuery || '').trim().toLowerCase();

    return this.entries.filter((entry) => {
      const metadata = entry.metadata || ({} as any);
      if (this.selectedCategoryId && metadata.categoryId !== this.selectedCategoryId) return false;
      if (this.selectedTypeFilter !== 'all' && metadata.entryType !== this.selectedTypeFilter) return false;
      if (this.selectedVisibilityFilter !== 'all' && metadata.visibility !== this.selectedVisibilityFilter) return false;
      if (!q) return true;

      const haystack = [
        metadata.title || '',
        metadata.summary || '',
        entry.item?.Text || '',
        ...(Array.isArray(metadata.tags) ? metadata.tags : [])
      ].join(' ').toLowerCase();

      return haystack.includes(q);
    });
  }

  loadData(): void {
    this.isLoading = true;
    forkJoin({
      registry: this.blogApi.getCollectionsRegistry(),
      entries: this.blogApi.getCollectionsEntries()
    }).subscribe({
      next: ({ registry, entries }) => {
        this.categories = this.normalizeCategories(registry);
        this.entries = Array.isArray(entries) ? entries : [];
        this.ensureSelectedCategory();
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Load Failed',
          detail: 'Could not load collections categories and entries.'
        });
      }
    });
  }

  addCategory(): void {
    const name = String(this.newCategoryName || '').trim();
    if (!name) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Missing Category Name',
        detail: 'Enter a category name before saving.'
      });
      return;
    }

    const slug = this.slugify(name);
    if (!slug) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Invalid Category Name',
        detail: 'Category name must include letters or numbers.'
      });
      return;
    }

    const duplicate = this.categories.some((category) => category.slug === slug || category.id === slug);
    if (duplicate) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Duplicate Category',
        detail: 'A category with this name already exists.'
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const maxSortOrder = this.categories.reduce((max, category) => {
      const n = Number(category.sortOrder || 0);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, -1);

    const nextCategory: CollectionsCategory = {
      id: slug,
      name,
      slug,
      description: String(this.newCategoryDescription || '').trim() || undefined,
      isArchived: false,
      sortOrder: maxSortOrder + 1,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const nextRegistry: CollectionsCategoryRegistry = {
      categories: [...this.categories, nextCategory],
      updatedAt: nowIso
    };

    this.isSaving = true;
    this.blogApi.saveCollectionsRegistry(nextRegistry).subscribe({
      next: (registry) => {
        this.isSaving = false;
        this.categories = this.normalizeCategories(registry);
        this.selectedCategoryId = nextCategory.id;
        this.newCategoryName = '';
        this.newCategoryDescription = '';
        this.messageService.add({
          severity: 'success',
          summary: 'Category Added',
          detail: `Added "${nextCategory.name}".`
        });
      },
      error: () => {
        this.isSaving = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Category Save Failed',
          detail: 'Could not save category registry.'
        });
      }
    });
  }

  archiveCategory(category: CollectionsCategory, archive: boolean): void {
    const updated = this.categories.map((item) => {
      if (item.id !== category.id) return item;
      return {
        ...item,
        isArchived: archive,
        updatedAt: new Date().toISOString()
      };
    });

    this.isSaving = true;
    this.blogApi.saveCollectionsRegistry({
      categories: updated,
      updatedAt: new Date().toISOString()
    }).subscribe({
      next: (registry) => {
        this.isSaving = false;
        this.categories = this.normalizeCategories(registry);
        this.ensureSelectedCategory();
        this.messageService.add({
          severity: 'success',
          summary: archive ? 'Category Archived' : 'Category Unarchived',
          detail: `"${category.name}" has been ${archive ? 'hidden from' : 'restored to'} active tabs.`
        });
      },
      error: () => {
        this.isSaving = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Update Failed',
          detail: 'Could not update category state.'
        });
      }
    });
  }

  openCreateEntry(): void {
    this.editorDraft = this.createEmptyDraft(this.selectedCategoryId || this.visibleCategories[0]?.id || 'general');
    this.editorOpen = true;
  }

  openEditEntry(record: CollectionsEntryRecord): void {
    const metadata = record.metadata;
    this.editorDraft = {
      id: record.item.ID,
      listItemID: record.item.ListItemID,
      title: metadata.title || '',
      summary: metadata.summary || '',
      body: String(record.item.Text || ''),
      entryType: metadata.entryType || 'custom',
      categoryId: metadata.categoryId || this.selectedCategoryId || 'general',
      tagsInput: Array.isArray(metadata.tags) ? metadata.tags.join(', ') : '',
      isPublic: !!metadata.isPublic
    };
    this.editorOpen = true;
  }

  saveEntry(): void {
    const title = String(this.editorDraft.title || '').trim();
    const body = String(this.editorDraft.body || '').trim();
    const categoryId = String(this.editorDraft.categoryId || '').trim();

    if (!title || !body || !categoryId) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Missing Required Fields',
        detail: 'Title, category, and content are required.'
      });
      return;
    }

    const category = this.categories.find((item) => item.id === categoryId) || null;
    const tags = this.parseCommaSeparatedList(this.editorDraft.tagsInput);

    const payload: CollectionsEntryDraft = {
      id: this.editorDraft.id,
      listItemID: this.editorDraft.listItemID,
      title,
      summary: String(this.editorDraft.summary || '').trim(),
      body,
      entryType: this.editorDraft.entryType,
      categoryId,
      categoryName: category?.name || undefined,
      categorySlug: category?.slug || undefined,
      tags,
      isPublic: !!this.editorDraft.isPublic
    };

    const isEdit = !!this.editorDraft.id;
    this.isSaving = true;
    this.blogApi.upsertCollectionsEntry(payload).subscribe({
      next: () => {
        this.isSaving = false;
        this.editorOpen = false;
        this.editorDraft = this.createEmptyDraft(categoryId);
        this.loadEntriesOnly();
        this.messageService.add({
          severity: 'success',
          summary: isEdit ? 'Entry Updated' : 'Entry Created',
          detail: `Saved "${title}".`
        });
      },
      error: () => {
        this.isSaving = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Save Failed',
          detail: 'Could not save entry.'
        });
      }
    });
  }

  toggleEntryVisibility(record: CollectionsEntryRecord): void {
    const current = !!record.metadata?.isPublic;
    const next = !current;
    this.blogApi.setCollectionsEntryVisibility(record.item.ID, next).subscribe({
      next: (updated) => {
        record.item = updated;
        record.metadata = {
          ...record.metadata,
          isPublic: next,
          visibility: next ? 'public' : 'hidden',
          updatedAt: new Date().toISOString()
        };
        this.messageService.add({
          severity: 'success',
          summary: next ? 'Now Public' : 'Now Hidden',
          detail: `"${record.metadata.title}" is ${next ? 'visible' : 'hidden'} for public consumers.`
        });
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Visibility Update Failed',
          detail: 'Could not update entry visibility.'
        });
      }
    });
  }

  deleteEntry(record: CollectionsEntryRecord): void {
    this.confirmationService.confirm({
      header: 'Delete Entry',
      icon: 'pi pi-exclamation-triangle',
      message: `Delete "${record.metadata.title}" permanently?`,
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.blogApi.deleteCollectionsEntry(record.item.ID).subscribe({
          next: () => {
            this.entries = this.entries.filter((row) => row.item.ID !== record.item.ID);
            this.messageService.add({
              severity: 'success',
              summary: 'Deleted',
              detail: `Deleted "${record.metadata.title}".`
            });
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: 'Delete Failed',
              detail: 'Could not delete entry.'
            });
          }
        });
      }
    });
  }

  onImportTextFile(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      this.editorDraft.body = content;
      if (!String(this.editorDraft.title || '').trim()) {
        this.editorDraft.title = file.name.replace(/\.[^/.]+$/, '');
      }
      this.messageService.add({
        severity: 'success',
        summary: 'Imported',
        detail: `Loaded text from ${file.name}.`
      });
      if (input) input.value = '';
    };
    reader.onerror = () => {
      this.messageService.add({
        severity: 'error',
        summary: 'Import Failed',
        detail: `Could not read ${file.name}.`
      });
      if (input) input.value = '';
    };
    reader.readAsText(file);
  }

  selectCategory(categoryId: string): void {
    this.selectedCategoryId = categoryId;
  }

  getEntryCategoryName(entry: CollectionsEntryRecord): string {
    const id = entry.metadata?.categoryId;
    return this.categories.find((category) => category.id === id)?.name || entry.metadata?.categoryName || 'Uncategorized';
  }

  refresh(): void {
    this.loadData();
  }

  closeEditor(): void {
    this.editorOpen = false;
    this.editorDraft = this.createEmptyDraft(this.selectedCategoryId || this.visibleCategories[0]?.id || 'general');
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  goToContentStudio(): void {
    this.router.navigate(['/content']);
  }

  goToSubscribers(): void {
    this.router.navigate(['/subscribers']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  private loadEntriesOnly(): void {
    this.blogApi.getCollectionsEntries().subscribe({
      next: (entries) => {
        this.entries = Array.isArray(entries) ? entries : [];
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Reload Failed',
          detail: 'Saved entry, but failed to refresh list.'
        });
      }
    });
  }

  private normalizeCategories(registry: CollectionsCategoryRegistry): CollectionsCategory[] {
    return (registry?.categories || [])
      .map((category, index) => ({
        ...category,
        sortOrder: Number.isFinite(Number(category.sortOrder)) ? Number(category.sortOrder) : index
      }))
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }

  private ensureSelectedCategory(): void {
    if (this.selectedCategoryId && this.categories.some((item) => item.id === this.selectedCategoryId)) {
      return;
    }
    this.selectedCategoryId = this.visibleCategories[0]?.id || this.categories[0]?.id || 'general';
  }

  private createEmptyDraft(categoryId: string = 'general'): EntryEditorDraft {
    return {
      title: '',
      summary: '',
      body: '',
      entryType: 'custom',
      categoryId,
      tagsInput: '',
      isPublic: false
    };
  }

  private parseCommaSeparatedList(input: string): string[] {
    const values = String(input || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => !!value);

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(value);
    }
    return deduped;
  }

  private slugify(value: string): string {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private registerHotkeys(): void {
    this.cleanupHotkeys?.();
    this.cleanupHotkeys = this.hotkeys.register('collections', [
      {
        combo: 'mod+alt+n',
        description: 'Create new collection entry',
        action: () => this.openCreateEntry(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+r',
        description: 'Refresh categories and entries',
        action: () => this.refresh(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+k',
        description: 'Focus new-category name input',
        action: () => this.focusCategoryInput(),
        allowInInputs: true
      }
    ]);
  }

  private focusCategoryInput(): void {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('collections-new-category-name') as HTMLInputElement | null;
    if (!input) return;
    input.focus();
    input.select();
  }
}
