import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private auth: AuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.auth.getIdToken();
    if (!token) return next.handle(req);

    // Only attach auth to the Redis API server calls.
    if (!req.url.includes('/api/')) return next.handle(req);

    return next.handle(req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    }));
  }
}

