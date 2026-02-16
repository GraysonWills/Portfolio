import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
  standalone: false
})
export class ForgotPasswordComponent {
  step: 'request' | 'confirm' = 'request';

  requestForm: FormGroup;
  confirmForm: FormGroup;

  isSubmitting: boolean = false;
  errorMessage: string = '';

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private messageService: MessageService
  ) {
    this.requestForm = this.fb.group({
      username: ['', [Validators.required]]
    });

    this.confirmForm = this.fb.group({
      code: ['', [Validators.required]],
      newPassword: ['', [Validators.required, Validators.minLength(12)]]
    });
  }

  requestCode(): void {
    if (this.requestForm.invalid) return;
    this.isSubmitting = true;
    this.errorMessage = '';

    const username = this.requestForm.value.username;

    this.auth.forgotPassword(username).subscribe({
      next: () => {
        this.isSubmitting = false;
        this.step = 'confirm';
        this.messageService.add({
          severity: 'success',
          summary: 'Email Sent',
          detail: 'Check your email for the verification code.'
        });
      },
      error: (err) => {
        this.isSubmitting = false;
        this.errorMessage = err?.message || 'Failed to send reset code.';
      }
    });
  }

  confirmReset(): void {
    if (this.requestForm.invalid || this.confirmForm.invalid) return;
    this.isSubmitting = true;
    this.errorMessage = '';

    const username = this.requestForm.value.username;
    const code = this.confirmForm.value.code;
    const newPassword = this.confirmForm.value.newPassword;

    this.auth.confirmForgotPassword(username, code, newPassword).subscribe({
      next: () => {
        this.isSubmitting = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Password Updated',
          detail: 'You can now sign in with your new password.'
        });
        this.router.navigate(['/login']);
      },
      error: (err) => {
        this.isSubmitting = false;
        this.errorMessage = err?.message || 'Failed to reset password.';
      }
    });
  }

  backToLogin(): void {
    this.router.navigate(['/login']);
  }
}

