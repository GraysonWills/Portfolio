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
  @Input() maxWidth: number = 1200;   // Max width for resize
  @Input() maxHeight: number = 800;   // Max height for resize
  @Input() quality: number = 0.8;     // JPEG compression quality (0-1)
  @Output() imageUploaded = new EventEmitter<string>();

  isUploading: boolean = false;
  isCompressing: boolean = false;
  previewUrl: string | null = null;
  originalSize: number = 0;
  compressedSize: number = 0;

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

      // Validate file size (max 10MB raw — will be compressed)
      if (file.size > 10 * 1024 * 1024) {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Image size must be less than 10MB'
        });
        return;
      }

      this.originalSize = file.size;
      this.compressAndUpload(file);
    }
  }

  /**
   * Compress, resize, then upload
   */
  private compressAndUpload(file: File): void {
    this.isCompressing = true;

    this.compressImage(file, this.maxWidth, this.maxHeight, this.quality)
      .then((compressedBlob) => {
        this.compressedSize = compressedBlob.size;
        const savings = Math.round((1 - compressedBlob.size / this.originalSize) * 100);

        if (savings > 0) {
          this.messageService.add({
            severity: 'info',
            summary: 'Compressed',
            detail: `Image compressed by ${savings}% (${this.formatBytes(this.originalSize)} → ${this.formatBytes(this.compressedSize)})`
          });
        }

        // Show preview from compressed blob
        const reader = new FileReader();
        reader.onload = (e: any) => {
          this.previewUrl = e.target.result;
        };
        reader.readAsDataURL(compressedBlob);

        this.isCompressing = false;

        // Upload the compressed image
        const compressedFile = new File(
          [compressedBlob],
          file.name.replace(/\.[^.]+$/, '.jpg'),
          { type: 'image/jpeg' }
        );
        this.uploadImage(compressedFile);
      })
      .catch((error) => {
        console.error('Compression failed, uploading original:', error);
        this.isCompressing = false;
        // Fallback: show preview and upload original
        const reader = new FileReader();
        reader.onload = (e: any) => {
          this.previewUrl = e.target.result;
        };
        reader.readAsDataURL(file);
        this.uploadImage(file);
      });
  }

  /**
   * Compress and resize an image using Canvas API.
   * Returns a Blob of the compressed JPEG.
   */
  private compressImage(
    file: File,
    maxWidth: number,
    maxHeight: number,
    quality: number
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);

        // Calculate new dimensions maintaining aspect ratio
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Draw to canvas at new size
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        // Export as compressed JPEG
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas toBlob returned null'));
            }
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
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
    this.originalSize = 0;
    this.compressedSize = 0;
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

  /**
   * Format bytes for display
   */
  formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
}
