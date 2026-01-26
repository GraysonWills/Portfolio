import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BlogApiService } from '../../services/blog-api.service';
import { MessageService } from 'primeng/api';
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

  constructor(
    private fb: FormBuilder,
    private blogApi: BlogApiService,
    private messageService: MessageService
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
   * Save blog post
   */
  savePost(): void {
    if (this.blogForm.valid) {
      this.isSaving = true;
      const formValue = this.blogForm.value;

      this.blogApi.createBlogPost(
        formValue.title,
        formValue.content,
        formValue.summary,
        this.tags,
        this.uploadedImage || undefined
      ).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Blog post saved successfully'
          });
          this.isSaving = false;
          this.saved.emit();
        },
        error: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to save blog post'
          });
          this.isSaving = false;
        }
      });
    }
  }

  /**
   * Cancel editing
   */
  cancel(): void {
    this.cancelled.emit();
  }

  /**
   * Remove uploaded image
   */
  removeImage(): void {
    this.uploadedImage = null;
  }
}
