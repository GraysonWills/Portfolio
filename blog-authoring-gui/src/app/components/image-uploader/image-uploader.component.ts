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
  private readonly supportedMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/svg+xml'
  ]);
  @Input() currentImage: string | null = null;
  @Input() maxWidth: number = 1200;   // Max width for resize
  @Input() maxHeight: number = 800;   // Max height for resize
  @Input() quality: number = 0.8;     // Compression quality (0-1)
  @Output() imageUploaded = new EventEmitter<string>();

  isUploading: boolean = false;
  isCompressing: boolean = false;
  previewUrl: string | null = null;
  originalSize: number = 0;
  compressedSize: number = 0;
  outputMimeType: string = 'image/webp';

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
      if (!this.isSupportedMimeType(file.type)) {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Supported formats: JPG, PNG, WEBP, GIF, SVG, and AVIF.'
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
    const mime = String(file.type || '').toLowerCase();
    if (mime === 'image/gif' || mime === 'image/svg+xml') {
      // Preserve original bytes for animated GIF/vector SVG content.
      this.previewFile(file);
      this.isCompressing = false;
      this.compressedSize = file.size;
      this.uploadImage(file);
      return;
    }

    this.isCompressing = true;
    this.outputMimeType = this.getPreferredOutputMimeType();

    this.compressImage(file, this.maxWidth, this.maxHeight, this.quality, this.outputMimeType)
      .then((compressedBlob: Blob) => {
        this.compressedSize = compressedBlob.size;
        const savings = Math.round((1 - compressedBlob.size / this.originalSize) * 100);

        if (savings > 0) {
          this.messageService.add({
            severity: 'info',
            summary: 'Compressed',
            detail: `Image compressed by ${savings}% (${this.formatBytes(this.originalSize)} -> ${this.formatBytes(this.compressedSize)}), format: ${this.getFormatLabel(this.outputMimeType)}`
          });
        }

        this.previewBlob(compressedBlob);

        this.isCompressing = false;

        // Upload the compressed image.
        const extension = this.getExtensionForMimeType(this.outputMimeType);
        const nextName = this.replaceFileExtension(file.name, extension);
        const compressedFile = new File(
          [compressedBlob],
          nextName,
          { type: this.outputMimeType }
        );
        this.uploadImage(compressedFile);
      })
      .catch((error) => {
        console.error('Compression failed, uploading original:', error);
        this.isCompressing = false;
        this.previewFile(file);
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
    quality: number,
    outputMimeType: string
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

        // Export as compressed modern image format.
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas toBlob returned null'));
            }
          },
          outputMimeType,
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

  private getPreferredOutputMimeType(): string {
    if (this.isMimeTypeSupported('image/avif')) return 'image/avif';
    if (this.isMimeTypeSupported('image/webp')) return 'image/webp';
    return 'image/jpeg';
  }

  private isMimeTypeSupported(mimeType: string): boolean {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    try {
      const dataUrl = canvas.toDataURL(mimeType);
      return typeof dataUrl === 'string' && dataUrl.startsWith(`data:${mimeType}`);
    } catch {
      return false;
    }
  }

  private getExtensionForMimeType(mimeType: string): string {
    switch ((mimeType || '').toLowerCase()) {
      case 'image/avif':
        return '.avif';
      case 'image/webp':
        return '.webp';
      default:
        return '.jpg';
    }
  }

  private getFormatLabel(mimeType: string): string {
    const ext = this.getExtensionForMimeType(mimeType).replace('.', '');
    return ext.toUpperCase();
  }

  private replaceFileExtension(filename: string, extension: string): string {
    const safeName = String(filename || 'image').trim() || 'image';
    if (!/\.[a-z0-9]+$/i.test(safeName)) return `${safeName}${extension}`;
    return safeName.replace(/\.[a-z0-9]+$/i, extension);
  }

  private previewBlob(blob: Blob): void {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.previewUrl = e.target.result;
    };
    reader.readAsDataURL(blob);
  }

  private previewFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.previewUrl = e.target.result;
    };
    reader.readAsDataURL(file);
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
          detail: this.getErrorMessage(error)
        });
      }
    });
  }

  private isSupportedMimeType(rawMimeType: string): boolean {
    const mimeType = String(rawMimeType || '').trim().toLowerCase();
    return this.supportedMimeTypes.has(mimeType);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    const message = String((error as any)?.error?.error || (error as any)?.error?.message || '').trim();
    return message || 'Failed to upload image';
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
