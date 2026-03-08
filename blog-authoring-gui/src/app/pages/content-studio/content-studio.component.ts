import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { forkJoin, of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ApiHealth, BlogApiService } from '../../services/blog-api.service';
import { TransactionLogService } from '../../services/transaction-log.service';
import { RedisContent, PageID, PageContentID } from '../../models/redis-content.model';
import { environment } from '../../../environments/environment';
import { HotkeysService } from '../../services/hotkeys.service';

type Option<T> = { label: string; value: T };

type RedisContentDraft = {
  isNew: boolean;
  ID: string;
  PageID: number;
  PageContentID: number;
  ListItemID: string;
  Text: string;
  Photo: string;
  metadataJson: string;
  CreatedAt?: any;
  UpdatedAt?: any;
};

type StudioEntryKind =
  | 'header-branding'
  | 'footer-link'
  | 'hero-slide'
  | 'landing-copy'
  | 'timeline-entry'
  | 'career-metric'
  | 'work-copy'
  | 'project-category'
  | 'project-card'
  | 'blog-post'
  | 'signature-settings'
  | 'collection-entry'
  | 'collections-registry'
  | 'generic';

type StudioSectionKind =
  | 'header'
  | 'footer'
  | 'landing'
  | 'work'
  | 'projects'
  | 'blog'
  | 'collections'
  | 'generic';

interface StudioEntry {
  id: string;
  kind: StudioEntryKind;
  pageId: number;
  sectionId: string;
  contentId: number;
  listItemID: string;
  order: number;
  title: string;
  subtitle: string;
  summary: string;
  previewText: string;
  photo: string;
  eyebrow: string;
  chips: string[];
  items: RedisContent[];
  fixed?: boolean;
}

interface StudioSection {
  id: string;
  kind: StudioSectionKind;
  pageId: number;
  pageLabel: string;
  title: string;
  description: string;
  order: number;
  entries: StudioEntry[];
  badges: string[];
  reorderable: boolean;
}

interface InspectorDraft {
  sourceEntryId: string;
  kind: StudioEntryKind;
  ids: string[];
  pageId: number;
  contentId: number;
  listItemID: string;
  title: string;
  subtitle: string;
  description: string;
  body: string;
  imageUrl: string;
  altText: string;
  url: string;
  secondaryUrl: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  achievementsText: string;
  tags: string;
  privateTags: string;
  techStack: string;
  date: string;
  label: string;
  value: number | null;
  level: string;
  status: string;
  category: string;
  publishDate: string;
  readTimeMinutes: number | null;
}

@Component({
  selector: 'app-content-studio',
  templateUrl: './content-studio.component.html',
  styleUrl: './content-studio.component.scss',
  standalone: false
})
export class ContentStudioComponent implements OnInit, OnDestroy {
  apiEndpoint: string = '';
  connectionStatus: 'connected' | 'disconnected' | 'testing' = 'disconnected';
  isConnecting: boolean = false;
  showSettings: boolean = false;
  apiHealth: ApiHealth | null = null;
  appOrigin: string = '';
  readonly isProd = environment.production;

  pageOptions: Option<number>[] = [
    { label: 'All Pages', value: -1 },
    { label: 'Landing (0)', value: PageID.Landing },
    { label: 'Work (1)', value: PageID.Work },
    { label: 'Projects (2)', value: PageID.Projects },
    { label: 'Blog (3)', value: PageID.Blog },
    { label: 'Collections (4)', value: PageID.Collections }
  ];
  pageOptionsEditable: Option<number>[] = [];
  contentOptions: Option<number>[] = [];
  contentOptionsEditable: Option<number>[] = [];
  selectedPageId: number = PageID.Landing;
  selectedContentId: number = -1;
  searchQuery: string = '';

  isLoading: boolean = false;
  content: RedisContent[] = [];
  filteredContent: RedisContent[] = [];
  sections: StudioSection[] = [];
  visibleSections: StudioSection[] = [];
  selectedSectionId: string | null = null;
  selectedEntryId: string | null = null;
  inspectorDraft: InspectorDraft | null = null;
  inspectorSaving: boolean = false;

  editorOpen: boolean = false;
  editorSaving: boolean = false;
  draft: RedisContentDraft | null = null;
  isPreviewOpening: boolean = false;
  private cleanupHotkeys: (() => void) | null = null;
  private visibleCount = 0;
  private readonly pageSize = 8;
  private readonly scrollLoadBufferPx = 500;
  private contentNextToken: string | null = null;
  private isFetchingNextPage = false;

  readonly blogStatusOptions: Option<string>[] = [
    { label: 'Draft', value: 'draft' },
    { label: 'Scheduled', value: 'scheduled' },
    { label: 'Published', value: 'published' }
  ];

  private readonly pageLabels = new Map<number, string>([
    [0, 'Landing'],
    [1, 'Work'],
    [2, 'Projects'],
    [3, 'Blog'],
    [4, 'Collections']
  ]);

  private readonly contentLabels = new Map<number, string>([
    [0, 'HeaderText'],
    [1, 'HeaderIcon'],
    [2, 'FooterIcon'],
    [3, 'BlogItem'],
    [4, 'BlogText'],
    [5, 'BlogImage'],
    [6, 'LandingPhoto'],
    [7, 'LandingText'],
    [8, 'WorkText'],
    [9, 'ProjectsCategoryPhoto'],
    [10, 'ProjectsCategoryText'],
    [11, 'ProjectsPhoto'],
    [12, 'ProjectsText'],
    [13, 'BlogBody'],
    [14, 'WorkSkillMetric'],
    [15, 'BlogSignatureSettings'],
    [16, 'CollectionsCategoryRegistry'],
    [17, 'CollectionsEntry']
  ]);

  constructor(
    private authService: AuthService,
    private blogApi: BlogApiService,
    public txLog: TransactionLogService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private router: Router,
    private hotkeys: HotkeysService
  ) {}

  public get routerRef(): Router {
    return this.router;
  }

  get hasMoreVisibleSections(): boolean {
    return this.visibleSections.length < this.sections.length || !!this.contentNextToken;
  }

  get selectedSection(): StudioSection | null {
    if (!this.selectedSectionId) return this.visibleSections[0] || this.sections[0] || null;
    return this.sections.find((section) => section.id === this.selectedSectionId) || null;
  }

  get selectedEntry(): StudioEntry | null {
    const section = this.selectedSection;
    if (!section) return null;
    if (!this.selectedEntryId) return section.entries[0] || null;
    return section.entries.find((entry) => entry.id === this.selectedEntryId) || section.entries[0] || null;
  }

  ngOnInit(): void {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    this.apiEndpoint = this.blogApi.getApiEndpoint();
    this.appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    this.buildContentOptions();
    this.pageOptionsEditable = this.pageOptions.filter((o) => o.value !== -1);
    this.contentOptionsEditable = this.contentOptions.filter((o) => o.value !== -1);
    this.coerceFilterSelections();
    this.connectionStatus = 'connected';
    this.loadContent();
    this.registerHotkeys();
  }

  ngOnDestroy(): void {
    this.cleanupHotkeys?.();
    this.cleanupHotkeys = null;
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.editorOpen || this.isLoading || !this.hasMoreVisibleSections) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const viewportBottom = window.scrollY + window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    if ((documentHeight - viewportBottom) <= this.scrollLoadBufferPx) {
      this.loadMoreVisibleRows();
    }
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  goToCollections(): void {
    this.router.navigate(['/collections']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  private registerHotkeys(): void {
    this.cleanupHotkeys?.();
    this.cleanupHotkeys = this.hotkeys.register('content', [
      {
        combo: 'mod+alt+n',
        description: 'Create new content item',
        action: () => this.newItem(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+r',
        description: 'Refresh content list',
        action: () => this.refresh(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+s',
        description: 'Toggle API settings panel',
        action: () => this.toggleSettings(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+p',
        description: 'Preview selected page in site',
        action: () => this.previewCurrentPageOnSite(),
        allowInInputs: true
      },
      {
        combo: 'mod+shift+s',
        description: 'Save selected content changes',
        action: () => this.saveCurrentContentShortcut(),
        allowInInputs: true
      },
      {
        combo: 'mod+shift+e',
        description: 'Open advanced record editor for selected item',
        action: () => this.openAdvancedEditorForSelected(),
        allowInInputs: true
      },
      {
        combo: 'mod+shift+h',
        description: 'Select previous section',
        action: () => this.focusAdjacentSection(-1),
        allowInInputs: true
      },
      {
        combo: 'mod+shift+l',
        description: 'Select next section',
        action: () => this.focusAdjacentSection(1),
        allowInInputs: true
      },
      {
        combo: 'mod+shift+k',
        description: 'Select previous entry',
        action: () => this.focusAdjacentEntry(-1),
        allowInInputs: true
      },
      {
        combo: 'mod+shift+j',
        description: 'Select next entry',
        action: () => this.focusAdjacentEntry(1),
        allowInInputs: true
      },
      {
        combo: 'mod+shift+,',
        description: 'Move selected entry up',
        action: () => this.moveSelectedEntry(-1),
        allowInInputs: true
      },
      {
        combo: 'mod+shift+.',
        description: 'Move selected entry down',
        action: () => this.moveSelectedEntry(1),
        allowInInputs: true
      },
      {
        combo: 'mod+shift+d',
        description: 'Delete selected content item',
        action: () => this.deleteSelectedEntry(),
        allowInInputs: true
      },
      {
        combo: 'esc',
        description: 'Close active editor or settings panel',
        action: () => this.handleEscapeHotkey(),
        allowInInputs: true
      }
    ]);
  }

  private saveCurrentContentShortcut(): void {
    if (this.editorOpen) {
      this.saveDraft();
      return;
    }
    if (this.inspectorDraft) {
      this.saveInspectorDraft();
      return;
    }
    this.messageService.add({
      severity: 'info',
      summary: 'Nothing Selected',
      detail: 'Select an entry or open the advanced editor before saving.'
    });
  }

  private handleEscapeHotkey(): void {
    if (this.editorOpen) {
      this.closeEditor();
      return;
    }
    if (this.showSettings) {
      this.showSettings = false;
    }
  }

  private focusAdjacentSection(offset: -1 | 1): void {
    if (!this.sections.length) return;
    const currentIndex = this.sections.findIndex((section) => section.id === this.selectedSectionId);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(this.sections.length - 1, baseIndex + offset));
    if (nextIndex === currentIndex) return;
    this.selectSectionByIndex(nextIndex);
  }

  private focusAdjacentEntry(offset: -1 | 1): void {
    const section = this.selectedSection;
    if (!section?.entries?.length) return;

    const currentIndex = section.entries.findIndex((entry) => entry.id === this.selectedEntryId);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = baseIndex + offset;

    if (nextIndex >= 0 && nextIndex < section.entries.length) {
      this.selectEntry(section, section.entries[nextIndex]);
      return;
    }

    const sectionIndex = this.sections.findIndex((candidate) => candidate.id === section.id);
    const nextSectionIndex = sectionIndex + offset;
    if (nextSectionIndex < 0 || nextSectionIndex >= this.sections.length) {
      return;
    }

    const nextSection = this.sections[nextSectionIndex];
    this.ensureSectionVisible(nextSectionIndex);
    const nextEntry = offset > 0
      ? (nextSection.entries[0] || null)
      : (nextSection.entries[nextSection.entries.length - 1] || null);
    if (!nextEntry) {
      this.selectSection(nextSection);
      return;
    }
    this.selectEntry(nextSection, nextEntry);
  }

  private moveSelectedEntry(offset: -1 | 1): void {
    const section = this.selectedSection;
    const entry = this.selectedEntry;
    if (!section || !entry || !this.canDragEntry(section, entry)) return;

    const nextDraggableEntries = [...this.getDraggableEntries(section)];
    const currentIndex = nextDraggableEntries.findIndex((candidate) => candidate.id === entry.id);
    if (currentIndex < 0) return;

    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= nextDraggableEntries.length) return;

    moveItemInArray(nextDraggableEntries, currentIndex, nextIndex);
    this.persistSectionOrder(section, nextDraggableEntries);
    this.selectedSectionId = section.id;
    this.selectedEntryId = entry.id;
  }

  private selectSectionByIndex(index: number): void {
    const section = this.sections[index];
    if (!section) return;
    this.ensureSectionVisible(index);
    this.selectSection(section);
  }

  private ensureSectionVisible(index: number): void {
    const targetCount = index + 1;
    const currentCount = this.visibleCount || this.pageSize;
    if (targetCount <= currentCount) return;
    this.visibleCount = targetCount;
    this.visibleSections = this.sections.slice(0, this.visibleCount);
  }

  toggleSettings(): void {
    this.showSettings = !this.showSettings;
  }

  saveEndpoint(): void {
    if (!this.apiEndpoint.trim()) return;
    this.blogApi.setApiEndpoint(this.apiEndpoint.trim());
    this.txLog.log('CONFIG', `API endpoint changed to: ${this.apiEndpoint.trim()}`);
    this.messageService.add({
      severity: 'info',
      summary: 'Endpoint Updated',
      detail: 'API endpoint has been updated'
    });
    this.testConnection();
    this.loadContent();
  }

  testConnection(): void {
    this.isConnecting = true;
    this.connectionStatus = 'testing';
    this.blogApi.getHealth().subscribe({
      next: (health) => {
        this.isConnecting = false;
        this.apiHealth = health;
        this.connectionStatus = health?.status !== 'unhealthy' ? 'connected' : 'disconnected';
      },
      error: () => {
        this.isConnecting = false;
        this.connectionStatus = 'disconnected';
      }
    });
  }

  getConnectionStatusIcon(): string {
    switch (this.connectionStatus) {
      case 'connected': return 'pi pi-check-circle';
      case 'testing': return 'pi pi-spin pi-spinner';
      default: return 'pi pi-times-circle';
    }
  }

  getConnectionStatusClass(): string {
    switch (this.connectionStatus) {
      case 'connected': return 'status-connected';
      case 'testing': return 'status-testing';
      default: return 'status-disconnected';
    }
  }

  buildContentOptions(): void {
    const opts: Option<number>[] = [{ label: 'All Types', value: -1 }];
    for (const [id, label] of this.contentLabels.entries()) {
      opts.push({ label: `${label} (${id})`, value: id });
    }
    opts.sort((a, b) => a.value - b.value);
    this.contentOptions = opts;
    this.contentOptionsEditable = this.contentOptions.filter((o) => o.value !== -1);
  }

  refresh(): void {
    this.loadContent();
  }

  onFilterChanged(): void {
    this.loadContent();
  }

  onContentTypeChanged(): void {
    this.coerceFilterSelections();
    this.loadContent();
  }

  loadContent(): void {
    this.coerceFilterSelections();
    this.isLoading = true;
    this.contentNextToken = null;
    this.isFetchingNextPage = false;
    this.blogApi.getAdminContentV3({
      pageId: this.selectedPageId,
      contentId: this.selectedContentId,
      q: this.searchQuery.trim(),
      limit: 80,
      cacheScope: `route:/content:${this.selectedPageId}:${this.selectedContentId}`
    }).subscribe({
      next: (response) => {
        this.content = Array.isArray(response?.items) ? response.items : [];
        this.contentNextToken = response?.nextToken || null;
        this.applyFilters();
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load content from API'
        });
      }
    });
  }

  private applyFilters(): void {
    this.coerceFilterSelections();
    const items = [...this.content].sort((a, b) => this.compareByUpdatedThenId(a, b));
    this.filteredContent = items;
    this.sections = this.buildStudioSections(items);
    this.resetVisibleRows();
    this.syncSelection();
  }

  getPageLabel(pageId: number): string {
    return this.pageLabels.get(Number(pageId)) || `Page ${pageId}`;
  }

  getContentLabel(contentId: number): string {
    return this.contentLabels.get(Number(contentId)) || `Content ${contentId}`;
  }

  getEntryKindLabel(kind: StudioEntryKind): string {
    switch (kind) {
      case 'header-branding': return 'Header Branding';
      case 'footer-link': return 'Footer Link';
      case 'hero-slide': return 'Hero Slide';
      case 'landing-copy': return 'Landing Copy';
      case 'timeline-entry': return 'Timeline Entry';
      case 'career-metric': return 'Career Metric';
      case 'work-copy': return 'Work Copy';
      case 'project-category': return 'Project Category';
      case 'project-card': return 'Project Card';
      case 'blog-post': return 'Blog Summary';
      case 'signature-settings': return 'Signature Settings';
      case 'collection-entry': return 'Collection Entry';
      case 'collections-registry': return 'Collections Registry';
      default: return 'Generic Content';
    }
  }

  getEntryOrderLabel(entry: StudioEntry): string {
    return entry.order > 0 && Number.isFinite(entry.order) ? `Order ${entry.order}` : 'Unordered';
  }

  getTextPreview(text?: string): string {
    if (!text) return '';
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
  }

  isSectionSelected(section: StudioSection): boolean {
    return this.selectedSectionId === section.id;
  }

  isEntrySelected(entry: StudioEntry): boolean {
    return this.selectedEntryId === entry.id;
  }

  selectSection(section: StudioSection): void {
    this.selectedSectionId = section.id;
    const nextEntry = section.entries.find((entry) => !entry.fixed) || section.entries[0] || null;
    this.selectedEntryId = nextEntry?.id || null;
    this.inspectorDraft = nextEntry ? this.buildInspectorDraft(nextEntry) : null;
  }

  selectEntry(section: StudioSection, entry: StudioEntry, event?: Event): void {
    event?.stopPropagation();
    this.selectedSectionId = section.id;
    this.selectedEntryId = entry.id;
    this.inspectorDraft = this.buildInspectorDraft(entry);
  }

  loadMoreVisibleRows(): void {
    if (!this.hasMoreVisibleSections) return;
    if (this.visibleSections.length < this.sections.length) {
      this.visibleCount += this.pageSize;
      this.visibleSections = this.sections.slice(0, this.visibleCount);
    }

    const nearLoadedEnd = this.visibleSections.length >= (this.sections.length - 2);
    if (nearLoadedEnd) {
      this.fetchNextContentPage();
    }
  }

  trackBySection(index: number, section: StudioSection): string {
    return section.id || `${index}`;
  }

  trackByEntry(index: number, entry: StudioEntry): string {
    return entry.id || `${index}`;
  }

  getPinnedEntries(section: StudioSection): StudioEntry[] {
    return section.entries.filter((entry) => !!entry.fixed);
  }

  getDraggableEntries(section: StudioSection): StudioEntry[] {
    return section.entries.filter((entry) => !entry.fixed);
  }

  canDragEntry(section: StudioSection, entry: StudioEntry): boolean {
    return section.reorderable && !entry.fixed;
  }

  canDeleteEntry(entry: StudioEntry | null): boolean {
    if (!entry) return false;
    return !['header-branding', 'project-category', 'signature-settings', 'collections-registry'].includes(entry.kind);
  }

  onSectionDrop(event: CdkDragDrop<StudioEntry[]>, section: StudioSection): void {
    if (!section.reorderable || event.previousIndex === event.currentIndex) return;

    const nextDraggableEntries = [...this.getDraggableEntries(section)];
    moveItemInArray(nextDraggableEntries, event.previousIndex, event.currentIndex);
    this.persistSectionOrder(section, nextDraggableEntries);
  }

  private persistSectionOrder(section: StudioSection, nextDraggableEntries: StudioEntry[]): void {
    const pinnedEntries = this.getPinnedEntries(section);
    section.entries = [...pinnedEntries, ...nextDraggableEntries];
    this.sections = this.sections.map((candidate) => candidate.id === section.id ? { ...section, entries: [...section.entries] } : candidate);
    this.visibleSections = this.sections.slice(0, this.visibleCount || this.pageSize);

    const requests = nextDraggableEntries.flatMap((entry, index) => {
      const nextOrder = index + 1;
      return entry.items
        .filter((item) => !!item?.ID)
        .map((item) => this.blogApi.updateContent(item.ID, {
          Metadata: {
            ...(item.Metadata || {}),
            order: nextOrder
          }
        }));
    });

    if (!requests.length) {
      return;
    }

    forkJoin(requests).subscribe({
      next: () => {
        this.txLog.log('REORDER', `Reordered ${section.title}`);
        this.messageService.add({
          severity: 'success',
          summary: 'Order Updated',
          detail: `${section.title} now matches the new visual order.`
        });
        this.loadContent();
      },
      error: (err) => {
        this.txLog.log('REORDER_FAILED', `Failed to reorder ${section.title} — ${err?.message || 'unknown error'}`);
        this.messageService.add({
          severity: 'error',
          summary: 'Reorder Failed',
          detail: 'Could not save the new order. The section has been reloaded.'
        });
        this.loadContent();
      }
    });
  }

  saveInspectorDraft(): void {
    const entry = this.selectedEntry;
    const draft = this.inspectorDraft;
    if (!entry || !draft) return;

    const requests = this.buildInspectorSaveRequests(entry, draft);
    if (!requests.length) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Nothing to Save',
        detail: 'This entry does not have any editable fields yet.'
      });
      return;
    }

    this.inspectorSaving = true;
    forkJoin(requests.length ? requests : [of(null)]).subscribe({
      next: () => {
        this.inspectorSaving = false;
        this.txLog.log('UPDATED', `Updated content studio entry: ${entry.title}`);
        this.messageService.add({
          severity: 'success',
          summary: 'Saved',
          detail: `${entry.title} has been updated.`
        });
        this.loadContent();
      },
      error: (err) => {
        this.inspectorSaving = false;
        this.txLog.log('SAVE_FAILED', `Failed to save content studio entry: ${entry.title} — ${err?.message || 'unknown error'}`);
        this.messageService.add({
          severity: 'error',
          summary: 'Save Failed',
          detail: 'Could not save the selected entry.'
        });
      }
    });
  }

  openAdvancedEditorForSelected(): void {
    const entry = this.selectedEntry;
    if (!entry?.items?.length) return;
    this.openDraft(this.toDraft(entry.items[0]));
  }

  deleteSelectedEntry(): void {
    const entry = this.selectedEntry;
    if (!entry || !this.canDeleteEntry(entry)) return;

    const ids = entry.items.map((item) => item.ID).filter(Boolean);
    if (!ids.length) return;

    this.confirmationService.confirm({
      message: `Delete ${entry.title}? This removes ${ids.length} backing record${ids.length === 1 ? '' : 's'}.`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        forkJoin(ids.map((id) => this.blogApi.deleteContent(id))).subscribe({
          next: () => {
            this.txLog.log('DELETE', `Deleted content studio entry: ${entry.title}`);
            this.messageService.add({
              severity: 'success',
              summary: 'Deleted',
              detail: `${entry.title} has been removed.`
            });
            this.loadContent();
          },
          error: (err) => {
            this.txLog.log('DELETE_FAILED', `Failed to delete content studio entry: ${entry.title} — ${err?.message || 'unknown error'}`);
            this.messageService.add({
              severity: 'error',
              summary: 'Delete Failed',
              detail: 'Could not delete the selected entry.'
            });
          }
        });
      }
    });
  }

  isTimelineDraft(draft: InspectorDraft | null): boolean {
    return draft?.kind === 'timeline-entry';
  }

  isMetricDraft(draft: InspectorDraft | null): boolean {
    return draft?.kind === 'career-metric';
  }

  isProjectCategoryDraft(draft: InspectorDraft | null): boolean {
    return draft?.kind === 'project-category';
  }

  isProjectCardDraft(draft: InspectorDraft | null): boolean {
    return draft?.kind === 'project-card';
  }

  isBlogDraft(draft: InspectorDraft | null): boolean {
    return draft?.kind === 'blog-post';
  }

  isFooterDraft(draft: InspectorDraft | null): boolean {
    return draft?.kind === 'footer-link';
  }

  isHeaderDraft(draft: InspectorDraft | null): boolean {
    return draft?.kind === 'header-branding';
  }

  isHeroDraft(draft: InspectorDraft | null): boolean {
    return draft?.kind === 'hero-slide';
  }

  isLandingCopyDraft(draft: InspectorDraft | null): boolean {
    return draft?.kind === 'landing-copy' || draft?.kind === 'work-copy';
  }

  isCollectionEntryDraft(draft: InspectorDraft | null): boolean {
    return draft?.kind === 'collection-entry';
  }

  newItem(): void {
    const pageId = this.selectedPageId === -1 ? PageID.Landing : this.selectedPageId;
    this.openDraft({
      isNew: true,
      ID: '',
      PageID: pageId,
      PageContentID: PageContentID.LandingText,
      ListItemID: '',
      Text: '',
      Photo: '',
      metadataJson: '{}'
    });
  }

  duplicateItem(item: RedisContent): void {
    const draft = this.toDraft(item);
    draft.isNew = true;
    draft.ID = '';
    this.openDraft(draft);
  }

  editItem(item: RedisContent): void {
    this.openDraft(this.toDraft(item));
  }

  closeEditor(): void {
    this.editorOpen = false;
    this.draft = null;
  }

  onDraftImageUploaded(photo: string): void {
    if (!this.draft) return;
    this.draft.Photo = (photo || '').trim();
  }

  formatMetadataJson(): void {
    if (!this.draft) return;
    const formatted = this.tryFormatJson(this.draft.metadataJson);
    if (!formatted) return;
    this.draft.metadataJson = formatted;
  }

  formatTextJson(): void {
    if (!this.draft) return;
    const formatted = this.tryFormatJson(this.draft.Text);
    if (!formatted) return;
    this.draft.Text = formatted;
  }

  private tryFormatJson(value: string): string | null {
    if (!value?.trim()) return null;
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      this.messageService.add({
        severity: 'warn',
        summary: 'Not JSON',
        detail: 'This field does not contain valid JSON to format'
      });
      return null;
    }
  }

  saveDraft(): void {
    if (!this.draft) return;

    const draft = this.draft;
    const id = draft.ID.trim();
    const payload: any = {
      PageID: Number(draft.PageID),
      PageContentID: Number(draft.PageContentID),
      ListItemID: draft.ListItemID.trim() || undefined,
      Text: draft.Text?.trim() ? draft.Text : null,
      Photo: draft.Photo?.trim() ? draft.Photo : null
    };

    const metaRaw = (draft.metadataJson || '').trim();
    if (metaRaw && metaRaw !== '{}' && metaRaw !== 'null') {
      try {
        payload.Metadata = JSON.parse(metaRaw);
      } catch {
        this.messageService.add({
          severity: 'error',
          summary: 'Invalid Metadata',
          detail: 'Metadata must be valid JSON'
        });
        return;
      }
    } else {
      payload.Metadata = {};
    }

    this.editorSaving = true;

    const op$ = draft.isNew
      ? this.blogApi.createContent({ ...(id ? { ID: id } : {}), ...payload })
      : this.blogApi.updateContent(id, payload);

    op$.subscribe({
      next: (saved) => {
        this.editorSaving = false;
        const action = draft.isNew ? 'CREATED' : 'UPDATED';
        const savedId = (saved as any)?.ID || id || '(new)';
        this.txLog.log(action, `${action} content: ${savedId} (${this.getPageLabel(payload.PageID)} / ${this.getContentLabel(payload.PageContentID)})`);
        this.messageService.add({
          severity: 'success',
          summary: 'Saved',
          detail: draft.isNew ? 'Content created' : 'Content updated'
        });
        this.closeEditor();
        this.loadContent();
      },
      error: (err) => {
        this.editorSaving = false;
        this.txLog.log('SAVE_FAILED', `Failed to save content: ${id || '(new)'} — ${err?.message || 'unknown error'}`);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to save content'
        });
      }
    });
  }

  deleteItem(item: RedisContent): void {
    this.confirmationService.confirm({
      message: `Delete "${item.ID}"? This cannot be undone.`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.blogApi.deleteContent(item.ID).subscribe({
          next: () => {
            this.txLog.log('DELETE', `Deleted content: ${item.ID}`);
            this.messageService.add({
              severity: 'success',
              summary: 'Deleted',
              detail: 'Content deleted'
            });
            this.loadContent();
          },
          error: (err) => {
            this.txLog.log('DELETE_FAILED', `Failed to delete: ${item.ID} — ${err?.message || 'unknown error'}`);
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: 'Failed to delete content'
            });
          }
        });
      }
    });
  }

  previewCurrentPageOnSite(): void {
    const draftItem = this.buildPreviewItemFromDraft();
    const pageForRoute = draftItem?.PageID ?? (this.selectedEntry?.pageId ?? (this.selectedPageId === -1 ? PageID.Landing : this.selectedPageId));
    const targetPath = this.getPortfolioPathForPage(pageForRoute);

    if (!draftItem) {
      const liveUrl = this.resolvePortfolioUrl(targetPath);
      window.open(liveUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    this.isPreviewOpening = true;
    this.blogApi.createPreviewSession({
      upserts: [draftItem],
      source: 'content-studio'
    }).subscribe({
      next: (session) => {
        this.isPreviewOpening = false;
        const previewUrl = this.blogApi.buildPortfolioPreviewUrl(session.token, targetPath);
        window.open(previewUrl, '_blank', 'noopener,noreferrer');
      },
      error: () => {
        this.isPreviewOpening = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Preview Failed',
          detail: 'Could not create a cloud preview session.'
        });
      }
    });
  }

  private openDraft(draft: RedisContentDraft): void {
    this.draft = draft;
    this.editorOpen = true;
  }

  private toDraft(item: RedisContent): RedisContentDraft {
    return {
      isNew: false,
      ID: item.ID,
      PageID: Number(item.PageID),
      PageContentID: Number(item.PageContentID),
      ListItemID: item.ListItemID || '',
      Text: item.Text || '',
      Photo: item.Photo || '',
      metadataJson: JSON.stringify(item.Metadata || {}, null, 2),
      CreatedAt: (item as any).CreatedAt,
      UpdatedAt: (item as any).UpdatedAt
    };
  }

  private getPortfolioPathForPage(pageId: number): string {
    switch (Number(pageId)) {
      case PageID.Work:
        return '/work';
      case PageID.Projects:
        return '/projects';
      case PageID.Blog:
        return '/blog';
      case PageID.Collections:
        return '/blog';
      case PageID.Landing:
      default:
        return '/';
    }
  }

  private resolvePortfolioUrl(path: string): string {
    const base = (this.blogApi.getPortfolioPreviewUrl() || '').replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalizedPath}`;
  }

  private buildPreviewItemFromDraft(): Partial<RedisContent> | null {
    if (this.draft) {
      const id = (this.draft.ID || '').trim() || `preview-${Date.now()}`;
      const metadataRaw = (this.draft.metadataJson || '').trim();
      let metadata: Record<string, any> = {};

      if (metadataRaw && metadataRaw !== '{}' && metadataRaw !== 'null') {
        try {
          metadata = JSON.parse(metadataRaw);
        } catch {
          this.messageService.add({
            severity: 'error',
            summary: 'Invalid Metadata',
            detail: 'Metadata must be valid JSON before preview.'
          });
          return null;
        }
      }

      const nowIso = new Date().toISOString();
      return {
        ID: id,
        PageID: Number(this.draft.PageID) as any,
        PageContentID: Number(this.draft.PageContentID) as any,
        ListItemID: (this.draft.ListItemID || '').trim() || undefined,
        Text: this.draft.Text ?? '',
        Photo: this.draft.Photo ?? '',
        Metadata: metadata,
        UpdatedAt: nowIso as any
      };
    }

    const entry = this.selectedEntry;
    if (!entry?.items?.length) return null;
    return {
      ...entry.items[0],
      UpdatedAt: new Date().toISOString() as any
    };
  }

  private fetchNextContentPage(): void {
    this.coerceFilterSelections();
    if (this.isFetchingNextPage || !this.contentNextToken) return;

    this.isFetchingNextPage = true;
    this.blogApi.getAdminContentV3({
      pageId: this.selectedPageId,
      contentId: this.selectedContentId,
      q: this.searchQuery.trim(),
      limit: 80,
      nextToken: this.contentNextToken,
      cacheScope: `route:/content:${this.selectedPageId}:${this.selectedContentId}`
    }).subscribe({
      next: (response) => {
        this.isFetchingNextPage = false;
        this.contentNextToken = response?.nextToken || null;
        const incoming = Array.isArray(response?.items) ? response.items : [];
        if (!incoming.length) return;
        this.content = this.mergeById([...this.content, ...incoming]);
        this.applyFilters();
      },
      error: () => {
        this.isFetchingNextPage = false;
      }
    });
  }

  private mergeById(items: RedisContent[]): RedisContent[] {
    const map = new Map<string, RedisContent>();
    for (const item of items || []) {
      const id = String(item?.ID || `${item?.ListItemID || 'no-list'}-${item?.PageID || 0}-${item?.PageContentID || 0}`);
      map.set(id, item);
    }
    return Array.from(map.values());
  }

  private coerceFilterSelections(): void {
    this.selectedPageId = this.normalizeSelectionNumber(this.selectedPageId, PageID.Landing);
    this.selectedContentId = this.normalizeSelectionNumber(this.selectedContentId, -1);
  }

  private normalizeSelectionNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.trunc(parsed);
  }

  private resetVisibleRows(): void {
    this.visibleCount = this.pageSize;
    this.visibleSections = this.sections.slice(0, this.visibleCount);
  }

  private syncSelection(): void {
    if (!this.sections.length) {
      this.selectedSectionId = null;
      this.selectedEntryId = null;
      this.inspectorDraft = null;
      return;
    }

    const section = this.sections.find((candidate) => candidate.id === this.selectedSectionId)
      || this.visibleSections[0]
      || this.sections[0];

    if (!section) {
      this.selectedSectionId = null;
      this.selectedEntryId = null;
      this.inspectorDraft = null;
      return;
    }

    this.selectedSectionId = section.id;

    const entry = section.entries.find((candidate) => candidate.id === this.selectedEntryId)
      || section.entries.find((candidate) => !candidate.fixed)
      || section.entries[0]
      || null;

    this.selectedEntryId = entry?.id || null;
    this.inspectorDraft = entry ? this.buildInspectorDraft(entry) : null;
  }

  private buildStudioSections(items: RedisContent[]): StudioSection[] {
    const sections: StudioSection[] = [];
    const usedIds = new Set<string>();

    const headerText = this.findFirst(items, PageContentID.HeaderText);
    const headerIcon = this.findFirst(items, PageContentID.HeaderIcon);
    if (headerText || headerIcon) {
      if (headerText?.ID) usedIds.add(headerText.ID);
      if (headerIcon?.ID) usedIds.add(headerIcon.ID);
      sections.push({
        id: 'shared:header-branding',
        kind: 'header',
        pageId: PageID.Landing,
        pageLabel: this.decorateSectionPageLabel(PageID.Landing, true),
        title: 'Header Branding',
        description: 'Site title and avatar used across the portfolio.',
        order: 1,
        badges: ['Shared'],
        reorderable: false,
        entries: [this.buildHeaderBrandingEntry(headerText, headerIcon)]
      });
    }

    const landingPhotos = items
      .filter((item) => Number(item.PageContentID) === Number(PageContentID.LandingPhoto))
      .sort((a, b) => this.compareByOrderThenId(a, b));
    if (landingPhotos.length) {
      landingPhotos.forEach((item) => usedIds.add(item.ID));
      sections.push({
        id: 'landing:hero-slides',
        kind: 'landing',
        pageId: PageID.Landing,
        pageLabel: this.decorateSectionPageLabel(PageID.Landing),
        title: 'Hero Carousel',
        description: 'These slides render as the landing-page hero carousel. Drag to set the display order.',
        order: 10,
        badges: ['Landing', `${landingPhotos.length} slides`],
        reorderable: landingPhotos.length > 1,
        entries: landingPhotos.map((item, index) => this.buildHeroEntry(item, index + 1))
      });
    }

    const landingText = items
      .filter((item) => Number(item.PageContentID) === Number(PageContentID.LandingText))
      .sort((a, b) => this.compareByOrderThenId(a, b));
    if (landingText.length) {
      landingText.forEach((item) => usedIds.add(item.ID));
      sections.push({
        id: 'landing:copy',
        kind: 'landing',
        pageId: PageID.Landing,
        pageLabel: this.decorateSectionPageLabel(PageID.Landing),
        title: 'Landing Copy',
        description: 'Summary and supporting text blocks that appear under the hero section.',
        order: 11,
        badges: ['Landing', `${landingText.length} blocks`],
        reorderable: landingText.length > 1,
        entries: landingText.map((item, index) => this.buildLandingCopyEntry(item, index + 1))
      });
    }

    const footerIcons = items
      .filter((item) => Number(item.PageContentID) === Number(PageContentID.FooterIcon))
      .sort((a, b) => this.compareByOrderThenId(a, b));
    if (footerIcons.length) {
      footerIcons.forEach((item) => usedIds.add(item.ID));
      sections.push({
        id: 'shared:footer-links',
        kind: 'footer',
        pageId: PageID.Landing,
        pageLabel: this.decorateSectionPageLabel(PageID.Landing, true),
        title: 'Footer Links',
        description: 'Contact and external links in the portfolio footer.',
        order: 90,
        badges: ['Shared', `${footerIcons.length} links`],
        reorderable: footerIcons.length > 1,
        entries: footerIcons.map((item, index) => this.buildFooterEntry(item, index + 1))
      });
    }

    const workMetrics = items
      .filter((item) => Number(item.PageContentID) === Number(PageContentID.WorkSkillMetric))
      .sort((a, b) => this.compareByOrderThenId(a, b));
    if (workMetrics.length) {
      workMetrics.forEach((item) => usedIds.add(item.ID));
      sections.push({
        id: 'work:career-metrics',
        kind: 'work',
        pageId: PageID.Work,
        pageLabel: this.decorateSectionPageLabel(PageID.Work),
        title: 'Career Progress Metrics',
        description: 'Progress bars and score cards used in the Work page hero panel.',
        order: 20,
        badges: ['Work', `${workMetrics.length} metrics`],
        reorderable: workMetrics.length > 1,
        entries: workMetrics.map((item, index) => this.buildMetricEntry(item, index + 1))
      });
    }

    const workText = items.filter((item) => Number(item.PageContentID) === Number(PageContentID.WorkText));
    const experiences = workText
      .filter((item) => String(item.Metadata?.['type'] || '').toLowerCase() === 'experience')
      .sort((a, b) => this.compareByOrderThenId(a, b));
    if (experiences.length) {
      experiences.forEach((item) => usedIds.add(item.ID));
      sections.push({
        id: 'work:timeline',
        kind: 'work',
        pageId: PageID.Work,
        pageLabel: this.decorateSectionPageLabel(PageID.Work),
        title: 'Professional Timeline',
        description: 'Each entry powers one card on the vertical timeline. Drag to reorder the timeline.',
        order: 21,
        badges: ['Work', `${experiences.length} entries`],
        reorderable: experiences.length > 1,
        entries: experiences.map((item, index) => this.buildTimelineEntry(item, index + 1))
      });
    }

    const workCopy = workText
      .filter((item) => !usedIds.has(item.ID))
      .sort((a, b) => this.compareByOrderThenId(a, b));
    if (workCopy.length) {
      workCopy.forEach((item) => usedIds.add(item.ID));
      sections.push({
        id: 'work:copy',
        kind: 'work',
        pageId: PageID.Work,
        pageLabel: this.decorateSectionPageLabel(PageID.Work),
        title: 'Work Supporting Copy',
        description: 'Additional work-page content that does not map to the timeline.',
        order: 22,
        badges: ['Work'],
        reorderable: workCopy.length > 1,
        entries: workCopy.map((item, index) => this.buildWorkCopyEntry(item, index + 1))
      });
    }

    const projectGroups = this.groupByListItem(items.filter((item) => [
      PageContentID.ProjectsCategoryPhoto,
      PageContentID.ProjectsCategoryText,
      PageContentID.ProjectsPhoto,
      PageContentID.ProjectsText
    ].includes(Number(item.PageContentID))));

    Array.from(projectGroups.entries())
      .map(([listItemID, groupItems], index) => this.buildProjectSection(listItemID, groupItems, index + 1))
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
      .forEach((section) => {
        section.entries.forEach((entry) => entry.items.forEach((item) => usedIds.add(item.ID)));
        sections.push(section);
      });

    const blogGroups = this.groupByListItem(items.filter((item) => [
      PageContentID.BlogItem,
      PageContentID.BlogText,
      PageContentID.BlogImage,
      PageContentID.BlogBody
    ].includes(Number(item.PageContentID))));

    const blogEntries = Array.from(blogGroups.entries())
      .map(([listItemID, groupItems]) => this.buildBlogEntry(listItemID, groupItems))
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

    if (blogEntries.length) {
      blogEntries.forEach((entry) => entry.items.forEach((item) => usedIds.add(item.ID)));
      sections.push({
        id: 'blog:posts',
        kind: 'blog',
        pageId: PageID.Blog,
        pageLabel: this.decorateSectionPageLabel(PageID.Blog),
        title: 'Blog Index Metadata',
        description: 'Use this to tune blog summaries, category labels, tags, and card images. Full post body editing still belongs in Blog Posts.',
        order: 30,
        badges: ['Blog', `${blogEntries.length} posts`],
        reorderable: false,
        entries: blogEntries
      });
    }

    const signatureSettings = items
      .filter((item) => Number(item.PageContentID) === Number(PageContentID.BlogSignatureSettings))
      .sort((a, b) => this.compareByUpdatedThenId(a, b));
    if (signatureSettings.length) {
      signatureSettings.forEach((item) => usedIds.add(item.ID));
      sections.push({
        id: 'blog:signatures',
        kind: 'blog',
        pageId: PageID.Blog,
        pageLabel: this.decorateSectionPageLabel(PageID.Blog),
        title: 'Signature Settings',
        description: 'Signature defaults live here; detailed management is still easier inside the blog editor.',
        order: 31,
        badges: ['Blog'],
        reorderable: false,
        entries: signatureSettings.map((item, index) => this.buildSignatureSettingsEntry(item, index + 1))
      });
    }

    const collectionsRegistry = items
      .filter((item) => Number(item.PageContentID) === Number(PageContentID.CollectionsCategoryRegistry))
      .sort((a, b) => this.compareByUpdatedThenId(a, b));
    if (collectionsRegistry.length) {
      collectionsRegistry.forEach((item) => usedIds.add(item.ID));
      sections.push({
        id: 'collections:registry',
        kind: 'collections',
        pageId: PageID.Collections,
        pageLabel: this.decorateSectionPageLabel(PageID.Collections),
        title: 'Collections Registry',
        description: 'Category definitions and collection taxonomy.',
        order: 40,
        badges: ['Collections'],
        reorderable: false,
        entries: collectionsRegistry.map((item, index) => this.buildCollectionsRegistryEntry(item, index + 1))
      });
    }

    const collectionEntries = items
      .filter((item) => Number(item.PageContentID) === Number(PageContentID.CollectionsEntry))
      .sort((a, b) => this.compareByUpdatedThenId(a, b));
    if (collectionEntries.length) {
      collectionEntries.forEach((item) => usedIds.add(item.ID));
      sections.push({
        id: 'collections:entries',
        kind: 'collections',
        pageId: PageID.Collections,
        pageLabel: this.decorateSectionPageLabel(PageID.Collections),
        title: 'Collections Entries',
        description: 'Quotes, transcripts, and other long-form records stored outside the public portfolio.',
        order: 41,
        badges: ['Collections', `${collectionEntries.length} entries`],
        reorderable: false,
        entries: collectionEntries.map((item, index) => this.buildCollectionEntry(item, index + 1))
      });
    }

    const leftovers = items
      .filter((item) => !usedIds.has(item.ID))
      .sort((a, b) => this.compareByUpdatedThenId(a, b));

    if (leftovers.length) {
      const groups = new Map<string, RedisContent[]>();
      for (const item of leftovers) {
        const key = `${item.PageID}:${item.PageContentID}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }

      Array.from(groups.entries()).forEach(([key, groupItems], index) => {
        const [pageIdRaw, contentIdRaw] = key.split(':');
        const pageId = Number(pageIdRaw);
        const contentId = Number(contentIdRaw);
        sections.push({
          id: `generic:${key}`,
          kind: 'generic',
          pageId,
          pageLabel: this.decorateSectionPageLabel(pageId),
          title: `${this.getPageLabel(pageId)} · ${this.getContentLabel(contentId)}`,
          description: 'Records without a dedicated structured editor yet.',
          order: 100 + index,
          badges: ['Raw'],
          reorderable: false,
          entries: groupItems.map((item, entryIndex) => this.buildGenericEntry(item, entryIndex + 1))
        });
      });
    }

    return sections
      .filter((section) => section.entries.length > 0)
      .sort((a, b) => a.pageId - b.pageId || a.order - b.order || a.title.localeCompare(b.title));
  }

  private buildHeaderBrandingEntry(headerText?: RedisContent | null, headerIcon?: RedisContent | null): StudioEntry {
    const title = String(headerText?.Text || 'Site Title').trim() || 'Site Title';
    const photo = String(headerIcon?.Photo || '').trim();
    const alt = String(headerIcon?.Metadata?.['alt'] || '').trim();
    return {
      id: 'entry:header-branding',
      kind: 'header-branding',
      pageId: PageID.Landing,
      sectionId: 'shared:header-branding',
      contentId: PageContentID.HeaderText,
      listItemID: '',
      order: 1,
      title,
      subtitle: alt || 'Navigation brand lockup',
      summary: 'Title + avatar shown in the sticky header.',
      previewText: title,
      photo,
      eyebrow: 'Shared Site Chrome',
      chips: ['Header'],
      items: [headerText, headerIcon].filter(Boolean) as RedisContent[],
      fixed: true
    };
  }

  private buildFooterEntry(item: RedisContent, fallbackOrder: number): StudioEntry {
    const url = String(item.Metadata?.['url'] || '').trim();
    return {
      id: `entry:${item.ID}`,
      kind: 'footer-link',
      pageId: PageID.Landing,
      sectionId: 'shared:footer-links',
      contentId: PageContentID.FooterIcon,
      listItemID: item.ListItemID || '',
      order: this.getOrderValue(item, fallbackOrder),
      title: String(item.Text || 'Footer Link').trim() || 'Footer Link',
      subtitle: url || 'External destination',
      summary: 'Footer icon/link',
      previewText: this.getTextPreview(url),
      photo: String(item.Photo || '').trim(),
      eyebrow: 'Footer',
      chips: [this.extractDomain(url) || 'Link'],
      items: [item]
    };
  }

  private buildHeroEntry(item: RedisContent, fallbackOrder: number): StudioEntry {
    const alt = String(item.Metadata?.['alt'] || '').trim();
    const order = this.getOrderValue(item, fallbackOrder);
    return {
      id: `entry:${item.ID}`,
      kind: 'hero-slide',
      pageId: PageID.Landing,
      sectionId: 'landing:hero-slides',
      contentId: PageContentID.LandingPhoto,
      listItemID: item.ListItemID || '',
      order,
      title: alt || `Hero slide ${order}`,
      subtitle: `Slide ${order}`,
      summary: 'Landing page hero image',
      previewText: alt || 'Landing hero image',
      photo: String(item.Photo || '').trim(),
      eyebrow: 'Landing',
      chips: [`Slide ${order}`],
      items: [item]
    };
  }

  private buildLandingCopyEntry(item: RedisContent, fallbackOrder: number): StudioEntry {
    const type = this.prettifyToken(String(item.Metadata?.['type'] || 'text'));
    const order = this.getOrderValue(item, fallbackOrder);
    return {
      id: `entry:${item.ID}`,
      kind: 'landing-copy',
      pageId: PageID.Landing,
      sectionId: 'landing:copy',
      contentId: PageContentID.LandingText,
      listItemID: item.ListItemID || '',
      order,
      title: type,
      subtitle: item.ID,
      summary: this.getTextPreview(item.Text),
      previewText: String(item.Text || ''),
      photo: '',
      eyebrow: 'Landing Copy',
      chips: [type],
      items: [item]
    };
  }

  private buildTimelineEntry(item: RedisContent, fallbackOrder: number): StudioEntry {
    const parsed = this.parseJsonObject(item.Text);
    const order = this.getOrderValue(item, fallbackOrder);
    const title = String(parsed?.['title'] || item.Text || 'Timeline Entry').trim() || 'Timeline Entry';
    const company = String(parsed?.['company'] || '').trim();
    const period = [parsed?.['startDate'], parsed?.['endDate']].filter(Boolean).join(' - ');
    return {
      id: `entry:${item.ID}`,
      kind: 'timeline-entry',
      pageId: PageID.Work,
      sectionId: 'work:timeline',
      contentId: PageContentID.WorkText,
      listItemID: item.ListItemID || '',
      order,
      title,
      subtitle: [company, String(parsed?.['location'] || '').trim()].filter(Boolean).join(' • '),
      summary: period || 'Work timeline record',
      previewText: this.getTextPreview(Array.isArray(parsed?.['description']) ? parsed?.['description']?.join(' ') : item.Text),
      photo: '',
      eyebrow: 'Professional Timeline',
      chips: [period || `Order ${order}`],
      items: [item]
    };
  }

  private buildMetricEntry(item: RedisContent, fallbackOrder: number): StudioEntry {
    const parsed = this.parseJsonObject(item.Text);
    const label = String(parsed?.['label'] || item.Text || 'Metric').trim() || 'Metric';
    const value = Number(parsed?.['value']);
    return {
      id: `entry:${item.ID}`,
      kind: 'career-metric',
      pageId: PageID.Work,
      sectionId: 'work:career-metrics',
      contentId: PageContentID.WorkSkillMetric,
      listItemID: item.ListItemID || '',
      order: this.getOrderValue(item, fallbackOrder),
      title: label,
      subtitle: Number.isFinite(value) ? `${Math.round(value)}%` : 'Metric value',
      summary: String(parsed?.['summary'] || '').trim(),
      previewText: String(parsed?.['summary'] || '').trim(),
      photo: '',
      eyebrow: 'Career Metric',
      chips: [String(parsed?.['level'] || 'Progress')],
      items: [item]
    };
  }

  private buildWorkCopyEntry(item: RedisContent, fallbackOrder: number): StudioEntry {
    const type = this.prettifyToken(String(item.Metadata?.['type'] || 'work-copy'));
    return {
      id: `entry:${item.ID}`,
      kind: 'work-copy',
      pageId: PageID.Work,
      sectionId: 'work:copy',
      contentId: PageContentID.WorkText,
      listItemID: item.ListItemID || '',
      order: this.getOrderValue(item, fallbackOrder),
      title: type,
      subtitle: item.ID,
      summary: this.getTextPreview(item.Text),
      previewText: String(item.Text || ''),
      photo: '',
      eyebrow: 'Work Copy',
      chips: [type],
      items: [item]
    };
  }

  private buildProjectSection(listItemID: string, items: RedisContent[], fallbackOrder: number): StudioSection {
    const categoryText = items.find((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsCategoryText)) || null;
    const categoryPhoto = items.find((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsCategoryPhoto)) || null;
    const categoryName = this.extractProjectCategoryName(categoryText);
    const projectTextItems = items
      .filter((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsText))
      .sort((a, b) => this.compareByOrderThenId(a, b));
    const projectPhotoItems = items
      .filter((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsPhoto))
      .sort((a, b) => this.compareByOrderThenId(a, b));

    const entries: StudioEntry[] = [];
    if (categoryText || categoryPhoto) {
      entries.push({
        id: `entry:project-category:${listItemID}`,
        kind: 'project-category',
        pageId: PageID.Projects,
        sectionId: `projects:${listItemID}`,
        contentId: PageContentID.ProjectsCategoryText,
        listItemID,
        order: this.getOrderValue(categoryText || categoryPhoto, fallbackOrder),
        title: categoryName,
        subtitle: `${projectTextItems.length} project card${projectTextItems.length === 1 ? '' : 's'}`,
        summary: 'Category heading and thumbnail',
        previewText: categoryName,
        photo: String(categoryPhoto?.Photo || '').trim(),
        eyebrow: 'Projects Category',
        chips: ['Category'],
        items: [categoryText, categoryPhoto].filter(Boolean) as RedisContent[],
        fixed: true
      });
    }

    const pairCount = Math.max(projectTextItems.length, projectPhotoItems.length);
    for (let index = 0; index < pairCount; index += 1) {
      const textItem = projectTextItems[index] || null;
      const photoItem = projectPhotoItems[index] || null;
      if (!textItem && !photoItem) continue;
      const parsed = this.parseJsonObject(textItem?.Text);
      const title = String(parsed?.['title'] || textItem?.Text || `Project ${index + 1}`).trim() || `Project ${index + 1}`;
      const description = String(parsed?.['description'] || textItem?.Text || '').trim();
      const techStack = Array.isArray(parsed?.['techStack']) ? parsed?.['techStack'].map((value: unknown) => String(value)) : [];
      entries.push({
        id: `entry:project-card:${listItemID}:${textItem?.ID || photoItem?.ID || index}`,
        kind: 'project-card',
        pageId: PageID.Projects,
        sectionId: `projects:${listItemID}`,
        contentId: PageContentID.ProjectsText,
        listItemID,
        order: this.getOrderValue(textItem || photoItem, index + 1),
        title,
        subtitle: categoryName,
        summary: description || 'Project summary',
        previewText: description,
        photo: String(photoItem?.Photo || '').trim(),
        eyebrow: 'Project Card',
        chips: techStack.slice(0, 3),
        items: [textItem, photoItem].filter(Boolean) as RedisContent[]
      });
    }

    return {
      id: `projects:${listItemID}`,
      kind: 'projects',
      pageId: PageID.Projects,
      pageLabel: this.decorateSectionPageLabel(PageID.Projects),
      title: categoryName,
      description: 'Project category section with an editable header and project cards.',
      order: this.getOrderValue(categoryText || categoryPhoto, fallbackOrder),
      badges: ['Projects', `${Math.max(entries.length - 1, 0)} cards`],
      reorderable: entries.filter((entry) => !entry.fixed).length > 1,
      entries
    };
  }

  private buildBlogEntry(listItemID: string, items: RedisContent[]): StudioEntry {
    const metaItem = items.find((item) => Number(item.PageContentID) === Number(PageContentID.BlogItem)) || items.find((item) => !!item.Metadata) || items[0];
    const excerptItem = items.find((item) => Number(item.PageContentID) === Number(PageContentID.BlogText)) || null;
    const imageItem = items.find((item) => Number(item.PageContentID) === Number(PageContentID.BlogImage)) || null;
    const metadata = (metaItem?.Metadata || {}) as Record<string, any>;
    const title = String(metadata['title'] || metaItem?.Text || 'Untitled').trim() || 'Untitled';
    const category = String(metadata['category'] || 'General').trim();
    const publishDate = metadata['publishDate'] ? new Date(metadata['publishDate']).toISOString() : '';
    const status = String(metadata['status'] || 'draft').trim();
    return {
      id: `entry:blog:${listItemID}`,
      kind: 'blog-post',
      pageId: PageID.Blog,
      sectionId: 'blog:posts',
      contentId: PageContentID.BlogItem,
      listItemID,
      order: publishDate ? -new Date(publishDate).getTime() : Number.MAX_SAFE_INTEGER,
      title,
      subtitle: category,
      summary: String(metadata['summary'] || excerptItem?.Text || '').trim(),
      previewText: String(excerptItem?.Text || '').trim(),
      photo: String(imageItem?.Photo || '').trim(),
      eyebrow: 'Blog Card',
      chips: [status, category].filter(Boolean),
      items: items.sort((a, b) => this.compareByContentTypeThenId(a, b))
    };
  }

  private buildSignatureSettingsEntry(item: RedisContent, fallbackOrder: number): StudioEntry {
    const signatures = Array.isArray(item.Metadata?.['signatureSettings']?.['signatures'])
      ? item.Metadata?.['signatureSettings']?.['signatures']
      : Array.isArray(item.Metadata?.['signatures'])
        ? item.Metadata?.['signatures']
        : [];

    return {
      id: `entry:${item.ID}`,
      kind: 'signature-settings',
      pageId: PageID.Blog,
      sectionId: 'blog:signatures',
      contentId: PageContentID.BlogSignatureSettings,
      listItemID: item.ListItemID || '',
      order: this.getOrderValue(item, fallbackOrder),
      title: 'Blog Signature Defaults',
      subtitle: `${signatures.length} signature${signatures.length === 1 ? '' : 's'}`,
      summary: 'Default sign-off configuration used by the blog.',
      previewText: this.getTextPreview(JSON.stringify(item.Metadata || {})),
      photo: '',
      eyebrow: 'Blog Signatures',
      chips: ['Advanced'],
      items: [item],
      fixed: true
    };
  }

  private buildCollectionsRegistryEntry(item: RedisContent, fallbackOrder: number): StudioEntry {
    const categories = Array.isArray(item.Metadata?.['registry']?.['categories'])
      ? item.Metadata?.['registry']?.['categories']
      : Array.isArray(item.Metadata?.['categories'])
        ? item.Metadata?.['categories']
        : [];

    return {
      id: `entry:${item.ID}`,
      kind: 'collections-registry',
      pageId: PageID.Collections,
      sectionId: 'collections:registry',
      contentId: PageContentID.CollectionsCategoryRegistry,
      listItemID: item.ListItemID || '',
      order: this.getOrderValue(item, fallbackOrder),
      title: 'Category Registry',
      subtitle: `${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`,
      summary: 'Registry metadata for collections.',
      previewText: this.getTextPreview(JSON.stringify(item.Metadata || {})),
      photo: '',
      eyebrow: 'Collections Registry',
      chips: ['Advanced'],
      items: [item],
      fixed: true
    };
  }

  private buildCollectionEntry(item: RedisContent, fallbackOrder: number): StudioEntry {
    const metadata = (item.Metadata || {}) as Record<string, any>;
    return {
      id: `entry:${item.ID}`,
      kind: 'collection-entry',
      pageId: PageID.Collections,
      sectionId: 'collections:entries',
      contentId: PageContentID.CollectionsEntry,
      listItemID: item.ListItemID || '',
      order: this.getOrderValue(item, fallbackOrder),
      title: String(metadata['title'] || item.Text || 'Collection Entry').trim() || 'Collection Entry',
      subtitle: String(metadata['entryType'] || metadata['categoryName'] || '').trim(),
      summary: String(metadata['summary'] || '').trim(),
      previewText: String(item.Text || '').trim(),
      photo: String(item.Photo || '').trim(),
      eyebrow: 'Collections Entry',
      chips: [String(metadata['visibility'] || metadata['entryType'] || 'Entry')].filter(Boolean),
      items: [item]
    };
  }

  private buildGenericEntry(item: RedisContent, fallbackOrder: number): StudioEntry {
    return {
      id: `entry:${item.ID}`,
      kind: 'generic',
      pageId: Number(item.PageID),
      sectionId: `generic:${item.PageID}:${item.PageContentID}`,
      contentId: Number(item.PageContentID),
      listItemID: item.ListItemID || '',
      order: this.getOrderValue(item, fallbackOrder),
      title: String(item.Text || item.ID || 'Content Item').trim() || 'Content Item',
      subtitle: item.ID,
      summary: this.getTextPreview(JSON.stringify(item.Metadata || {})),
      previewText: String(item.Text || ''),
      photo: String(item.Photo || '').trim(),
      eyebrow: this.getContentLabel(Number(item.PageContentID)),
      chips: [this.getPageLabel(Number(item.PageID))],
      items: [item]
    };
  }

  private buildInspectorDraft(entry: StudioEntry): InspectorDraft {
    const primary = entry.items[0] || null;
    const secondary = entry.items[1] || null;

    const base: InspectorDraft = {
      sourceEntryId: entry.id,
      kind: entry.kind,
      ids: entry.items.map((item) => item.ID),
      pageId: entry.pageId,
      contentId: entry.contentId,
      listItemID: entry.listItemID,
      title: entry.title,
      subtitle: entry.subtitle,
      description: entry.summary,
      body: primary?.Text || '',
      imageUrl: entry.photo || secondary?.Photo || primary?.Photo || '',
      altText: String(primary?.Metadata?.['alt'] || secondary?.Metadata?.['alt'] || '').trim(),
      url: String(primary?.Metadata?.['url'] || '').trim(),
      secondaryUrl: '',
      company: '',
      location: '',
      startDate: '',
      endDate: '',
      achievementsText: '',
      tags: '',
      privateTags: '',
      techStack: '',
      date: '',
      label: '',
      value: null,
      level: '',
      status: String(primary?.Metadata?.['status'] || '').trim(),
      category: String(primary?.Metadata?.['category'] || '').trim(),
      publishDate: this.toDatetimeLocalValue(primary?.Metadata?.['publishDate']),
      readTimeMinutes: this.toPositiveNumber(primary?.Metadata?.['readTimeMinutes'])
    };

    switch (entry.kind) {
      case 'header-branding':
        return {
          ...base,
          title: String(entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.HeaderText))?.Text || '').trim(),
          imageUrl: String(entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.HeaderIcon))?.Photo || '').trim(),
          altText: String(entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.HeaderIcon))?.Metadata?.['alt'] || '').trim()
        };
      case 'footer-link':
        return {
          ...base,
          label: String(primary?.Text || '').trim(),
          url: String(primary?.Metadata?.['url'] || '').trim(),
          altText: String(primary?.Metadata?.['alt'] || '').trim()
        };
      case 'hero-slide':
        return {
          ...base,
          altText: String(primary?.Metadata?.['alt'] || '').trim()
        };
      case 'landing-copy':
      case 'work-copy':
        return {
          ...base,
          label: String(primary?.Metadata?.['type'] || '').trim(),
          body: String(primary?.Text || '').trim()
        };
      case 'timeline-entry': {
        const parsed = this.parseJsonObject(primary?.Text);
        return {
          ...base,
          title: String(parsed?.['title'] || '').trim(),
          company: String(parsed?.['company'] || '').trim(),
          location: String(parsed?.['location'] || '').trim(),
          startDate: String(parsed?.['startDate'] || '').trim(),
          endDate: String(parsed?.['endDate'] || '').trim(),
          body: this.stringifyList(parsed?.['description']),
          achievementsText: this.stringifyList(parsed?.['achievements'])
        };
      }
      case 'career-metric': {
        const parsed = this.parseJsonObject(primary?.Text);
        return {
          ...base,
          label: String(parsed?.['label'] || '').trim(),
          value: this.toPositiveNumber(parsed?.['value']),
          level: String(parsed?.['level'] || '').trim(),
          description: String(parsed?.['summary'] || '').trim()
        };
      }
      case 'project-category': {
        const categoryText = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsCategoryText));
        const categoryPhoto = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsCategoryPhoto));
        const parsed = this.parseJsonObject(categoryText?.Text);
        return {
          ...base,
          title: String(parsed?.['name'] || categoryText?.Text || entry.title).trim(),
          imageUrl: String(categoryPhoto?.Photo || '').trim(),
          altText: String(categoryPhoto?.Metadata?.['alt'] || '').trim()
        };
      }
      case 'project-card': {
        const textItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsText));
        const photoItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsPhoto));
        const parsed = this.parseJsonObject(textItem?.Text);
        return {
          ...base,
          title: String(parsed?.['title'] || entry.title).trim(),
          description: String(parsed?.['description'] || '').trim(),
          techStack: this.stringifyList(parsed?.['techStack'], ', '),
          url: String(parsed?.['githubUrl'] || '').trim(),
          secondaryUrl: String(parsed?.['liveUrl'] || '').trim(),
          date: String(parsed?.['date'] || '').trim(),
          imageUrl: String(photoItem?.Photo || '').trim(),
          altText: String(photoItem?.Metadata?.['alt'] || '').trim()
        };
      }
      case 'blog-post': {
        const metaItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.BlogItem)) || primary;
        const excerptItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.BlogText));
        const imageItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.BlogImage));
        const metadata = (metaItem?.Metadata || {}) as Record<string, any>;
        return {
          ...base,
          title: String(metadata['title'] || metaItem?.Text || entry.title).trim(),
          description: String(metadata['summary'] || '').trim(),
          body: String(excerptItem?.Text || '').trim(),
          tags: this.stringifyList(metadata['tags'], ', '),
          privateTags: this.stringifyList(metadata['privateSeoTags'], ', '),
          status: String(metadata['status'] || 'draft').trim(),
          category: String(metadata['category'] || '').trim(),
          publishDate: this.toDatetimeLocalValue(metadata['publishDate']),
          readTimeMinutes: this.toPositiveNumber(metadata['readTimeMinutes']),
          imageUrl: String(imageItem?.Photo || '').trim(),
          altText: String(imageItem?.Metadata?.['alt'] || '').trim()
        };
      }
      case 'collection-entry': {
        const metadata = (primary?.Metadata || {}) as Record<string, any>;
        return {
          ...base,
          title: String(metadata['title'] || entry.title).trim(),
          description: String(metadata['summary'] || '').trim(),
          body: String(primary?.Text || '').trim(),
          tags: this.stringifyList(metadata['tags'], ', '),
          category: String(metadata['categoryId'] || metadata['categoryName'] || '').trim(),
          status: String(metadata['visibility'] || 'hidden').trim(),
          label: String(metadata['entryType'] || '').trim()
        };
      }
      default:
        return base;
    }
  }

  private buildInspectorSaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    switch (entry.kind) {
      case 'header-branding':
        return this.buildHeaderSaveRequests(entry, draft);
      case 'footer-link':
        return this.buildFooterSaveRequests(entry, draft);
      case 'hero-slide':
        return this.buildHeroSaveRequests(entry, draft);
      case 'landing-copy':
      case 'work-copy':
        return this.buildCopySaveRequests(entry, draft);
      case 'timeline-entry':
        return this.buildTimelineSaveRequests(entry, draft);
      case 'career-metric':
        return this.buildMetricSaveRequests(entry, draft);
      case 'project-category':
        return this.buildProjectCategorySaveRequests(entry, draft);
      case 'project-card':
        return this.buildProjectCardSaveRequests(entry, draft);
      case 'blog-post':
        return this.buildBlogSaveRequests(entry, draft);
      case 'collection-entry':
        return this.buildCollectionSaveRequests(entry, draft);
      case 'signature-settings':
      case 'collections-registry':
      case 'generic':
      default:
        return [];
    }
  }

  private buildHeaderSaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    const textItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.HeaderText));
    const iconItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.HeaderIcon));
    const requests = [] as ReturnType<BlogApiService['updateContent']>[];

    if (textItem?.ID) {
      requests.push(this.blogApi.updateContent(textItem.ID, {
        Text: draft.title.trim(),
        Metadata: {
          ...(textItem.Metadata || {}),
          type: textItem.Metadata?.['type'] || 'site-title'
        }
      }));
    }

    if (iconItem?.ID) {
      requests.push(this.blogApi.updateContent(iconItem.ID, {
        Photo: draft.imageUrl.trim() || undefined,
        Metadata: {
          ...(iconItem.Metadata || {}),
          alt: draft.altText.trim() || 'Site icon'
        }
      }));
    }

    return requests;
  }

  private buildFooterSaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    const item = entry.items[0];
    if (!item?.ID) return [];
    return [this.blogApi.updateContent(item.ID, {
      Text: draft.label.trim() || draft.title.trim(),
      Photo: draft.imageUrl.trim() || undefined,
      Metadata: {
        ...(item.Metadata || {}),
        url: draft.url.trim(),
        alt: draft.altText.trim() || undefined,
        order: this.getOrderValue(item, entry.order)
      }
    })];
  }

  private buildHeroSaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    const item = entry.items[0];
    if (!item?.ID) return [];
    return [this.blogApi.updateContent(item.ID, {
      Photo: draft.imageUrl.trim() || undefined,
      Metadata: {
        ...(item.Metadata || {}),
        alt: draft.altText.trim() || `Hero slide ${entry.order}`,
        order: this.getOrderValue(item, entry.order)
      }
    })];
  }

  private buildCopySaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    const item = entry.items[0];
    if (!item?.ID) return [];
    const nextMetadata = {
      ...(item.Metadata || {}),
      type: draft.label.trim() || item.Metadata?.['type'] || undefined,
      order: this.getOrderValue(item, entry.order)
    } as Record<string, any>;

    return [this.blogApi.updateContent(item.ID, {
      Text: draft.body,
      Metadata: nextMetadata
    })];
  }

  private buildTimelineSaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    const item = entry.items[0];
    if (!item?.ID) return [];
    const payload = {
      title: draft.title.trim(),
      company: draft.company.trim(),
      location: draft.location.trim(),
      startDate: draft.startDate.trim(),
      endDate: draft.endDate.trim(),
      description: this.parseLines(draft.body),
      achievements: this.parseLines(draft.achievementsText)
    };
    return [this.blogApi.updateContent(item.ID, {
      Text: JSON.stringify(payload, null, 2),
      Metadata: {
        ...(item.Metadata || {}),
        type: 'experience',
        order: this.getOrderValue(item, entry.order)
      }
    })];
  }

  private buildMetricSaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    const item = entry.items[0];
    if (!item?.ID) return [];
    const payload = {
      label: draft.label.trim(),
      value: Math.max(0, Math.min(100, Number(draft.value || 0))),
      level: draft.level.trim(),
      summary: draft.description.trim()
    };
    return [this.blogApi.updateContent(item.ID, {
      Text: JSON.stringify(payload, null, 2),
      Metadata: {
        ...(item.Metadata || {}),
        type: 'career-metric',
        order: this.getOrderValue(item, entry.order)
      }
    })];
  }

  private buildProjectCategorySaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    const textItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsCategoryText));
    const photoItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsCategoryPhoto));
    const requests = [] as ReturnType<BlogApiService['updateContent']>[];

    if (textItem?.ID) {
      requests.push(this.blogApi.updateContent(textItem.ID, {
        Text: JSON.stringify({ name: draft.title.trim() }, null, 2),
        Metadata: {
          ...(textItem.Metadata || {}),
          order: this.getOrderValue(textItem, entry.order)
        }
      }));
    }

    if (photoItem?.ID) {
      requests.push(this.blogApi.updateContent(photoItem.ID, {
        Photo: draft.imageUrl.trim() || undefined,
        Metadata: {
          ...(photoItem.Metadata || {}),
          alt: draft.altText.trim() || undefined,
          order: this.getOrderValue(photoItem, entry.order)
        }
      }));
    }

    return requests;
  }

  private buildProjectCardSaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    const textItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsText));
    const photoItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.ProjectsPhoto));
    const requests = [] as ReturnType<BlogApiService['updateContent']>[];
    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      techStack: this.parseCommaList(draft.techStack),
      githubUrl: draft.url.trim() || undefined,
      liveUrl: draft.secondaryUrl.trim() || undefined,
      date: draft.date.trim() || undefined
    };

    if (textItem?.ID) {
      requests.push(this.blogApi.updateContent(textItem.ID, {
        Text: JSON.stringify(payload, null, 2),
        Metadata: {
          ...(textItem.Metadata || {}),
          order: this.getOrderValue(textItem, entry.order)
        }
      }));
    }

    if (photoItem?.ID) {
      requests.push(this.blogApi.updateContent(photoItem.ID, {
        Photo: draft.imageUrl.trim() || undefined,
        Metadata: {
          ...(photoItem.Metadata || {}),
          alt: draft.altText.trim() || undefined,
          order: this.getOrderValue(photoItem, entry.order)
        }
      }));
    }

    return requests;
  }

  private buildBlogSaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    const metaItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.BlogItem));
    const excerptItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.BlogText));
    const imageItem = entry.items.find((item) => Number(item.PageContentID) === Number(PageContentID.BlogImage));
    const requests = [] as ReturnType<BlogApiService['updateContent']>[];

    if (metaItem?.ID) {
      requests.push(this.blogApi.updateContent(metaItem.ID, {
        Text: draft.title.trim(),
        Metadata: {
          ...(metaItem.Metadata || {}),
          title: draft.title.trim(),
          summary: draft.description.trim(),
          tags: this.parseCommaList(draft.tags),
          privateSeoTags: this.parseCommaList(draft.privateTags),
          status: draft.status.trim() || 'draft',
          category: draft.category.trim() || 'General',
          publishDate: draft.publishDate ? new Date(draft.publishDate).toISOString() : metaItem.Metadata?.['publishDate'],
          ...(draft.readTimeMinutes ? { readTimeMinutes: Math.max(1, Math.round(Number(draft.readTimeMinutes))) } : {})
        }
      }));
    }

    if (excerptItem?.ID) {
      requests.push(this.blogApi.updateContent(excerptItem.ID, {
        Text: draft.body
      }));
    }

    if (imageItem?.ID) {
      requests.push(this.blogApi.updateContent(imageItem.ID, {
        Photo: draft.imageUrl.trim() || undefined,
        Metadata: {
          ...(imageItem.Metadata || {}),
          alt: draft.altText.trim() || undefined
        }
      }));
    }

    return requests;
  }

  private buildCollectionSaveRequests(entry: StudioEntry, draft: InspectorDraft) {
    const item = entry.items[0];
    if (!item?.ID) return [];
    return [this.blogApi.updateContent(item.ID, {
      Text: draft.body,
      Metadata: {
        ...(item.Metadata || {}),
        title: draft.title.trim(),
        summary: draft.description.trim() || undefined,
        tags: this.parseCommaList(draft.tags),
        categoryId: draft.category.trim() || item.Metadata?.['categoryId'],
        visibility: draft.status.trim() || item.Metadata?.['visibility'] || 'hidden',
        entryType: draft.label.trim() || item.Metadata?.['entryType'],
        updatedAt: new Date().toISOString()
      }
    })];
  }

  private parseJsonObject(value?: string | null): Record<string, any> | null {
    if (!value?.trim()) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private groupByListItem(items: RedisContent[]): Map<string, RedisContent[]> {
    const grouped = new Map<string, RedisContent[]>();
    for (const item of items || []) {
      const key = String(item?.ListItemID || item?.ID || '').trim();
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    }
    return grouped;
  }

  private extractProjectCategoryName(item: RedisContent | null): string {
    if (!item) return 'Projects Category';
    const parsed = this.parseJsonObject(item.Text);
    return String(parsed?.['name'] || item.Text || item.ListItemID || 'Projects Category').trim() || 'Projects Category';
  }

  private findFirst(items: RedisContent[], contentId: PageContentID): RedisContent | null {
    return items.find((item) => Number(item.PageContentID) === Number(contentId)) || null;
  }

  private compareByOrderThenId(a?: RedisContent | null, b?: RedisContent | null): number {
    return this.getOrderValue(a, Number.MAX_SAFE_INTEGER) - this.getOrderValue(b, Number.MAX_SAFE_INTEGER)
      || String(a?.ID || '').localeCompare(String(b?.ID || ''));
  }

  private compareByUpdatedThenId(a?: RedisContent | null, b?: RedisContent | null): number {
    const aUpdated = a?.UpdatedAt ? new Date(a.UpdatedAt as any).getTime() : 0;
    const bUpdated = b?.UpdatedAt ? new Date(b.UpdatedAt as any).getTime() : 0;
    return bUpdated - aUpdated || String(a?.ID || '').localeCompare(String(b?.ID || ''));
  }

  private compareByContentTypeThenId(a?: RedisContent | null, b?: RedisContent | null): number {
    return Number(a?.PageContentID || 0) - Number(b?.PageContentID || 0)
      || String(a?.ID || '').localeCompare(String(b?.ID || ''));
  }

  private getOrderValue(item?: RedisContent | null, fallback: number = Number.MAX_SAFE_INTEGER): number {
    const raw = Number(item?.Metadata?.['order']);
    if (Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    return fallback;
  }

  private decorateSectionPageLabel(pageId: number, shared: boolean = false): string {
    const label = this.getPageLabel(pageId);
    return shared ? `${label} · Shared` : label;
  }

  private prettifyToken(value: string): string {
    return String(value || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase())
      .trim() || 'Content';
  }

  private parseLines(value: string): string[] {
    return String(value || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private parseCommaList(value: string): string[] {
    return String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private stringifyList(value: unknown, separator: string = '\n'): string {
    if (!Array.isArray(value)) return '';
    return value.map((entry) => String(entry)).join(separator);
  }

  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  private toDatetimeLocalValue(value: unknown): string {
    if (!value) return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  private toPositiveNumber(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed);
  }
}
