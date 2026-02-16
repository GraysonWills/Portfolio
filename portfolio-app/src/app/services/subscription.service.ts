/**
 * Subscription Service
 * Calls backend subscription endpoints (SES + DynamoDB).
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SubscriptionService {
  private readonly apiUrl = environment.redisApiUrl || '';
  private readonly headers = new HttpHeaders({
    'Content-Type': 'application/json'
  });

  constructor(private http: HttpClient) {}

  request(email: string, topics: string[] = ['blog_posts'], source: string = 'blog'): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/subscriptions/request`,
      { email, topics, source },
      { headers: this.headers }
    );
  }

  confirm(token: string): Observable<any> {
    return this.http.get(
      `${this.apiUrl}/subscriptions/confirm?token=${encodeURIComponent(token)}`,
      { headers: this.headers }
    );
  }

  unsubscribe(token: string): Observable<any> {
    return this.http.get(
      `${this.apiUrl}/subscriptions/unsubscribe?token=${encodeURIComponent(token)}`,
      { headers: this.headers }
    );
  }

  updatePreferences(token: string, topics: string[]): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/subscriptions/preferences`,
      { token, topics },
      { headers: this.headers }
    );
  }
}

