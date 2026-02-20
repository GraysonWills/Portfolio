import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MessageService, ConfirmationService } from 'primeng/api';
import { AuthService } from '../../services/auth.service';
import { ApiHealth, BlogApiService } from '../../services/blog-api.service';
import { TransactionLogService } from '../../services/transaction-log.service';
import { RedisContent, PageID, PageContentID } from '../../models/redis-content.model';
import { environment } from '../../../environments/environment';

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

@Component({
  selector: 'app-content-studio',
  templateUrl: './content-studio.component.html',
  styleUrl: './content-studio.component.scss',
  standalone: false
})
export class ContentStudioComponent implements OnInit {
  // Connection
  apiEndpoint: string = '';
  connectionStatus: 'connected' | 'disconnected' | 'testing' = 'disconnected';
  isConnecting: boolean = false;
  showSettings: boolean = false;
  apiHealth: ApiHealth | null = null;
  appOrigin: string = '';
  readonly isProd = environment.production;

  // Filters
  pageOptions: Option<number>[] = [
    { label: 'All Pages', value: -1 },
    { label: 'Landing (0)', value: PageID.Landing },
    { label: 'Work (1)', value: PageID.Work },
    { label: 'Projects (2)', value: PageID.Projects },
    { label: 'Blog (3)', value: PageID.Blog }
  ];
  pageOptionsEditable: Option<number>[] = [];
  contentOptions: Option<number>[] = [];
  contentOptionsEditable: Option<number>[] = [];
  selectedPageId: number = PageID.Landing;
  selectedContentId: number = -1;
  searchQuery: string = '';

  // Data
  isLoading: boolean = false;
  content: RedisContent[] = [];
  filteredContent: RedisContent[] = [];

  // Editor
  editorOpen: boolean = false;
  editorSaving: boolean = false;
  draft: RedisContentDraft | null = null;
  isPreviewOpening: boolean = false;

  private pageLabels = new Map<number, string>([
    [0, 'Landing'],
    [1, 'Work'],
    [2, 'Projects'],
    [3, 'Blog']
  ]);

  private contentLabels = new Map<number, string>([
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
    [14, 'WorkSkillMetric']
  ]);

  constructor(
    private authService: AuthService,
    private blogApi: BlogApiService,
    public txLog: TransactionLogService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private router: Router
  ) {}

  // Expose Router for template navigation (keeps header component-free for now)
  public get routerRef(): Router {
    return this.router;
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
    this.testConnection();
    this.loadContent();
  }

  // ── Navigation ────────────────────────────────────────────────

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  // ── Connection ────────────────────────────────────────────────

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

  // ── Content Loading / Filtering ────────────────────────────────

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
    this.applyFilters();
  }

  loadContent(): void {
    this.isLoading = true;

    const source$ = this.selectedPageId === -1
      ? this.blogApi.getAllContent()
      : this.blogApi.getContentByPage(this.selectedPageId);

    source$.subscribe({
      next: (items) => {
        this.content = Array.isArray(items) ? items : [];
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
    const query = this.searchQuery.trim().toLowerCase();

    let items = [...this.content];

    if (this.selectedContentId !== -1) {
      items = items.filter((item) => Number(item.PageContentID) === Number(this.selectedContentId));
    }

    if (query) {
      items = items.filter((item) => {
        const id = (item.ID || '').toLowerCase();
        const listItem = (item.ListItemID || '').toLowerCase();
        const text = (item.Text || '').toLowerCase();
        const photo = (item.Photo || '').toLowerCase();
        const meta = item.Metadata ? JSON.stringify(item.Metadata).toLowerCase() : '';
        return id.includes(query) || listItem.includes(query) || text.includes(query) || photo.includes(query) || meta.includes(query);
      });
    }

    items.sort((a, b) => {
      const aUpdated = (a.UpdatedAt ? new Date(a.UpdatedAt as any).getTime() : 0);
      const bUpdated = (b.UpdatedAt ? new Date(b.UpdatedAt as any).getTime() : 0);
      return bUpdated - aUpdated;
    });

    this.filteredContent = items;
  }

  // ── Labels / Display ──────────────────────────────────────────

  getPageLabel(pageId: number): string {
    return this.pageLabels.get(Number(pageId)) || `Page ${pageId}`;
  }

  getContentLabel(contentId: number): string {
    return this.contentLabels.get(Number(contentId)) || `Content ${contentId}`;
  }

  getTextPreview(text?: string): string {
    if (!text) return '';
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > 140 ? `${oneLine.slice(0, 140)}…` : oneLine;
  }

  // ── Editor Dialog ─────────────────────────────────────────────

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

    // Metadata JSON
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
    const pageForRoute = draftItem?.PageID ?? (this.selectedPageId === -1 ? PageID.Landing : this.selectedPageId);
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
    if (!this.draft) return null;

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
}
