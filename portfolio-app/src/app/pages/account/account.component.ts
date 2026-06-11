import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { MessageService } from 'primeng/api';
import { AccountSubscription, SubscriptionService } from '../../services/subscription.service';
import { SiteAuthService, SiteUser } from '../../services/site-auth.service';

type AccountAuthMode = 'login' | 'email-code' | 'register' | 'confirm' | 'reset' | 'reset-confirm';

type TopicOption = {
  value: string;
  label: string;
};

@Component({
  selector: 'app-account',
  standalone: false,
  templateUrl: './account.component.html',
  styleUrl: './account.component.scss'
})
export class AccountComponent implements OnInit, OnDestroy {
  readonly topicOptions: TopicOption[] = [
    { value: 'blog_posts', label: 'Blog posts' },
    { value: 'major_updates', label: 'Major updates' }
  ];

  siteUser: SiteUser | null = null;
  authMode: AccountAuthMode = 'login';
  authEmail = '';
  authDisplayName = '';
  authPassword = '';
  authCode = '';
  authBusy = false;
  authCodeCountdown = '';

  profileDisplayName = '';
  profileBusy = false;

  subscription: AccountSubscription | null = null;
  selectedTopics: string[] = ['blog_posts'];
  subscriptionBusy = false;
  subscriptionLoading = false;

  deleteConfirm = '';
  deleteBusy = false;

  private authSub?: Subscription;
  private codeTimer?: ReturnType<typeof setInterval>;
  private codeExpiresAtMs = 0;

  constructor(
    private readonly siteAuth: SiteAuthService,
    private readonly subscriptions: SubscriptionService,
    private readonly messageService: MessageService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.authSub = this.siteAuth.currentUser$.subscribe((user) => {
      this.siteUser = user;
      if (user) {
        this.profileDisplayName = user.displayName || '';
        this.authEmail = user.email || this.authEmail;
        this.loadSubscription();
      } else {
        this.subscription = null;
      }
    });
  }

  ngOnDestroy(): void {
    this.authSub?.unsubscribe();
    this.clearCodeTimer();
  }

  get authSubmitLabel(): string {
    if (this.authMode === 'register') return 'Create account';
    if (this.authMode === 'confirm') return 'Verify email';
    if (this.authMode === 'reset') return 'Send reset code';
    if (this.authMode === 'reset-confirm') return 'Update password';
    if (this.authMode === 'email-code') return 'Verify code';
    return 'Send code';
  }

  get authHeading(): string {
    if (this.authMode === 'register') return 'Create Account';
    if (this.authMode === 'confirm') return 'Verify Email';
    if (this.authMode === 'reset' || this.authMode === 'reset-confirm') return 'Reset Password';
    return 'Sign In';
  }

  get authSubmitIcon(): string {
    if (this.authMode === 'login' || this.authMode === 'reset') return 'pi-envelope';
    if (this.authMode === 'register') return 'pi-user-plus';
    return 'pi-check';
  }

  get showDisplayNameField(): boolean {
    return this.authMode === 'register';
  }

  get showPasswordField(): boolean {
    return this.authMode === 'register' || this.authMode === 'reset-confirm';
  }

  get showCodeField(): boolean {
    return this.authMode === 'email-code' || this.authMode === 'confirm' || this.authMode === 'reset-confirm';
  }

  get authPasswordLabel(): string {
    return this.authMode === 'reset-confirm' ? 'New Password' : 'Password';
  }

  get authPasswordPlaceholder(): string {
    return this.authMode === 'reset-confirm' ? 'New password' : 'Minimum 8 characters';
  }

  get subscriptionStatusLabel(): string {
    const status = this.subscription?.status || 'NONE';
    if (status === 'SUBSCRIBED') return 'Subscribed';
    if (status === 'PENDING') return 'Pending confirmation';
    if (status === 'UNSUBSCRIBED') return 'Unsubscribed';
    return 'Not subscribed';
  }

  get canSavePreferences(): boolean {
    const status = this.subscription?.status;
    return status === 'SUBSCRIBED' || status === 'PENDING';
  }

  setAuthMode(mode: AccountAuthMode): void {
    this.authMode = mode;
    if (mode === 'login' || mode === 'register' || mode === 'reset') {
      this.authCode = '';
      this.clearCodeTimer();
    }
    if (mode !== 'register' && mode !== 'reset-confirm') {
      this.authPassword = '';
    }
  }

  submitAuth(): void {
    if (this.authBusy) return;
    this.authBusy = true;

    if (this.authMode === 'register') {
      this.siteAuth.register(this.authDisplayName, this.authEmail, this.authPassword).subscribe({
        next: () => {
          this.authBusy = false;
          this.setAuthMode('confirm');
          this.startCodeTimer();
          this.toast('success', 'Check Email', 'Enter the verification code to finish creating your account.');
        },
        error: (err) => this.authError(err, 'Registration failed.')
      });
      return;
    }

    if (this.authMode === 'confirm') {
      this.siteAuth.confirmRegistration(this.authEmail, this.authCode).subscribe({
        next: () => {
          this.authBusy = false;
          this.setAuthMode('login');
          this.toast('success', 'Verified', 'Send yourself a sign-in code to continue.');
        },
        error: (err) => this.authError(err, 'Verification failed.')
      });
      return;
    }

    if (this.authMode === 'reset') {
      this.siteAuth.forgotPassword(this.authEmail).subscribe({
        next: () => {
          this.authBusy = false;
          this.setAuthMode('reset-confirm');
          this.startCodeTimer();
          this.toast('success', 'Check Email', 'Enter the reset code and choose a new password.');
        },
        error: (err) => this.authError(err, 'Could not send password reset code.')
      });
      return;
    }

    if (this.authMode === 'reset-confirm') {
      this.siteAuth.confirmForgotPassword(this.authEmail, this.authCode, this.authPassword).subscribe({
        next: () => {
          this.authBusy = false;
          this.authPassword = '';
          this.authCode = '';
          this.clearCodeTimer();
          this.setAuthMode('login');
          this.toast('success', 'Password Updated', 'Send yourself a sign-in code to continue.');
        },
        error: (err) => this.authError(err, 'Could not reset password.')
      });
      return;
    }

    if (this.authMode === 'email-code') {
      this.siteAuth.confirmEmailCodeLogin(this.authEmail, this.authCode).subscribe({
        next: () => {
          this.authBusy = false;
          this.authPassword = '';
          this.authCode = '';
          this.clearCodeTimer();
          this.toast('success', 'Signed In', 'Your account is ready.');
        },
        error: (err) => this.authError(err, 'Sign in failed.')
      });
      return;
    }

    this.siteAuth.startEmailCodeLogin(this.authEmail).subscribe({
      next: () => {
        this.authBusy = false;
        this.setAuthMode('email-code');
        this.startCodeTimer();
        this.toast('success', 'Check Email', 'Enter the sign-in code sent to your email.');
      },
      error: (err) => this.authError(err, 'Could not send sign-in code.')
    });
  }

  resendCode(): void {
    if (this.authBusy || !this.authEmail) return;
    this.authBusy = true;

    const action = this.authMode === 'confirm'
      ? this.siteAuth.resendRegistrationCode(this.authEmail)
      : this.authMode === 'reset-confirm'
        ? this.siteAuth.forgotPassword(this.authEmail)
        : this.siteAuth.startEmailCodeLogin(this.authEmail);

    action.subscribe({
      next: () => {
        this.authBusy = false;
        if (this.authMode !== 'confirm' && this.authMode !== 'reset-confirm') this.setAuthMode('email-code');
        this.startCodeTimer();
        this.toast('success', 'Code Sent', 'A new code was sent.');
      },
      error: (err) => this.authError(err, 'Could not resend code.')
    });
  }

  updateProfile(): void {
    if (this.profileBusy) return;
    this.profileBusy = true;
    this.siteAuth.updateDisplayName(this.profileDisplayName).subscribe({
      next: () => {
        this.profileBusy = false;
        this.toast('success', 'Profile Updated', 'Your display name was saved.');
      },
      error: (err) => {
        this.profileBusy = false;
        this.toast('error', 'Profile Failed', err?.message || 'Could not update profile.');
      }
    });
  }

  loadSubscription(): void {
    if (!this.siteUser || this.subscriptionLoading) return;
    this.subscriptionLoading = true;
    this.subscriptions.getMySubscription().subscribe({
      next: (subscription) => {
        this.subscriptionLoading = false;
        this.subscription = subscription;
        this.selectedTopics = subscription.topics.length ? [...subscription.topics] : ['blog_posts'];
      },
      error: (err) => {
        this.subscriptionLoading = false;
        this.toast('error', 'Subscriptions Failed', err?.message || 'Could not load subscriptions.');
      }
    });
  }

  toggleTopic(topic: string, checked: boolean): void {
    const current = new Set(this.selectedTopics);
    if (checked) {
      current.add(topic);
    } else {
      current.delete(topic);
    }
    this.selectedTopics = [...current];
  }

  hasTopic(topic: string): boolean {
    return this.selectedTopics.includes(topic);
  }

  requestSubscription(): void {
    const email = this.siteUser?.email || '';
    if (!email || this.subscriptionBusy) return;
    this.subscriptionBusy = true;
    const topics = this.selectedTopics.length ? this.selectedTopics : ['blog_posts'];
    this.subscriptions.request(email, topics, 'reader-account').subscribe({
      next: () => {
        this.subscriptionBusy = false;
        this.toast('success', 'Check Email', 'Confirm your subscription from your inbox.');
        this.loadSubscription();
      },
      error: (err) => {
        this.subscriptionBusy = false;
        this.toast('error', 'Subscribe Failed', err?.error?.error || err?.message || 'Could not start subscription.');
      }
    });
  }

  savePreferences(): void {
    if (this.subscriptionBusy || !this.canSavePreferences) return;
    if (!this.selectedTopics.length) {
      this.toast('warn', 'Choose a Topic', 'Select at least one topic or unsubscribe.');
      return;
    }

    this.subscriptionBusy = true;
    this.subscriptions.updateMyPreferences(this.selectedTopics).subscribe({
      next: (subscription) => {
        this.subscriptionBusy = false;
        this.subscription = subscription;
        this.selectedTopics = subscription.topics.length ? [...subscription.topics] : ['blog_posts'];
        this.toast('success', 'Preferences Saved', 'Your email preferences were updated.');
      },
      error: (err) => {
        this.subscriptionBusy = false;
        this.toast('error', 'Preferences Failed', err?.message || 'Could not update preferences.');
      }
    });
  }

  unsubscribe(): void {
    if (this.subscriptionBusy) return;
    this.subscriptionBusy = true;
    this.subscriptions.unsubscribeMe().subscribe({
      next: (subscription) => {
        this.subscriptionBusy = false;
        this.subscription = subscription;
        this.selectedTopics = ['blog_posts'];
        this.toast('success', 'Unsubscribed', 'Email subscriptions were removed.');
      },
      error: (err) => {
        this.subscriptionBusy = false;
        this.toast('error', 'Unsubscribe Failed', err?.message || 'Could not unsubscribe.');
      }
    });
  }

  signOut(): void {
    this.siteAuth.logout();
    this.toast('success', 'Signed Out', 'You are signed out.');
  }

  async deleteAccount(): Promise<void> {
    if (this.deleteBusy || this.deleteConfirm !== 'DELETE') return;
    this.deleteBusy = true;

    try {
      if (this.subscription?.status === 'SUBSCRIBED' || this.subscription?.status === 'PENDING') {
        await firstValueFrom(this.subscriptions.unsubscribeMe());
      }
      await firstValueFrom(this.siteAuth.deleteAccount());
      this.deleteBusy = false;
      this.deleteConfirm = '';
      this.toast('success', 'Account Deleted', 'Your account was deleted.');
      void this.router.navigate(['/blog']);
    } catch (err: any) {
      this.deleteBusy = false;
      this.toast('error', 'Delete Failed', err?.message || 'Could not delete account.');
    }
  }

  private authError(err: any, fallback: string): void {
    this.authBusy = false;
    this.toast('error', 'Account Error', err?.message || fallback);
  }

  private startCodeTimer(): void {
    if (this.codeTimer) {
      clearInterval(this.codeTimer);
      this.codeTimer = undefined;
    }
    this.codeExpiresAtMs = Date.now() + (10 * 60 * 1000);
    this.syncCodeCountdown();
    this.codeTimer = setInterval(() => this.syncCodeCountdown(), 1000);
  }

  private syncCodeCountdown(): void {
    const remainingMs = Math.max(0, this.codeExpiresAtMs - Date.now());
    if (!remainingMs) {
      this.authCodeCountdown = '';
      this.clearCodeTimer();
      return;
    }
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = `${totalSeconds % 60}`.padStart(2, '0');
    this.authCodeCountdown = `${minutes}:${seconds}`;
  }

  private clearCodeTimer(): void {
    if (this.codeTimer) {
      clearInterval(this.codeTimer);
      this.codeTimer = undefined;
    }
    this.codeExpiresAtMs = 0;
    if (this.authMode === 'login' || this.authMode === 'register' || this.authMode === 'reset') {
      this.authCodeCountdown = '';
    }
  }

  private toast(severity: 'success' | 'info' | 'warn' | 'error', summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail });
  }
}
