import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BlogApiService } from '../../services/blog-api.service';
import { TransactionLogService } from '../../services/transaction-log.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { BlogPostMetadata } from '../../models/redis-content.model';

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
  tags: string[] = [];
  currentTag: string = '';
  statusOptions = [
    { label: 'Draft', value: 'draft' },
    { label: 'Scheduled', value: 'scheduled' },
    { label: 'Published', value: 'published' }
  ];
  editorModules = {
    toolbar: [
      ['bold', 'italic', 'underline', 'strike'],
      [{ header: [2, 3, false] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['blockquote', 'code-block'],
      ['link', 'image'],
      ['clean']
    ]
  };

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
      sendEmailUpdate: [true]
    });
  }

  ngOnInit(): void {
    if (this.initialData) {
      this.loadInitialData();
    }
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
      sendEmailUpdate: this.initialData.sendEmailUpdate ?? true
    });
    this.tags = this.initialData.tags || [];
    this.uploadedImage = this.initialData.image || null;
  }

  /**
   * Add tag
   */
  addTag(): void {
    if (this.currentTag.trim() && !this.tags.includes(this.currentTag.trim())) {
      this.tags.push(this.currentTag.trim());
      this.currentTag = '';
    }
  }

  /**
   * Remove tag
   */
  removeTag(tag: string): void {
    this.tags = this.tags.filter(t => t !== tag);
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

    const listItemID = isEdit && this.initialData?.listItemID
      ? this.initialData.listItemID
      : `blog-${Date.now()}`;

    const request$ = isEdit
      ? this.blogApi.updateBlogPost(
          listItemID,
          formValue.title,
          formValue.content,
          formValue.summary,
          this.tags,
          this.uploadedImage || undefined,
          formValue.publishDate,
          formValue.status,
          formValue.category
        )
      : this.blogApi.createBlogPost(
          formValue.title,
          formValue.content,
          formValue.summary,
          this.tags,
          this.uploadedImage || undefined,
          listItemID,
          formValue.publishDate,
          formValue.status,
          formValue.category
        );

    request$.subscribe({
      next: () => {
        const sendEmailUpdate = !!formValue.sendEmailUpdate;

        const onDone = () => {
          const action = isEdit ? 'UPDATED' : 'CREATED';
          this.txLog.log(action, `Blog post "${formValue.title}" — status: ${formValue.status}, notify: ${sendEmailUpdate}, tags: [${this.tags.join(', ')}]`);
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

  openPreview(mode: 'card' | 'full' = 'card'): void {
    this.previewMode = mode;
    this.showPreviewDialog = true;
  }

  setPreviewMode(mode: 'card' | 'full'): void {
    this.previewMode = mode;
  }

  closePreview(): void {
    this.showPreviewDialog = false;
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
    return this.tags || [];
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
}
