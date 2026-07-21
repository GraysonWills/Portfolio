import { Inject, Injectable, InjectionToken, Optional } from '@angular/core';
import { HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';

export const SSR_API_ORIGIN = new InjectionToken<string>('SSR_API_ORIGIN');
export const SSR_EDGE_SECRET = new InjectionToken<string>('SSR_EDGE_SECRET');

@Injectable()
export class SsrApiOriginInterceptor implements HttpInterceptor {
  constructor(
    @Optional() @Inject(SSR_API_ORIGIN) private readonly origin: string | null,
    @Optional() @Inject(SSR_EDGE_SECRET) private readonly edgeSecret: string | null
  ) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler) {
    const origin = String(this.origin || '').replace(/\/+$/, '');
    if (!origin || !request.url.startsWith('/api/')) return next.handle(request);
    const headers: Record<string, string> = {};
    const edgeSecret = String(this.edgeSecret || '').trim();
    if (edgeSecret) headers['x-portfolio-edge-secret'] = edgeSecret;
    return next.handle(request.clone({
      url: `${origin}${request.url}`,
      setHeaders: headers,
    }));
  }
}
