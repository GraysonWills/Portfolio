import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { AuthService } from '../../services/auth.service';
import {
  BlogApiService,
  NotificationSubscriber
} from '../../services/blog-api.service';
import { HotkeysService } from '../../services/hotkeys.service';

type SubscriberPreferenceDraft = {
  blog_posts: boolean;
  major_updates: boolean;
  promotions: boolean;
};

@Component({
  selector: 'app-subscribers',
  standalone: false,
  templateUrl: './subscribers.component.html',
  styleUrl: './subscribers.component.scss'
})
export class SubscribersComponent implements OnInit, OnDestroy {
  subscribers: NotificationSubscriber[] = [];
  filteredSubscribers: NotificationSubscriber[] = [];
  visibleSubscribers: NotificationSubscriber[] = [];
  isLoading = false;
  isSaving = false;
  isRemoving = false;

  searchQuery = '';
  topicFilter = 'blog_posts';
  includeUnsubscribed = false;

  newSubscriberEmail = '';
  newSubscriberTopics: SubscriberPreferenceDraft = {
    blog_posts: true,
    major_updates: false,
    promotions: false
  };

  private readonly draftStorageKey = 'subscriber_preference_drafts_v1';
  private draftByEmailHash: Record<string, SubscriberPreferenceDraft> = {};
  editingPreferencesFor: string | null = null;
  private cleanupHotkeys: (() => void) | null = null;
  private visibleCount = 0;
  private readonly pageSize = 30;
  private readonly scrollLoadBufferPx = 500;

  constructor(
    private readonly authService: AuthService,
    private readonly blogApi: BlogApiService,
    private readonly messageService: MessageService,
    private readonly confirmationService: ConfirmationService,
    private readonly router: Router,
    private readonly hotkeys: HotkeysService
  ) {}

  ngOnInit(): void {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadDrafts();
    this.loadSubscribers();
    this.registerHotkeys();
  }

  ngOnDestroy(): void {
    this.cleanupHotkeys?.();
    this.cleanupHotkeys = null;
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.isLoading || !this.hasMoreSubscribers) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const viewportBottom = window.scrollY + window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    if ((documentHeight - viewportBottom) <= this.scrollLoadBufferPx) {
      this.loadMoreSubscribers();
    }
  }

  loadSubscribers(): void {
    this.isLoading = true;
    this.blogApi.getNotificationSubscribers(this.topicFilter, this.includeUnsubscribed).subscribe({
      next: (res) => {
        this.subscribers = Array.isArray(res?.subscribers) ? res.subscribers : [];
        this.applyFilter();
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Load Failed',
          detail: 'Unable to load subscriber emails.'
        });
      }
    });
  }

  addSubscriber(): void {
    const email = String(this.newSubscriberEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Invalid Email',
        detail: 'Enter a valid email address.'
      });
      return;
    }

    if (this.isSaving) return;
    this.isSaving = true;

    const selectedTopics = this.extractEnabledTopics(this.newSubscriberTopics);
    const backendSupportedTopics = selectedTopics.filter((topic) => topic !== 'promotions');
    const topicsForBackend = backendSupportedTopics.length ? backendSupportedTopics : ['blog_posts'];

    this.blogApi.upsertNotificationSubscriber({
      email,
      topics: topicsForBackend,
      status: 'SUBSCRIBED'
    }).subscribe({
      next: () => {
        this.isSaving = false;
        this.newSubscriberEmail = '';
        this.newSubscriberTopics = {
          blog_posts: true,
          major_updates: false,
          promotions: false
        };
        this.loadSubscribers();

        const selectedFutureOnly = selectedTopics.includes('promotions');
        this.messageService.add({
          severity: selectedFutureOnly ? 'info' : 'success',
          summary: selectedFutureOnly ? 'Added (Partial)' : 'Subscriber Added',
          detail: selectedFutureOnly
            ? 'Subscriber added. "promotions" is UI-ready and will be enabled on backend later.'
            : 'Subscriber has been added.'
        });
      },
      error: (err) => {
        this.isSaving = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Add Failed',
          detail: err?.error?.error || err?.message || 'Could not add subscriber.'
        });
      }
    });
  }

  removeSubscriber(subscriber: NotificationSubscriber): void {
    const emailHash = String(subscriber?.emailHash || '').trim();
    if (!emailHash) return;

    this.confirmationService.confirm({
      header: 'Remove Subscriber',
      message: `Remove ${subscriber.email} from subscriber records?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.isRemoving = true;
        this.blogApi.removeNotificationSubscriber(emailHash).subscribe({
          next: () => {
            this.isRemoving = false;
            delete this.draftByEmailHash[emailHash];
            this.persistDrafts();
            this.subscribers = this.subscribers.filter((row) => row.emailHash !== emailHash);
            this.messageService.add({
              severity: 'success',
              summary: 'Removed',
              detail: `${subscriber.email} was removed.`
            });
          },
          error: (err) => {
            this.isRemoving = false;
            this.messageService.add({
              severity: 'error',
              summary: 'Remove Failed',
              detail: err?.error?.error || err?.message || 'Could not remove subscriber.'
            });
          }
        });
      }
    });
  }

  startPreferenceEdit(subscriber: NotificationSubscriber): void {
    const key = String(subscriber.emailHash || '').trim();
    if (!key) return;
    this.editingPreferencesFor = key;

    if (!this.draftByEmailHash[key]) {
      const topics = new Set((subscriber.topics || []).map((topic) => String(topic || '').toLowerCase()));
      this.draftByEmailHash[key] = {
        blog_posts: topics.has('blog_posts'),
        major_updates: topics.has('major_updates'),
        promotions: topics.has('promotions')
      };
    }
  }

  cancelPreferenceEdit(): void {
    this.editingPreferencesFor = null;
  }

  savePreferenceDraft(subscriber: NotificationSubscriber): void {
    const key = String(subscriber.emailHash || '').trim();
    if (!key || !this.draftByEmailHash[key]) return;

    this.persistDrafts();
    this.editingPreferencesFor = null;
    this.messageService.add({
      severity: 'info',
      summary: 'Saved Locally',
      detail: 'Preference edits are UI-only for now. Backend wiring is pending.'
    });
  }

  hasDraft(subscriber: NotificationSubscriber): boolean {
    const key = String(subscriber.emailHash || '').trim();
    return !!key && !!this.draftByEmailHash[key];
  }

  getPreferenceDraft(subscriber: NotificationSubscriber): SubscriberPreferenceDraft | null {
    const key = String(subscriber.emailHash || '').trim();
    if (!key) return null;
    return this.draftByEmailHash[key] || null;
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  goToContentStudio(): void {
    this.router.navigate(['/content']);
  }

  goToCollections(): void {
    this.router.navigate(['/collections']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  focusAddEmail(): void {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('new-subscriber-email') as HTMLInputElement | null;
    if (!input) return;
    input.focus();
    input.select();
  }

  onSearchQueryChanged(): void {
    this.applyFilter();
  }

  get hasMoreSubscribers(): boolean {
    return this.visibleSubscribers.length < this.filteredSubscribers.length;
  }

  loadMoreSubscribers(): void {
    if (!this.hasMoreSubscribers) return;
    this.visibleCount += this.pageSize;
    this.visibleSubscribers = this.filteredSubscribers.slice(0, this.visibleCount);
  }

  trackBySubscriber(index: number, sub: NotificationSubscriber): string {
    return String(sub?.emailHash || sub?.email || index);
  }

  private applyFilter(): void {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) {
      this.filteredSubscribers = [...this.subscribers];
    } else {
      this.filteredSubscribers = this.subscribers.filter((sub) => {
        const email = String(sub.email || '').toLowerCase();
        const status = String(sub.status || '').toLowerCase();
        const topics = Array.isArray(sub.topics) ? sub.topics.join(',').toLowerCase() : '';
        return email.includes(q) || status.includes(q) || topics.includes(q);
      });
    }

    this.visibleCount = this.pageSize;
    this.visibleSubscribers = this.filteredSubscribers.slice(0, this.visibleCount);
  }

  private extractEnabledTopics(draft: SubscriberPreferenceDraft): string[] {
    return Object.entries(draft)
      .filter(([_, enabled]) => !!enabled)
      .map(([topic]) => topic);
  }

  private loadDrafts(): void {
    try {
      const raw = localStorage.getItem(this.draftStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.draftByEmailHash = parsed;
      }
    } catch {
      this.draftByEmailHash = {};
    }
  }

  private persistDrafts(): void {
    try {
      localStorage.setItem(this.draftStorageKey, JSON.stringify(this.draftByEmailHash));
    } catch {
      // ignore storage failures
    }
  }

  private registerHotkeys(): void {
    this.cleanupHotkeys?.();
    this.cleanupHotkeys = this.hotkeys.register('subscribers', [
      {
        combo: 'mod+alt+r',
        description: 'Refresh subscriber list',
        action: () => this.loadSubscribers(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+e',
        description: 'Focus add-subscriber email field',
        action: () => this.focusAddEmail(),
        allowInInputs: true
      },
      {
        combo: 'mod+alt+a',
        description: 'Add subscriber',
        action: () => this.addSubscriber(),
        allowInInputs: true
      }
    ]);
  }
}
