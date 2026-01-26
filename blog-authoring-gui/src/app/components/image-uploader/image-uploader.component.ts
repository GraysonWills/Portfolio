import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { BlogApiService } from '../../services/blog-api.service';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-image-uploader',
  templateUrl: './image-uploader.component.html',
  styleUrl: './image-uploader.component.scss',
  standalone: false
})
export class ImageUploaderComponent implements OnInit {
  @Input() currentImage: string | null = null;
  @Output() imageUploaded = new EventEmitter<string>();

  isUploading: boolean = false;
  previewUrl: string | null = null;

  constructor(
    private blogApi: BlogApiService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    if (this.currentImage) {
      this.previewUrl = this.currentImage;
    }
  }

  /**
   * Handle file selection
   */
  onFileSelect(event: any): void {
    const file = event.files?.[0] || event.target?.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Please select an image file'
        });
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Image size must be less than 5MB'
        });
        return;
      }

      // Show preview
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.previewUrl = e.target.result;
      };
      reader.readAsDataURL(file);

      // Upload image
      this.uploadImage(file);
    }
  }

  /**
   * Upload image to server
   */
  private uploadImage(file: File): void {
    this.isUploading = true;
    this.blogApi.uploadImage(file).subscribe({
      next: (imageUrl) => {
        this.imageUploaded.emit(imageUrl);
        this.isUploading = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Image uploaded successfully'
        });
      },
      error: (error) => {
        this.isUploading = false;
        this.previewUrl = null;
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to upload image'
        });
      }
    });
  }

  /**
   * Remove image
   */
  removeImage(): void {
    this.previewUrl = null;
    this.currentImage = null;
    this.imageUploaded.emit('');
  }

  /**
   * Drag and drop handlers
   */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.onFileSelect({ files: files });
    }
  }
}
