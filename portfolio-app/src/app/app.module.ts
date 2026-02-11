import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule } from '@angular/common/http';
import { DatePipe } from '@angular/common';

// PrimeNG Modules (app-level only)
import { ToastModule } from 'primeng/toast';
import { MenuModule } from 'primeng/menu';
// MenubarModule removed — header uses custom nav component
import { MessageService } from 'primeng/api';

import { SharedModule } from './shared/shared.module';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { FooterComponent } from './components/footer/footer.component';
import { HeaderComponent } from './components/header/header.component';
import { LandingComponent } from './pages/landing/landing.component';

@NgModule({
  declarations: [
    AppComponent,
    FooterComponent,
    HeaderComponent,
    LandingComponent
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    AppRoutingModule,
    SharedModule,
    // App-level PrimeNG (header/footer/toast)
    ToastModule,
    MenuModule,
    // MenubarModule removed
  ],
  providers: [MessageService, DatePipe],
  bootstrap: [AppComponent]
})
export class AppModule { }
