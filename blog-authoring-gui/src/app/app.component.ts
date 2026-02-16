import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  standalone: false
})
export class AppComponent implements OnInit {
  title = 'Blog Authoring GUI';
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Redirect to login if not authenticated and not already on login page
    this.router.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(event => {
        if (event instanceof NavigationEnd) {
          if (!this.authService.isAuthenticated() && event.url !== '/login') {
            this.router.navigate(['/login']);
          }
        }
      });
  }
}
