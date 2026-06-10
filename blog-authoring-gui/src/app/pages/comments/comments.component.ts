import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { AuthService } from '../../services/auth.service';
import { BlogApiService, BlogCommentAdmin } from '../../services/blog-api.service';
import { HotkeysService } from '../../services/hotkeys.service';

@Component({
  selector: 'app-comments',
  standalone: false,
  templateUrl: './comments.component.html',
  styleUrl: './comments.component.scss'
})
export class CommentsComponent implements OnInit, OnDestroy {
  comments: BlogCommentAdmin[] = [];
  filteredComments: BlogCommentAdmin[] = [];
  isLoading = false;
  isSavingReply = false;
  isDeleting = false;
  includeDeleted = false;
  postFilter = '';
  searchQuery = '';
  replyDrafts: Record<string, string> = {};
  replyingToCommentId: string | null = null;
  private cleanupHotkeys: (() => void) | null = null;

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
    this.loadComments();
    this.registerHotkeys();
  }

  ngOnDestroy(): void {
    this.cleanupHotkeys?.();
    this.cleanupHotkeys = null;
  }

  loadComments(): void {
    this.isLoading = true;
    this.blogApi.getBlogCommentsAdmin(this.postFilter, this.includeDeleted).subscribe({
      next: (response) => {
        this.comments = Array.isArray(response?.comments) ? response.comments : [];
        this.applyFilter();
        this.isLoading = false;
      },
      error: (err) => {
        this.isLoading = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Load Failed',
          detail: err?.message || 'Unable to load comments.'
        });
      }
    });
  }

  applyFilter(): void {
    const query = String(this.searchQuery || '').trim().toLowerCase();
    if (!query) {
      this.filteredComments = [...this.comments];
      return;
    }

    this.filteredComments = this.comments.filter((comment) => {
      const blob = [
        comment.commentId,
        comment.postId,
        comment.parentId,
        comment.authorName,
        comment.authorRole,
        comment.status,
        comment.body
      ].join(' ').toLowerCase();
      return blob.includes(query);
    });
  }

  onSearchChanged(): void {
    this.applyFilter();
  }

  startReply(comment: BlogCommentAdmin): void {
    if (comment.deleted) return;
    this.replyingToCommentId = this.replyingToCommentId === comment.commentId ? null : comment.commentId;
  }

  cancelReply(): void {
    this.replyingToCommentId = null;
  }

  saveReply(comment: BlogCommentAdmin): void {
    const body = String(this.replyDrafts[comment.commentId] || '').trim();
    if (!body) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Reply Empty',
        detail: 'Write a reply before saving.'
      });
      return;
    }

    this.isSavingReply = true;
    this.blogApi.replyToBlogComment(comment.commentId, body).subscribe({
      next: () => {
        this.replyDrafts[comment.commentId] = '';
        this.replyingToCommentId = null;
        this.isSavingReply = false;
        this.loadComments();
        this.messageService.add({
          severity: 'success',
          summary: 'Reply Posted',
          detail: 'Author reply was added.'
        });
      },
      error: (err) => {
        this.isSavingReply = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Reply Failed',
          detail: err?.message || 'Could not post reply.'
        });
      }
    });
  }

  deleteComment(comment: BlogCommentAdmin): void {
    if (comment.deleted) return;
    this.confirmationService.confirm({
      header: 'Delete Comment',
      message: `Delete the comment from ${comment.authorName}?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.isDeleting = true;
        this.blogApi.deleteBlogCommentAdmin(comment.commentId).subscribe({
          next: () => {
            this.isDeleting = false;
            this.loadComments();
            this.messageService.add({
              severity: 'success',
              summary: 'Deleted',
              detail: 'Comment was removed from the public thread.'
            });
          },
          error: (err) => {
            this.isDeleting = false;
            this.messageService.add({
              severity: 'error',
              summary: 'Delete Failed',
              detail: err?.message || 'Could not delete comment.'
            });
          }
        });
      }
    });
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

  goToCollections(): void {
    this.router.navigate(['/collections']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  trackByComment(index: number, comment: BlogCommentAdmin): string {
    return comment.commentId || `${index}`;
  }

  private registerHotkeys(): void {
    this.cleanupHotkeys = this.hotkeys.register('comments', [
      {
        combo: 'mod+alt+r',
        description: 'Refresh comments',
        action: () => this.loadComments(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+f',
        description: 'Focus comment search',
        action: () => document.getElementById('comment-search')?.focus(),
        allowInInputs: true
      }
    ]);
  }
}
