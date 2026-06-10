import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { SiteAuthService } from './site-auth.service';

export type BlogComment = {
  commentId: string;
  postId: string;
  parentId: string | null;
  body: string;
  authorName: string;
  authorRole: 'reader' | 'author';
  status: 'visible' | 'deleted';
  deleted: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  likeCount: number;
  replyCount: number;
  likedByViewer: boolean;
  viewerCanDelete: boolean;
  replies: BlogComment[];
};

export type BlogCommentsResponse = {
  postId: string;
  count: number;
  comments: BlogComment[];
};

@Injectable({
  providedIn: 'root'
})
export class CommentService {
  private readonly apiUrl = environment.redisApiUrl || '';
  private readonly jsonHeaders = new HttpHeaders({ 'Content-Type': 'application/json' });

  constructor(
    private readonly http: HttpClient,
    private readonly siteAuth: SiteAuthService
  ) {}

  getComments(postId: string): Observable<BlogCommentsResponse> {
    return from(this.authHeaders(false)).pipe(
      switchMap((headers) => this.http.get<BlogCommentsResponse>(
        `${this.apiUrl}/comments/post/${encodeURIComponent(postId)}`,
        { headers }
      )),
      map((response) => ({
        ...response,
        comments: Array.isArray(response?.comments) ? response.comments : []
      })),
      catchError(this.handleError)
    );
  }

  createComment(postId: string, body: string, parentId?: string | null): Observable<BlogComment> {
    return from(this.authHeaders(true)).pipe(
      switchMap((headers) => this.http.post<{ comment: BlogComment }>(
        `${this.apiUrl}/comments/post/${encodeURIComponent(postId)}`,
        { body, parentId: parentId || null },
        { headers }
      )),
      map((response) => response.comment),
      catchError(this.handleError)
    );
  }

  setLike(commentId: string, liked: boolean): Observable<BlogComment> {
    return from(this.authHeaders(true)).pipe(
      switchMap((headers) => this.http.post<{ comment: BlogComment }>(
        `${this.apiUrl}/comments/${encodeURIComponent(commentId)}/like`,
        { liked },
        { headers }
      )),
      map((response) => response.comment),
      catchError(this.handleError)
    );
  }

  deleteComment(commentId: string): Observable<BlogComment> {
    return from(this.authHeaders(true)).pipe(
      switchMap((headers) => this.http.delete<{ comment: BlogComment }>(
        `${this.apiUrl}/comments/${encodeURIComponent(commentId)}`,
        { headers }
      )),
      map((response) => response.comment),
      catchError(this.handleError)
    );
  }

  private async authHeaders(required: boolean): Promise<HttpHeaders> {
    const token = await this.siteAuth.getValidIdToken();
    if (!token && required) {
      throw new Error('Sign in to continue.');
    }
    return token
      ? this.jsonHeaders.set('Authorization', `Bearer ${token}`)
      : this.jsonHeaders;
  }

  private handleError(error: any): Observable<never> {
    const message = error?.error?.error || error?.message || 'Comment request failed';
    return throwError(() => new Error(message));
  }
}
