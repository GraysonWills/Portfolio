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
      category: ['']
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
      category: this.initialData.category || ''
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

    const request$ = isEdit && this.initialData?.listItemID
      ? this.blogApi.updateBlogPost(
          this.initialData.listItemID,
          formValue.title,
          formValue.content,
          formValue.summary,
          this.tags,
          this.uploadedImage || undefined
        )
      : this.blogApi.createBlogPost(
          formValue.title,
          formValue.content,
          formValue.summary,
          this.tags,
          this.uploadedImage || undefined
        );

    request$.subscribe({
      next: () => {
        const action = isEdit ? 'UPDATED' : 'CREATED';
        this.txLog.log(action, `Blog post "${formValue.title}" — status: ${formValue.status}, tags: [${this.tags.join(', ')}]`);
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: `Blog post ${isEdit ? 'updated' : 'saved'} successfully`
        });
        this.isSaving = false;
        this.saved.emit();
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
}
