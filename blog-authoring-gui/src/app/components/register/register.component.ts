import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
  standalone: false
})
export class RegisterComponent {
  registerForm: FormGroup;
  verifyForm: FormGroup;
  isSubmitting = false;
  isVerifying = false;
  errorMessage = '';
  verificationRequired = false;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private messageService: MessageService
  ) {
    this.registerForm = this.fb.group({
      username: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]]
    });

    this.verifyForm = this.fb.group({
      code: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  submitRegistration(): void {
    if (this.registerForm.invalid || this.isSubmitting) return;
    this.errorMessage = '';
    this.isSubmitting = true;

    const { username, email, password } = this.registerForm.value;
    this.auth.register(username, email, password).subscribe({
      next: () => {
        this.isSubmitting = false;
        this.verificationRequired = true;
        this.messageService.add({
          severity: 'success',
          summary: 'Verification Sent',
          detail: 'Check your email for the verification code.'
        });
      },
      error: (err) => {
        this.isSubmitting = false;
        this.errorMessage = err?.message || 'Registration failed.';
      }
    });
  }

  submitVerification(): void {
    if (this.verifyForm.invalid || this.isVerifying) return;
    this.errorMessage = '';
    this.isVerifying = true;

    const username = String(this.registerForm.value.username || '').trim();
    const code = String(this.verifyForm.value.code || '').trim();
    this.auth.confirmRegistration(username, code).subscribe({
      next: () => {
        this.isVerifying = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Email Verified',
          detail: 'Registration complete. You can now log in.'
        });
        this.router.navigate(['/login']);
      },
      error: (err) => {
        this.isVerifying = false;
        this.errorMessage = err?.message || 'Verification failed.';
      }
    });
  }
}
