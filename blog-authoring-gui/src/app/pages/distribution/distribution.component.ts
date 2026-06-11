import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

type PlatformConnectionState = 'connected' | 'attention' | 'expired' | 'not-connected' | 'manual';
type QueueStatusClass = 'success' | 'info' | 'warn' | 'danger' | 'secondary';

type DestinationOption = {
  label: string;
  value: string;
  requiresMedia?: boolean;
};

type DistributionPlatform = {
  id: string;
  name: string;
  handle: string;
  mark: string;
  accentClass: string;
  connectionState: PlatformConnectionState;
  connectionLabel: string;
  connectionDetail: string;
  lastChecked: string;
  expiresIn: string;
  destinationOptions: DestinationOption[];
  destination: string;
  selected: boolean;
  disabled?: boolean;
};

type QueueItem = {
  postTitle: string;
  platform: string;
  platformClass: string;
  destination: string;
  runAt: string;
  status: string;
  statusClass: QueueStatusClass;
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
  publishTime = '2026-06-18T09:00';
  selectedPostTitle = 'Building for expression, not reaction';
  postUrl = 'https://www.grayson-wills.com/blog/expression-not-reaction';
  hashtagText = '#writing #creativepractice #buildinpublic';
  mediaBrief = 'Use the blog cover image, cropped square for feeds and vertical for stories.';
  draftNotice = 'No scheduled changes yet.';

  platforms: DistributionPlatform[] = [
    {
      id: 'facebook',
      name: 'Facebook Page',
      handle: 'Grayson Wills',
      mark: 'f',
      accentClass: 'facebook',
      connectionState: 'connected',
      connectionLabel: 'Connected',
      connectionDetail: 'Page publishing token is healthy.',
      lastChecked: '2 min ago',
      expiresIn: '54 days',
      destinationOptions: [
        { label: 'Page post', value: 'page-post' },
        { label: 'Story', value: 'story', requiresMedia: true },
        { label: 'Reel caption', value: 'reel-caption', requiresMedia: true }
      ],
      destination: 'page-post',
      selected: true
    },
    {
      id: 'x',
      name: 'X / Twitter',
      handle: '@graysonwills',
      mark: 'X',
      accentClass: 'x',
      connectionState: 'expired',
      connectionLabel: 'Login needed',
      connectionDetail: 'OAuth token needs to be refreshed before posting.',
      lastChecked: '18 min ago',
      expiresIn: 'Expired',
      destinationOptions: [
        { label: 'Single post', value: 'single-post' },
        { label: 'Thread starter', value: 'thread-starter' }
      ],
      destination: 'single-post',
      selected: true
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      handle: 'Grayson Wills',
      mark: 'in',
      accentClass: 'linkedin',
      connectionState: 'connected',
      connectionLabel: 'Connected',
      connectionDetail: 'Personal profile publishing is available.',
      lastChecked: '2 min ago',
      expiresIn: '72 days',
      destinationOptions: [
        { label: 'Personal update', value: 'personal-update' },
        { label: 'Company page', value: 'company-page' },
        { label: 'Article link', value: 'article-link' }
      ],
      destination: 'personal-update',
      selected: true
    },
    {
      id: 'instagram',
      name: 'Instagram',
      handle: '@graysonwills',
      mark: 'IG',
      accentClass: 'instagram',
      connectionState: 'attention',
      connectionLabel: 'Media check',
      connectionDetail: 'Connected, but feed/story posts need approved media.',
      lastChecked: '5 min ago',
      expiresIn: '31 days',
      destinationOptions: [
        { label: 'Feed post', value: 'feed-post', requiresMedia: true },
        { label: 'Story', value: 'story', requiresMedia: true },
        { label: 'Reel caption', value: 'reel-caption', requiresMedia: true }
      ],
      destination: 'story',
      selected: true
    },
    {
      id: 'youtube',
      name: 'YouTube',
      handle: '@graysonwills',
      mark: 'YT',
      accentClass: 'youtube',
      connectionState: 'not-connected',
      connectionLabel: 'Not connected',
      connectionDetail: 'Connect the channel before queueing community posts.',
      lastChecked: 'Not checked',
      expiresIn: 'No token',
      destinationOptions: [
        { label: 'Community post', value: 'community-post' },
        { label: 'Short description', value: 'short-description', requiresMedia: true },
        { label: 'Video description', value: 'video-description' }
      ],
      destination: 'community-post',
      selected: false
    },
    {
      id: 'threads',
      name: 'Threads',
      handle: '@graysonwills',
      mark: 'TH',
      accentClass: 'threads',
      connectionState: 'connected',
      connectionLabel: 'Connected',
      connectionDetail: 'Text publishing is available.',
      lastChecked: '2 min ago',
      expiresIn: '31 days',
      destinationOptions: [
        { label: 'Post', value: 'post' },
        { label: 'Reply chain starter', value: 'reply-chain-starter' }
      ],
      destination: 'post',
      selected: true
    },
    {
      id: 'bluesky',
      name: 'Bluesky',
      handle: '@graysonwills.com',
      mark: 'BS',
      accentClass: 'bluesky',
      connectionState: 'connected',
      connectionLabel: 'Connected',
      connectionDetail: 'App password is present and healthy.',
      lastChecked: '2 min ago',
      expiresIn: 'Rotates manually',
      destinationOptions: [
        { label: 'Post', value: 'post' }
      ],
      destination: 'post',
      selected: true
    },
    {
      id: 'mastodon',
      name: 'Mastodon',
      handle: '@grayson@mastodon.social',
      mark: 'M',
      accentClass: 'mastodon',
      connectionState: 'connected',
      connectionLabel: 'Connected',
      connectionDetail: 'Instance access token is healthy.',
      lastChecked: '2 min ago',
      expiresIn: 'No expiry',
      destinationOptions: [
        { label: 'Post', value: 'post' },
        { label: 'Unlisted post', value: 'unlisted-post' }
      ],
      destination: 'post',
      selected: true
    },
    {
      id: 'pinterest',
      name: 'Pinterest',
      handle: 'Grayson Wills',
      mark: 'P',
      accentClass: 'pinterest',
      connectionState: 'connected',
      connectionLabel: 'Connected',
      connectionDetail: 'Board posting is available.',
      lastChecked: '7 min ago',
      expiresIn: '87 days',
      destinationOptions: [
        { label: 'Pin to blog board', value: 'blog-board-pin', requiresMedia: true },
        { label: 'Idea pin draft', value: 'idea-pin-draft', requiresMedia: true }
      ],
      destination: 'blog-board-pin',
      selected: false
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      handle: '@graysonwills',
      mark: 'TT',
      accentClass: 'tiktok',
      connectionState: 'attention',
      connectionLabel: 'Media check',
      connectionDetail: 'Connected, but upload requires a video or photo set.',
      lastChecked: '12 min ago',
      expiresIn: '15 days',
      destinationOptions: [
        { label: 'Photo mode', value: 'photo-mode', requiresMedia: true },
        { label: 'Video caption', value: 'video-caption', requiresMedia: true }
      ],
      destination: 'photo-mode',
      selected: false
    },
    {
      id: 'reddit',
      name: 'Reddit',
      handle: 'u/graysonwills',
      mark: 'R',
      accentClass: 'reddit',
      connectionState: 'manual',
      connectionLabel: 'Manual review',
      connectionDetail: 'Keep this as a draft unless a community truly fits.',
      lastChecked: 'Manual',
      expiresIn: 'Manual',
      destinationOptions: [
        { label: 'Profile post draft', value: 'profile-post-draft' },
        { label: 'Subreddit draft', value: 'subreddit-draft' }
      ],
      destination: 'profile-post-draft',
      selected: false
    },
    {
      id: 'medium',
      name: 'Medium',
      handle: '@graysonwills',
      mark: 'M',
      accentClass: 'medium',
      connectionState: 'connected',
      connectionLabel: 'Connected',
      connectionDetail: 'Draft publishing token is healthy.',
      lastChecked: '9 min ago',
      expiresIn: 'No expiry',
      destinationOptions: [
        { label: 'Excerpt draft', value: 'excerpt-draft' },
        { label: 'Canonical mirror draft', value: 'canonical-mirror-draft' }
      ],
      destination: 'excerpt-draft',
      selected: false
    },
    {
      id: 'tumblr',
      name: 'Tumblr',
      handle: 'graysonwills',
      mark: 'T',
      accentClass: 'tumblr',
      connectionState: 'connected',
      connectionLabel: 'Connected',
      connectionDetail: 'Blog token is healthy.',
      lastChecked: '9 min ago',
      expiresIn: 'No expiry',
      destinationOptions: [
        { label: 'Text post', value: 'text-post' },
        { label: 'Link post', value: 'link-post' }
      ],
      destination: 'link-post',
      selected: false
    },
    {
      id: 'discord',
      name: 'Discord',
      handle: '#announcements',
      mark: 'D',
      accentClass: 'discord',
      connectionState: 'connected',
      connectionLabel: 'Connected',
      connectionDetail: 'Announcement webhook is available.',
      lastChecked: '2 min ago',
      expiresIn: 'Webhook',
      destinationOptions: [
        { label: 'Announcement channel', value: 'announcement-channel' },
        { label: 'Private archive', value: 'private-archive' }
      ],
      destination: 'announcement-channel',
      selected: true
    },
    {
      id: 'substack',
      name: 'Substack',
      handle: 'graysonwills.substack.com',
      mark: 'S',
      accentClass: 'substack',
      connectionState: 'manual',
      connectionLabel: 'Evaluate',
      connectionDetail: 'No official posting connector is configured.',
      lastChecked: 'Manual',
      expiresIn: 'Manual',
      destinationOptions: [
        { label: 'Note draft', value: 'note-draft' },
        { label: 'Newsletter mention', value: 'newsletter-mention' }
      ],
      destination: 'note-draft',
      selected: false,
      disabled: true
    }
  ];

  queueItems: QueueItem[] = [
    {
      postTitle: 'Building for expression, not reaction',
      platform: 'Bluesky',
      platformClass: 'bluesky',
      destination: 'Post',
      runAt: 'Jun 18, 9:00 AM',
      status: 'Ready',
      statusClass: 'success',
      receipt: 'Delivery receipt only'
    },
    {
      postTitle: 'Building for expression, not reaction',
      platform: 'LinkedIn',
      platformClass: 'linkedin',
      destination: 'Personal update',
      runAt: 'Jun 18, 9:01 AM',
      status: 'Queued',
      statusClass: 'info',
      receipt: 'Awaiting connector'
    },
    {
      postTitle: 'Building for expression, not reaction',
      platform: 'Instagram',
      platformClass: 'instagram',
      destination: 'Story',
      runAt: 'Jun 18, 9:02 AM',
      status: 'Review',
      statusClass: 'warn',
      receipt: 'Media/caption check'
    },
    {
      postTitle: 'Building for expression, not reaction',
      platform: 'X / Twitter',
      platformClass: 'x',
      destination: 'Single post',
      runAt: 'Jun 18, 9:03 AM',
      status: 'Needs login',
      statusClass: 'danger',
      receipt: 'Reconnect account'
    }
  ];

  constructor(
    private readonly router: Router,
    private readonly authService: AuthService
  ) {}

  get selectedPlatforms(): DistributionPlatform[] {
    return this.platforms.filter((platform) => platform.selected && !platform.disabled);
  }

  get connectedCount(): number {
    return this.platforms.filter((platform) => this.platformIsConnected(platform)).length;
  }

  get needsLoginCount(): number {
    return this.platforms.filter((platform) => platform.connectionState === 'expired' || platform.connectionState === 'not-connected').length;
  }

  get mediaCheckCount(): number {
    return this.platforms.filter((platform) => platform.connectionState === 'attention').length;
  }

  togglePlatform(platform: DistributionPlatform): void {
    if (platform.disabled) return;
    platform.selected = !platform.selected;
  }

  connectPlatform(platform: DistributionPlatform): void {
    if (platform.disabled) return;
    platform.connectionState = 'connected';
    platform.connectionLabel = 'Connected';
    platform.connectionDetail = 'Connection marked healthy for this schedule draft.';
    platform.lastChecked = 'Just now';
    platform.expiresIn = 'Pending token sync';
  }

  disconnectPlatform(platform: DistributionPlatform): void {
    if (platform.disabled) return;
    platform.connectionState = 'not-connected';
    platform.connectionLabel = 'Not connected';
    platform.connectionDetail = 'Reconnect before this platform can post.';
    platform.lastChecked = 'Just now';
    platform.expiresIn = 'No token';
    platform.selected = false;
  }

  refreshConnections(): void {
    for (const platform of this.platforms) {
      if (!platform.disabled && platform.connectionState !== 'manual') {
        platform.lastChecked = 'Just now';
      }
    }
    this.draftNotice = 'Connection statuses refreshed for this workspace view.';
  }

  scheduleSelectedTargets(): void {
    const selected = this.selectedPlatforms;

    if (!selected.length) {
      this.draftNotice = 'Select at least one social destination before scheduling.';
      return;
    }

    this.queueItems = selected.map((platform, index) => {
      const destination = this.getSelectedDestinationLabel(platform);
      const mediaRequired = this.destinationNeedsMedia(platform);
      const missingLogin = platform.connectionState === 'expired' || platform.connectionState === 'not-connected';
      const manualReview = platform.connectionState === 'manual';
      const missingMedia = mediaRequired && !this.mediaBrief.trim();
      const status = this.getDraftStatus(platform, missingLogin, missingMedia, manualReview);

      return {
        postTitle: this.selectedPostTitle,
        platform: platform.name,
        platformClass: platform.accentClass,
        destination,
        runAt: this.formatPublishTime(index),
        status: status.label,
        statusClass: status.severity,
        receipt: status.receipt
      };
    });

    this.draftNotice = `${selected.length} distribution ${selected.length === 1 ? 'target' : 'targets'} staged for ${this.formatPublishTime(0)}.`;
  }

  getConnectionSeverity(state: PlatformConnectionState): QueueStatusClass {
    if (state === 'connected') return 'success';
    if (state === 'attention') return 'warn';
    if (state === 'expired' || state === 'not-connected') return 'danger';
    return 'secondary';
  }

  platformIsConnected(platform: DistributionPlatform): boolean {
    return platform.connectionState === 'connected' || platform.connectionState === 'attention';
  }

  destinationNeedsMedia(platform: DistributionPlatform): boolean {
    return Boolean(platform.destinationOptions.find((option) => option.value === platform.destination)?.requiresMedia);
  }

  getSelectedDestinationLabel(platform: DistributionPlatform): string {
    return platform.destinationOptions.find((option) => option.value === platform.destination)?.label || 'Post';
  }

  getTargetReadiness(platform: DistributionPlatform): string {
    if (platform.disabled) return 'Connector unavailable';
    if (platform.connectionState === 'expired') return 'Reconnect before posting';
    if (platform.connectionState === 'not-connected') return 'Connect before posting';
    if (platform.connectionState === 'manual') return 'Manual draft only';
    if (this.destinationNeedsMedia(platform) && !this.mediaBrief.trim()) return 'Add media before scheduling';
    if (platform.connectionState === 'attention') return 'Ready after media review';
    return 'Ready to queue';
  }

  getStateClass(platform: DistributionPlatform): string {
    return platform.connectionState;
  }

  getPlatformSummary(platform: DistributionPlatform): string {
    if (platform.connectionState === 'connected') return `${this.getSelectedDestinationLabel(platform)} is available.`;
    if (platform.connectionState === 'attention') return `${this.getSelectedDestinationLabel(platform)} needs media review.`;
    if (platform.connectionState === 'expired') return 'Login expired before posting.';
    if (platform.connectionState === 'not-connected') return 'Account is not connected.';
    return 'Manual workflow only.';
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
    return `${item.postTitle}:${item.platform}:${item.destination}:${index}`;
  }

  private getDraftStatus(
    platform: DistributionPlatform,
    missingLogin: boolean,
    missingMedia: boolean,
    manualReview: boolean
  ): { label: string; severity: QueueStatusClass; receipt: string } {
    if (missingLogin) {
      return { label: 'Needs login', severity: 'danger', receipt: 'Reconnect account' };
    }

    if (missingMedia) {
      return { label: 'Needs media', severity: 'warn', receipt: 'Media required' };
    }

    if (manualReview) {
      return { label: 'Manual draft', severity: 'secondary', receipt: 'Review before posting' };
    }

    if (platform.connectionState === 'attention') {
      return { label: 'Review', severity: 'warn', receipt: 'Media/caption check' };
    }

    return { label: 'Queued', severity: 'info', receipt: 'Delivery receipt only' };
  }

  private formatPublishTime(offsetMinutes: number): string {
    const date = new Date(this.publishTime);

    if (!Number.isNaN(date.getTime())) {
      date.setMinutes(date.getMinutes() + offsetMinutes);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }

    if (offsetMinutes <= 0) return this.publishTime;
    return `${this.publishTime} + ${offsetMinutes}m`;
  }
}
