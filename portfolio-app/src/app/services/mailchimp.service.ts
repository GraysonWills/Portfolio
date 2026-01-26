/**
 * Mailchimp Service
 * Handles email subscription functionality
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface MailchimpSubscription {
  email: string;
  firstName?: string;
  lastName?: string;
  tags?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class MailchimpService {
  private apiUrl = 'https://<dc>.api.mailchimp.com/3.0';
  private listId = environment.mailchimpListId;
  private apiKey = environment.mailchimpApiKey;

  constructor(private http: HttpClient) {}

  /**
   * Subscribe email to Mailchimp list
   */
  subscribe(email: string, firstName?: string, lastName?: string): Observable<any> {
    const headers = new HttpHeaders({
      'Authorization': `apikey ${this.apiKey}`,
      'Content-Type': 'application/json'
    });

    const body = {
      email_address: email,
      status: 'subscribed',
      merge_fields: {
        FNAME: firstName || '',
        LNAME: lastName || ''
      }
    };

    return this.http.post(
      `${this.apiUrl}/lists/${this.listId}/members`,
      body,
      { headers }
    ).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Load Mailchimp script dynamically
   */
  loadMailchimpScript(): void {
    if (!document.getElementById('mcjs')) {
      const script = document.createElement('script');
      script.id = 'mcjs';
      script.innerHTML = `
        !function(c,h,i,m,p){m=c.createElement(h),p=c.getElementsByTagName(h)[0],
        m.async=1,m.src=i,p.parentNode.insertBefore(m,p)}
        (document,"script","https://chimpstatic.com/mcjs-connected/js/users/d5c7a1745f36c9abf37462301/2faf87c3c0a1724830876c92b.js");
      `;
      document.head.appendChild(script);
    }
  }

  /**
   * Error handling
   */
  private handleError(error: any): Observable<never> {
    let errorMessage = 'An unknown error occurred';
    
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error: ${error.error.message}`;
    } else {
      errorMessage = `Error Code: ${error.status}\nMessage: ${error.message}`;
    }

    console.error('Mailchimp Service Error:', errorMessage);
    return throwError(() => new Error(errorMessage));
  }
}
