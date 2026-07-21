import { NgModule } from '@angular/core';
import { BrowserModule, provideClientHydration, withEventReplay, withHttpTransferCacheOptions } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HTTP_INTERCEPTORS, HttpClientModule } from '@angular/common/http';
import { DatePipe } from '@angular/common';

// PrimeNG Modules (app-level only)
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { SharedModule } from './shared/shared.module';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { FooterComponent } from './components/footer/footer.component';
import { HeaderComponent } from './components/header/header.component';
import { SupportComponent } from './components/support/support.component';
import { LandingComponent } from './pages/landing/landing.component';
import { NotFoundComponent } from './pages/not-found/not-found.component';
import { SsrApiOriginInterceptor } from './services/ssr-api-origin.interceptor';

@NgModule({
  declarations: [
    AppComponent,
    FooterComponent,
    HeaderComponent,
    SupportComponent,
    LandingComponent,
    NotFoundComponent
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    AppRoutingModule,
    SharedModule,
    // App-level PrimeNG (header/footer/toast)
    ToastModule
  ],
  providers: [
    MessageService,
    DatePipe,
    { provide: HTTP_INTERCEPTORS, useClass: SsrApiOriginInterceptor, multi: true },
    provideClientHydration(
      withEventReplay(),
      withHttpTransferCacheOptions({
        filter: (request) => !request.url.includes('/account') && !request.url.includes('/comments')
      })
    )
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
