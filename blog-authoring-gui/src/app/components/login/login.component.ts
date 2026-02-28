import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService, LoginThrottleState } from '../../services/auth.service';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  standalone: false
})
export class LoginComponent implements OnInit, OnDestroy {
  loginForm: FormGroup;
  isAuthenticating: boolean = false;
  errorMessage: string = '';
  lockoutState: LoginThrottleState;
  private lockoutPoller: ReturnType<typeof setInterval> | null = null;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private messageService: MessageService
  ) {
    this.lockoutState = this.authService.getLoginThrottleState();
    this.loginForm = this.fb.group({
      username: ['', [Validators.required]],
      password: ['', [Validators.required]]
    });
  }

  ngOnInit(): void {
    this.refreshLockoutState();
    this.lockoutPoller = setInterval(() => this.refreshLockoutState(), 1000);

    // Redirect if already authenticated
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }
  }

  ngOnDestroy(): void {
    if (this.lockoutPoller) {
      clearInterval(this.lockoutPoller);
      this.lockoutPoller = null;
    }
  }

  get isLockedOut(): boolean {
    return this.lockoutState.locked;
  }

  get lockoutMessage(): string {
    if (!this.lockoutState.locked) return '';
    const remaining = Math.max(1, Math.ceil(this.lockoutState.retryAfterMs / 1000));
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    return `Too many failed login attempts. Try again in ${duration}.`;
  }

  onSubmit(): void {
    this.refreshLockoutState();
    if (this.isLockedOut) {
      this.setError(this.lockoutMessage);
      return;
    }

    if (this.loginForm.valid) {
      this.isAuthenticating = true;
      this.errorMessage = '';
      
      const { username, password } = this.loginForm.value;
      
      this.authService.login(username, password).subscribe({
        next: (success) => {
          if (success) {
            this.refreshLockoutState();
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Login successful'
            });
            this.router.navigate(['/dashboard']);
          } else {
            this.setError('Invalid username or password');
          }
        },
        error: (error) => {
          this.setError(error.message || 'Login failed. Please try again.');
        }
      });
    }
  }

  setError(message: string): void {
    this.refreshLockoutState();
    this.errorMessage = message;
    this.isAuthenticating = false;
  }

  private refreshLockoutState(): void {
    this.lockoutState = this.authService.getLoginThrottleState();
  }
}
