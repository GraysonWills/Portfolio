import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BlogApiService } from '../../services/blog-api.service';
import { TransactionLogService } from '../../services/transaction-log.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import {
  BlogPostMetadata,
  BlogSignature,
  BlogSignatureSettings,
  PageContentID,
  PageID,
  RedisContent
} from '../../models/redis-content.model';

@Component({
  selector: 'app-blog-editor',
  templateUrl: './blog-editor.component.html',
  styleUrl: './blog-editor.component.scss',
  standalone: false
})
export class BlogEditorComponent implements OnInit {
  @Input() initialData?: any;
  @Output() saved = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  blogForm: FormGroup;
  isSaving: boolean = false;
  showPreviewDialog: boolean = false;
  previewMode: 'card' | 'full' = 'card';
  uploadedImage: string | null = null;
  publicTags: string[] = [];
  privateSeoTags: string[] = [];
  currentPublicTag: string = '';
  currentPrivateSeoTag: string = '';
  signatureSettings: BlogSignatureSettings;
  draftSignatureLabel: string = '';
  draftSignatureQuote: string = '';
  draftSignatureAuthor: string = '';
  draftSignatureName: string = 'Grayson Wills';
  savingSignatureSettings = false;
  statusOptions = [
    { label: 'Draft', value: 'draft' },
    { label: 'Scheduled', value: 'scheduled' },
    { label: 'Published', value: 'published' }
  ];
  editorFormats = [
    'header',
    'bold',
    'italic',
    'underline',
    'strike',
    'blockquote',
    'code-block',
    'list',
    'bullet',
    'indent',
    'link',
    'image',
    'color',
    'background',
    'align'
  ];
  editorModules = {
    toolbar: [
      [{ header: [1, 2, 3, 4, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ indent: '-1' }, { indent: '+1' }],
      [{ align: [] }],
      ['blockquote', 'code-block'],
      ['link', 'image'],
      ['clean']
    ],
    clipboard: {
      matchVisual: false
    }
  };
  private quillEditor: any = null;
  private previewListItemID: string = '';

  constructor(
    private fb: FormBuilder,
    private blogApi: BlogApiService,
    private txLog: TransactionLogService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {
    this.blogForm = this.fb.group({
      title: ['', [Validators.required]],
      summary: ['', [Validators.required]],
      content: ['', [Validators.required]],
      publishDate: [new Date()],
      status: ['published', [Validators.required]],
      category: [''],
      signatureId: [''],
      sendEmailUpdate: [true]
    });
    this.signatureSettings = this.blogApi.getDefaultSignatureSettings();
  }

  ngOnInit(): void {
    if (this.initialData) {
      this.loadInitialData();
    }
    this.previewListItemID = this.initialData?.listItemID || `blog-preview-${Date.now()}`;
    this.loadSignatureSettings();
  }

  /**
   * Load initial data for editing
   */
  private loadInitialData(): void {
    this.blogForm.patchValue({
      title: this.initialData.title || '',
      summary: this.initialData.summary || '',
      content: this.initialData.content || '',
      publishDate: this.initialData.publishDate || new Date(),
      status: this.initialData.status || 'published',
      category: this.initialData.category || '',
      signatureId: this.initialData.signatureId || this.initialData.signatureSnapshot?.id || '',
      sendEmailUpdate: this.initialData.sendEmailUpdate ?? true
    });
    this.publicTags = this.normalizeTagList(this.initialData.tags || []);
    this.privateSeoTags = this.normalizeTagList(this.initialData.privateSeoTags || []);
    this.uploadedImage = this.initialData.image || null;
    this.draftSignatureName = this.initialData.signatureSnapshot?.signOffName || 'Grayson Wills';
  }

  onPublicTagInputChange(value: string): void {
    this.currentPublicTag = String(value || '');
    this.commitTagInput('public', false);
  }

  onPrivateSeoTagInputChange(value: string): void {
    this.currentPrivateSeoTag = String(value || '');
    this.commitTagInput('private', false);
  }

  addPublicTags(event?: Event): void {
    event?.preventDefault();
    this.commitTagInput('public', true);
  }

  addPrivateSeoTags(event?: Event): void {
    event?.preventDefault();
    this.commitTagInput('private', true);
  }

  removePublicTag(tag: string): void {
    this.publicTags = this.publicTags.filter((t) => t !== tag);
  }

  removePrivateSeoTag(tag: string): void {
    this.privateSeoTags = this.privateSeoTags.filter((t) => t !== tag);
  }

  private flushPendingTagInputs(): void {
    this.commitTagInput('public', true);
    this.commitTagInput('private', true);
  }

  private commitTagInput(kind: 'public' | 'private', flushRemainder: boolean): void {
    const current = kind === 'public' ? this.currentPublicTag : this.currentPrivateSeoTag;
    const parsed = this.parseTagInput(current, flushRemainder);
    const merged = this.normalizeTagList([
      ...(kind === 'public' ? this.publicTags : this.privateSeoTags),
      ...parsed.tags
    ]);

    if (kind === 'public') {
      this.publicTags = merged;
      this.currentPublicTag = parsed.remainder;
    } else {
      this.privateSeoTags = merged;
      this.currentPrivateSeoTag = parsed.remainder;
    }
  }

  private parseTagInput(raw: string, flushRemainder: boolean): { tags: string[]; remainder: string } {
    const text = String(raw || '').replace(/\n/g, ',');
    if (!text.includes(',') && !flushRemainder) {
      return { tags: [], remainder: text };
    }

    const pieces = text.split(',');
    if (flushRemainder) {
      return {
        tags: this.normalizeTagList(pieces),
        remainder: ''
      };
    }

    const remainder = pieces.pop() ?? '';
    return {
      tags: this.normalizeTagList(pieces),
      remainder: remainder.trimStart()
    };
  }

  private normalizeTagList(tags: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const raw of tags || []) {
      const clean = String(raw || '').trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(clean);
    }
    return normalized;
  }

  getSignatureOptions(): Array<{ label: string; value: string }> {
    const options = (this.signatureSettings.signatures || []).map((sig) => ({
      label: `${sig.label}${this.signatureSettings.defaultSignatureId === sig.id ? ' (Default)' : ''}`,
      value: sig.id
    }));
    return [{ label: 'Use default signature', value: '' }, ...options];
  }

  getDefaultSignature(): BlogSignature | null {
    const signatures = this.signatureSettings.signatures || [];
    if (!signatures.length) return null;
    const preferred = this.signatureSettings.defaultSignatureId
      ? signatures.find((sig) => sig.id === this.signatureSettings.defaultSignatureId)
      : null;
    return preferred || signatures[0];
  }

  getSelectedSignature(): BlogSignature | null {
    const signatures = this.signatureSettings.signatures || [];
    if (!signatures.length) return null;

    const selectedId = String(this.blogForm.get('signatureId')?.value || '').trim();
    if (selectedId) {
      const selected = signatures.find((sig) => sig.id === selectedId);
      if (selected) return selected;
    }

    return this.getDefaultSignature();
  }

  addSignaturePreset(): void {
    const quote = this.draftSignatureQuote.trim();
    const quoteAuthor = this.draftSignatureAuthor.trim();
    const signOffName = this.draftSignatureName.trim() || 'Grayson Wills';

    if (!quote || !quoteAuthor) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Missing Signature Fields',
        detail: 'Quote and quote author are required.'
      });
      return;
    }

    const label = this.draftSignatureLabel.trim()
      || `Quote by ${quoteAuthor}`;

    const signature: BlogSignature = {
      id: `sig-${Date.now().toString(36)}`,
      label,
      quote,
      quoteAuthor,
      signOffName
    };

    const nextSettings: BlogSignatureSettings = {
      signatures: [...(this.signatureSettings.signatures || []), signature],
      defaultSignatureId: this.signatureSettings.defaultSignatureId || signature.id
    };

    this.persistSignatureSettings(nextSettings, 'Signature added.');
    this.blogForm.patchValue({
      signatureId: signature.id
    });
    this.draftSignatureLabel = '';
    this.draftSignatureQuote = '';
    this.draftSignatureAuthor = '';
  }

  removeSignaturePreset(signatureId: string): void {
    const signatures = (this.signatureSettings.signatures || []).filter((sig) => sig.id !== signatureId);
    if (!signatures.length) {
      this.messageService.add({
        severity: 'warn',
        summary: 'At Least One Signature Required',
        detail: 'Add another signature before deleting this one.'
      });
      return;
    }

    const nextDefault = this.signatureSettings.defaultSignatureId === signatureId
      ? signatures[0].id
      : this.signatureSettings.defaultSignatureId;

    const selectedId = String(this.blogForm.get('signatureId')?.value || '').trim();
    if (selectedId === signatureId) {
      this.blogForm.patchValue({ signatureId: '' });
    }

    this.persistSignatureSettings({
      signatures,
      defaultSignatureId: nextDefault
    }, 'Signature removed.');
  }

  setDefaultSignature(signatureId: string): void {
    if (!signatureId) return;
    this.persistSignatureSettings({
      signatures: [...(this.signatureSettings.signatures || [])],
      defaultSignatureId: signatureId
    }, 'Default signature updated.');
  }

  isDefaultSignature(signatureId: string): boolean {
    return this.signatureSettings.defaultSignatureId === signatureId;
  }

  getPreviewSignature(): BlogSignature | null {
    return this.getSelectedSignature();
  }

  /**
   * Handle image upload
   */
  onImageSelected(event: any): void {
    const file = event.files?.[0] || event.target?.files?.[0];
    if (file) {
      this.blogApi.uploadImage(file).subscribe({
        next: (imageUrl) => {
          this.uploadedImage = imageUrl;
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Image uploaded successfully'
          });
        },
        error: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to upload image'
          });
        }
      });
    }
  }

  /**
   * Save blog post — with confirmation dialog
   */
  savePost(): void {
    if (!this.blogForm.valid) return;

    const formValue = this.blogForm.value;
    const statusLabel = formValue.status === 'published' ? 'publish' : `save as ${formValue.status}`;
    const isEdit = !!this.initialData;

    this.confirmationService.confirm({
      message: `Are you sure you want to ${isEdit ? 'update' : statusLabel} "${formValue.title}"?`,
      header: isEdit ? 'Confirm Update' : 'Confirm Publish',
      icon: isEdit ? 'pi pi-pencil' : 'pi pi-upload',
      acceptLabel: isEdit ? 'Update' : 'Publish',
      rejectLabel: 'Cancel',
      accept: () => {
        this.executeSave(formValue, isEdit);
      }
    });
  }

  /**
   * Execute the save operation after confirmation
   */
  private executeSave(formValue: any, isEdit: boolean): void {
    this.isSaving = true;
    this.flushPendingTagInputs();

    const publicTags = [...this.publicTags];
    const privateSeoTags = [...this.privateSeoTags];
    const selectedSignature = this.getSelectedSignature() || undefined;
    const selectedSignatureId = selectedSignature?.id || '';

    const listItemID = isEdit && this.initialData?.listItemID
      ? this.initialData.listItemID
      : `blog-${Date.now()}`;

    const request$ = isEdit
      ? this.blogApi.updateBlogPost(
          listItemID,
          formValue.title,
          formValue.content,
          formValue.summary,
          publicTags,
          privateSeoTags,
          this.uploadedImage || undefined,
          formValue.publishDate,
          formValue.status,
          formValue.category,
          selectedSignatureId,
          selectedSignature
        )
      : this.blogApi.createBlogPost(
          formValue.title,
          formValue.content,
          formValue.summary,
          publicTags,
          privateSeoTags,
          this.uploadedImage || undefined,
          listItemID,
          formValue.publishDate,
          formValue.status,
          formValue.category,
          selectedSignatureId,
          selectedSignature
        );

    request$.subscribe({
      next: () => {
        const sendEmailUpdate = !!formValue.sendEmailUpdate;

        const onDone = () => {
          const action = isEdit ? 'UPDATED' : 'CREATED';
          this.txLog.log(
            action,
            `Blog post "${formValue.title}" — status: ${formValue.status}, notify: ${sendEmailUpdate}, public tags: [${publicTags.join(', ')}], private SEO tags: [${privateSeoTags.join(', ')}]`
          );
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `Blog post ${isEdit ? 'updated' : 'saved'} successfully`
          });
          this.isSaving = false;
          this.saved.emit();
        };

        // Schedule or notify depending on status
        if (formValue.status === 'scheduled') {
          this.blogApi.schedulePublish(listItemID, formValue.publishDate, sendEmailUpdate, 'blog_posts').subscribe({
            next: () => onDone(),
            error: (err) => {
              const reason = err?.error?.error || err?.message || 'Unknown error';
              this.txLog.log('SCHEDULE_FAILED', `Failed to schedule "${formValue.title}" — ${reason}`);
              this.messageService.add({ severity: 'warn', summary: 'Saved', detail: `Post saved, but scheduling failed: ${reason}` });
              this.isSaving = false;
              this.saved.emit();
            }
          });
          return;
        }

        if (formValue.status === 'published' && sendEmailUpdate) {
          this.blogApi.sendNotificationNow(listItemID, 'blog_posts').subscribe({
            next: () => onDone(),
            error: (err) => {
              this.txLog.log('NOTIFY_FAILED', `Failed to send notification for "${formValue.title}" — ${err.message}`);
              this.messageService.add({ severity: 'warn', summary: 'Published', detail: 'Post published, but email notify failed.' });
              this.isSaving = false;
              this.saved.emit();
            }
          });
          return;
        }

        onDone();
      },
      error: (error) => {
        this.txLog.log('SAVE_FAILED', `Failed to save "${formValue.title}" — ${error.message}`);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: `Failed to ${isEdit ? 'update' : 'save'} blog post`
        });
        this.isSaving = false;
      }
    });
  }

  /**
   * Cancel editing
   */
  cancel(): void {
    // If form is dirty, confirm cancel
    if (this.blogForm.dirty) {
      this.confirmationService.confirm({
        message: 'You have unsaved changes. Are you sure you want to discard them?',
        header: 'Discard Changes',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Discard',
        rejectLabel: 'Keep Editing',
        acceptButtonStyleClass: 'p-button-danger',
        accept: () => {
          this.cancelled.emit();
        }
      });
    } else {
      this.cancelled.emit();
    }
  }

  /**
   * Remove uploaded image
   */
  removeImage(): void {
    this.uploadedImage = null;
  }

  onEditorInit(event: any): void {
    this.quillEditor = event?.editor || null;
  }

  insertFeaturedImageIntoContent(): void {
    const imageUrl = (this.uploadedImage || '').trim();
    if (!imageUrl) {
      this.messageService.add({
        severity: 'warn',
        summary: 'No Image Selected',
        detail: 'Upload/select a featured image first.'
      });
      return;
    }
    if (!this.quillEditor) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Editor Not Ready',
        detail: 'Please click into the editor and try again.'
      });
      return;
    }

    const selection = this.quillEditor.getSelection(true);
    const index = selection?.index ?? this.quillEditor.getLength();
    this.quillEditor.insertEmbed(index, 'image', imageUrl, 'user');
    this.quillEditor.setSelection(index + 1, 0, 'silent');
    this.blogForm.patchValue({ content: this.quillEditor.root.innerHTML });
    this.blogForm.get('content')?.markAsDirty();

    this.messageService.add({
      severity: 'success',
      summary: 'Image Inserted',
      detail: 'Featured image inserted into post content.'
    });
  }

  private loadSignatureSettings(): void {
    this.blogApi.getSignatureSettings().subscribe({
      next: (settings) => {
        this.signatureSettings = settings;

        const existingSelection = String(this.blogForm.get('signatureId')?.value || '').trim();
        const initialSelection = String(this.initialData?.signatureId || this.initialData?.signatureSnapshot?.id || '').trim();
        const defaultSelection = settings.defaultSignatureId || settings.signatures?.[0]?.id || '';
        const nextSelection = existingSelection || initialSelection || defaultSelection;

        this.blogForm.patchValue({ signatureId: nextSelection || '' }, { emitEvent: false });
      },
      error: () => {
        this.signatureSettings = this.blogApi.getDefaultSignatureSettings();
        const fallbackSelection = this.signatureSettings.defaultSignatureId || this.signatureSettings.signatures?.[0]?.id || '';
        this.blogForm.patchValue({ signatureId: fallbackSelection }, { emitEvent: false });
      }
    });
  }

  private persistSignatureSettings(settings: BlogSignatureSettings, successDetail: string): void {
    this.savingSignatureSettings = true;
    this.blogApi.saveSignatureSettings(settings).subscribe({
      next: (saved) => {
        this.signatureSettings = saved;
        this.savingSignatureSettings = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Signature Library Updated',
          detail: successDetail
        });
      },
      error: () => {
        this.savingSignatureSettings = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Signature Save Failed',
          detail: 'Could not save signature settings.'
        });
      }
    });
  }

  openPreview(mode: 'card' | 'full' = 'card'): void {
    this.flushPendingTagInputs();
    this.previewMode = mode;
    this.showPreviewDialog = true;
  }

  setPreviewMode(mode: 'card' | 'full'): void {
    this.previewMode = mode;
  }

  closePreview(): void {
    this.showPreviewDialog = false;
  }

  openPortfolioPreview(target: 'list' | 'post' = 'post'): void {
    this.flushPendingTagInputs();
    const payload = this.buildPortfolioPreviewPayload();
    const previewPath = target === 'list'
      ? '/blog'
      : `/blog/${encodeURIComponent(payload.listItemID)}`;

    this.blogApi.createPreviewSession({
      upserts: payload.upserts,
      deleteIds: payload.deleteIds,
      forceVisibleListItemIds: [payload.listItemID],
      source: 'blog-editor'
    }).subscribe({
      next: (session) => {
        const url = this.blogApi.buildPortfolioPreviewUrl(session.token, previewPath);
        window.open(url, '_blank', 'noopener,noreferrer');
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Preview Failed',
          detail: 'Could not create a cloud preview session.'
        });
      }
    });
  }

  getPreviewTitle(): string {
    const title = String(this.blogForm.get('title')?.value || '').trim();
    return title || 'Untitled Draft';
  }

  getPreviewSummary(): string {
    const summary = String(this.blogForm.get('summary')?.value || '').trim();
    if (summary) return summary;
    const text = this.getPreviewPlainText();
    if (!text) return 'Add a summary to preview your blog card description.';
    return text.slice(0, 180);
  }

  getPreviewPublishDate(): Date {
    const raw = this.blogForm.get('publishDate')?.value;
    return raw ? new Date(raw) : new Date();
  }

  getPreviewStatus(): string {
    return String(this.blogForm.get('status')?.value || 'draft');
  }

  getPreviewImage(): string | null {
    if (!this.uploadedImage) return null;
    const img = String(this.uploadedImage).trim();
    return img || null;
  }

  getPreviewTags(): string[] {
    return this.publicTags || [];
  }

  getPreviewPrivateSeoTags(): string[] {
    return this.privateSeoTags || [];
  }

  getPreviewReadTimeMinutes(): number {
    const text = this.getPreviewPlainText();
    if (!text) return 1;
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }

  getPreviewContentHtml(): string {
    const raw = String(this.blogForm.get('content')?.value || '').trim();
    if (!raw) {
      return '<p>Add content to preview the full post body.</p>';
    }
    // Editor content is HTML (Quill). If plain text is entered, render it safely in paragraphs.
    if (raw.includes('<')) return raw;
    return raw
      .split(/\n+/)
      .map((line) => `<p>${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
      .join('');
  }

  private getPreviewPlainText(): string {
    const contentHtml = String(this.blogForm.get('content')?.value || '');
    const contentText = contentHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const summary = String(this.blogForm.get('summary')?.value || '').trim();
    return `${summary} ${contentText}`.trim();
  }

  private buildPortfolioPreviewPayload(): {
    listItemID: string;
    upserts: Partial<RedisContent>[];
    deleteIds: string[];
  } {
    const listItemID = (this.initialData?.listItemID || this.previewListItemID || `blog-preview-${Date.now()}`).trim();
    this.previewListItemID = listItemID;

    const formValue = this.blogForm.value;
    const publishDate = formValue.publishDate ? new Date(formValue.publishDate) : new Date();
    const safePublishDate = Number.isNaN(publishDate.getTime()) ? new Date() : publishDate;
    const nowIso = new Date().toISOString();
    const selectedSignature = this.getSelectedSignature();

    const metadata: BlogPostMetadata & Record<string, any> = {
      title: this.getPreviewTitle(),
      summary: this.getPreviewSummary(),
      tags: this.getPreviewTags(),
      privateSeoTags: this.getPreviewPrivateSeoTags(),
      publishDate: safePublishDate,
      status: (formValue.status || 'draft'),
      ...(formValue.category ? { category: String(formValue.category).trim() } : {}),
      previewBypassVisibility: true
    };
    if (selectedSignature) {
      metadata.signatureId = selectedSignature.id;
      metadata.signatureSnapshot = selectedSignature;
    }

    const blogItemId = this.initialData?.blogItemId || `blog-item-${listItemID}`;
    const blogTextId = this.initialData?.blogTextId || `blog-text-${listItemID}`;
    const blogBodyId = this.initialData?.blogBodyId || `blog-body-${listItemID}`;
    const blogImageId = this.initialData?.blogImageId || `blog-image-${listItemID}`;
    const contentValue = String(this.blogForm.get('content')?.value || '');

    const upserts: Partial<RedisContent>[] = [
      {
        ID: blogItemId,
        PageID: PageID.Blog,
        PageContentID: PageContentID.BlogItem,
        ListItemID: listItemID,
        Text: this.getPreviewTitle(),
        Metadata: metadata,
        UpdatedAt: nowIso as any
      },
      {
        ID: blogTextId,
        PageID: PageID.Blog,
        PageContentID: PageContentID.BlogText,
        ListItemID: listItemID,
        Text: contentValue,
        Metadata: metadata,
        UpdatedAt: nowIso as any
      },
      {
        ID: blogBodyId,
        PageID: PageID.Blog,
        PageContentID: PageContentID.BlogBody,
        ListItemID: listItemID,
        Text: JSON.stringify([
          { type: 'paragraph', content: contentValue || this.getPreviewSummary() }
        ]),
        Metadata: { previewBypassVisibility: true },
        UpdatedAt: nowIso as any
      }
    ];

    const deleteIds: string[] = [];
    if (this.getPreviewImage()) {
      upserts.push({
        ID: blogImageId,
        PageID: PageID.Blog,
        PageContentID: PageContentID.BlogImage,
        ListItemID: listItemID,
        Photo: this.getPreviewImage() || undefined,
        Metadata: { alt: `${this.getPreviewTitle()} cover image`, previewBypassVisibility: true },
        UpdatedAt: nowIso as any
      });
    } else if (this.initialData?.blogImageId) {
      deleteIds.push(this.initialData.blogImageId);
    }

    return { listItemID, upserts, deleteIds };
  }
}
