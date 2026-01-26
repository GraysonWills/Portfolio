import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  standalone: false
})
export class AppComponent implements OnInit {
  title = 'Blog Authoring GUI';

  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Redirect to login if not authenticated and not already on login page
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        if (!this.authService.isAuthenticated() && event.url !== '/login') {
          this.router.navigate(['/login']);
        }
      }
    });
  }
}
