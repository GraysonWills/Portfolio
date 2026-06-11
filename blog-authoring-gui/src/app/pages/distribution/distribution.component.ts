import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

type PlatformState = 'ready' | 'oauth' | 'review' | 'media' | 'careful' | 'manual';

type DistributionPlatform = {
  id: string;
  name: string;
  mark: string;
  accentClass: string;
  state: PlatformState;
  stateLabel: string;
  summary: string;
  selected: boolean;
  disabled?: boolean;
};

type QueueItem = {
  postTitle: string;
  platform: string;
  platformClass: string;
  runAt: string;
  status: string;
  statusClass: 'success' | 'info' | 'warn' | 'danger' | 'secondary';
  receipt: string;
};

@Component({
  selector: 'app-distribution',
  templateUrl: './distribution.component.html',
  styleUrl: './distribution.component.scss',
  standalone: false
})
export class DistributionComponent {
  masterCaption = 'New essay is live: building for expression, not reaction. A note on keeping the work honest, shipping publicly, and leaving the metrics outside the room.';
  publishTime = 'Jun 18, 2026 at 9:00 AM';
  selectedPostTitle = 'Building for expression, not reaction';

  platforms: DistributionPlatform[] = [
    {
      id: 'facebook',
      name: 'Facebook Page',
      mark: 'f',
      accentClass: 'facebook',
      state: 'ready',
      stateLabel: 'Fast',
      summary: 'Page announcement with link preview.',
      selected: true
    },
    {
      id: 'x',
      name: 'X / Twitter',
      mark: 'X',
      accentClass: 'x',
      state: 'oauth',
      stateLabel: 'API tier',
      summary: 'Short post or launch thread.',
      selected: true
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      mark: 'in',
      accentClass: 'linkedin',
      state: 'ready',
      stateLabel: 'Fast',
      summary: 'Personal or organization update.',
      selected: true
    },
    {
      id: 'instagram',
      name: 'Instagram',
      mark: 'IG',
      accentClass: 'instagram',
      state: 'review',
      stateLabel: 'Review',
      summary: 'Image-first caption package.',
      selected: true
    },
    {
      id: 'youtube',
      name: 'YouTube',
      mark: 'YT',
      accentClass: 'youtube',
      state: 'media',
      stateLabel: 'Media',
      summary: 'Short, video, or community post.',
      selected: false
    },
    {
      id: 'threads',
      name: 'Threads',
      mark: 'TH',
      accentClass: 'threads',
      state: 'ready',
      stateLabel: 'Fast',
      summary: 'Text-first mirror announcement.',
      selected: true
    },
    {
      id: 'bluesky',
      name: 'Bluesky',
      mark: 'BS',
      accentClass: 'bluesky',
      state: 'ready',
      stateLabel: 'Fast',
      summary: 'Low-friction public post.',
      selected: true
    },
    {
      id: 'mastodon',
      name: 'Mastodon',
      mark: 'M',
      accentClass: 'mastodon',
      state: 'ready',
      stateLabel: 'Fast',
      summary: 'Instance-aware canonical link.',
      selected: true
    },
    {
      id: 'pinterest',
      name: 'Pinterest',
      mark: 'P',
      accentClass: 'pinterest',
      state: 'ready',
      stateLabel: 'Fast',
      summary: 'Pin the blog image to a board.',
      selected: false
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      mark: 'TT',
      accentClass: 'tiktok',
      state: 'review',
      stateLabel: 'Review',
      summary: 'Photo carousel or teaser video.',
      selected: false
    },
    {
      id: 'reddit',
      name: 'Reddit',
      mark: 'R',
      accentClass: 'reddit',
      state: 'careful',
      stateLabel: 'Careful',
      summary: 'Owned or appropriate communities.',
      selected: false
    },
    {
      id: 'medium',
      name: 'Medium',
      mark: 'M',
      accentClass: 'medium',
      state: 'ready',
      stateLabel: 'Fast',
      summary: 'Excerpt or canonical mirror.',
      selected: false
    },
    {
      id: 'tumblr',
      name: 'Tumblr',
      mark: 'T',
      accentClass: 'tumblr',
      state: 'ready',
      stateLabel: 'Fast',
      summary: 'Lightweight tagged cross-post.',
      selected: false
    },
    {
      id: 'discord',
      name: 'Discord',
      mark: 'D',
      accentClass: 'discord',
      state: 'ready',
      stateLabel: 'Webhook',
      summary: 'Announcement to a chosen channel.',
      selected: true
    },
    {
      id: 'substack',
      name: 'Substack',
      mark: 'S',
      accentClass: 'substack',
      state: 'manual',
      stateLabel: 'Evaluate',
      summary: 'Note or newsletter mirror.',
      selected: false,
      disabled: true
    }
  ];

  queueItems: QueueItem[] = [
    {
      postTitle: 'Building for expression, not reaction',
      platform: 'Bluesky',
      platformClass: 'bluesky',
      runAt: '9:00 AM',
      status: 'Ready',
      statusClass: 'success',
      receipt: 'Delivery receipt only'
    },
    {
      postTitle: 'Building for expression, not reaction',
      platform: 'LinkedIn',
      platformClass: 'linkedin',
      runAt: '9:00 AM',
      status: 'Queued',
      statusClass: 'info',
      receipt: 'Awaiting connector'
    },
    {
      postTitle: 'Building for expression, not reaction',
      platform: 'Instagram',
      platformClass: 'instagram',
      runAt: '9:02 AM',
      status: 'Needs media',
      statusClass: 'warn',
      receipt: 'Image required'
    },
    {
      postTitle: 'Building for expression, not reaction',
      platform: 'Discord',
      platformClass: 'discord',
      runAt: '9:04 AM',
      status: 'Ready',
      statusClass: 'success',
      receipt: 'Webhook target'
    }
  ];

  constructor(
    private readonly router: Router,
    private readonly authService: AuthService
  ) {}

  get selectedPlatforms(): DistributionPlatform[] {
    return this.platforms.filter((platform) => platform.selected);
  }

  get readyCount(): number {
    return this.platforms.filter((platform) => platform.state === 'ready' && !platform.disabled).length;
  }

  get reviewCount(): number {
    return this.platforms.filter((platform) => platform.state === 'review' || platform.state === 'oauth').length;
  }

  togglePlatform(platform: DistributionPlatform): void {
    if (platform.disabled) return;
    platform.selected = !platform.selected;
  }

  getStateSeverity(state: PlatformState): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    if (state === 'ready') return 'success';
    if (state === 'oauth' || state === 'media') return 'warn';
    if (state === 'review') return 'info';
    if (state === 'careful') return 'danger';
    return 'secondary';
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  goToContentStudio(): void {
    this.router.navigate(['/content']);
  }

  goToSubscribers(): void {
    this.router.navigate(['/subscribers']);
  }

  goToCollections(): void {
    this.router.navigate(['/collections']);
  }

  goToComments(): void {
    this.router.navigate(['/comments']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  trackByPlatform(index: number, platform: DistributionPlatform): string {
    return platform.id || `${index}`;
  }

  trackByQueueItem(index: number, item: QueueItem): string {
    return `${item.postTitle}:${item.platform}:${index}`;
  }
}
