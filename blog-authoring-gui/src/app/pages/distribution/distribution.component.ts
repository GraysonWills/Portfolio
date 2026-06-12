import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BlogApiService, SocialAuthProviderStatus } from '../../services/blog-api.service';
import {
  SocialAutomationPreview,
  SocialAutomationRule,
  SocialAutomationTrigger,
  SocialDistributionAutomationService,
  SocialDistributionTemplate
} from '../../services/social-distribution-automation.service';

type PlatformConnectionState = 'connected' | 'attention' | 'expired' | 'not-connected' | 'manual';
type QueueStatusClass = 'success' | 'info' | 'warn' | 'danger' | 'secondary';
type DistributionWorkspaceTab = 'connections' | 'templates' | 'rules' | 'composer' | 'queue';

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
export class DistributionComponent implements OnInit {
  private readonly oauthProviderIds = new Set(['facebook', 'x', 'linkedin', 'instagram']);
  private oauthReturnNoticeActive = false;

  activeWorkspaceTab: DistributionWorkspaceTab = 'connections';
  masterCaption = 'New essay is live: building for expression, not reaction. A note on keeping the work honest, shipping publicly, and leaving the metrics outside the room.';
  publishTime = '2026-06-18T09:00';
  selectedPostTitle = 'Building for expression, not reaction';
  postUrl = 'https://www.grayson-wills.com/blog/expression-not-reaction';
  hashtagText = '#writing #creativepractice #buildinpublic';
  mediaBrief = 'Use the blog cover image, cropped square for feeds and vertical for stories.';
  postCategory = 'Creative Practice';
  readingTime = '5 min read';
  coverImageUrl = 'Use blog cover image';
  draftNotice = 'No scheduled changes yet.';
  socialAuthLoading = false;
  socialAuthError = '';
  automationNotice = 'Automation rules are ready for the next publish event.';
  automationTemplates: SocialDistributionTemplate[] = [];
  automationRules: SocialAutomationRule[] = [];
  selectedTemplateId = '';
  automationPreviewTrigger: SocialAutomationTrigger = 'blog_published';

  readonly workspaceTabs: { id: DistributionWorkspaceTab; label: string; icon: string }[] = [
    { id: 'connections', label: 'Connections', icon: 'pi-link' },
    { id: 'templates', label: 'Templates', icon: 'pi-file-edit' },
    { id: 'rules', label: 'Rules', icon: 'pi-sitemap' },
    { id: 'composer', label: 'Composer', icon: 'pi-pencil' },
    { id: 'queue', label: 'Queue', icon: 'pi-list-check' }
  ];

  readonly triggerOptions: { label: string; value: SocialAutomationTrigger }[] = [
    { label: 'Blog is published', value: 'blog_published' },
    { label: 'Blog is scheduled', value: 'blog_scheduled' },
    { label: 'Manual review', value: 'manual_review' }
  ];

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
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly authService: AuthService,
    private readonly blogApi: BlogApiService,
    private readonly automation: SocialDistributionAutomationService
  ) {}

  ngOnInit(): void {
    this.loadAutomationSettings();
    this.applyWorkspaceTabFromRoute();
    this.initializeConnectionDefaults();
    this.refreshConnections();
    this.applyOAuthReturnNotice();
  }

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

  get activeAutomationRules(): SocialAutomationRule[] {
    return this.automationRules.filter((rule) => rule.enabled);
  }

  get publishAutomationCount(): number {
    return this.automationRules
      .filter((rule) => rule.enabled && rule.trigger === 'blog_published')
      .reduce((sum, rule) => sum + rule.platformIds.length, 0);
  }

  get selectedTemplate(): SocialDistributionTemplate | null {
    return this.automationTemplates.find((template) => template.id === this.selectedTemplateId) || null;
  }

  get automationVariables(): string[] {
    return this.automation.templateVariables;
  }

  setWorkspaceTab(tab: DistributionWorkspaceTab): void {
    this.activeWorkspaceTab = tab;
  }

  selectAutomationTemplate(template: SocialDistributionTemplate): void {
    this.selectedTemplateId = template.id;
  }

  createAutomationTemplate(): void {
    const platform = this.platforms.find((candidate) => this.platformCanUseOAuth(candidate)) || this.platforms[0];
    const template: SocialDistributionTemplate = {
      id: `template-${Date.now()}`,
      name: 'New publish template',
      platformId: platform?.id || 'all',
      destination: platform ? this.getSelectedDestinationLabel(platform) : 'Feed post',
      body: 'New post: {{title}}\n\n{{summary}}\n\n{{url}}',
      hashtags: '{{tags}}',
      useCoverImage: true
    };

    this.automationTemplates = [...this.automationTemplates, template];
    this.selectedTemplateId = template.id;
    this.automationNotice = 'Template created. Adjust the copy and save automation settings.';
  }

  duplicateSelectedTemplate(): void {
    const selected = this.selectedTemplate;
    if (!selected) return;

    const copy: SocialDistributionTemplate = {
      ...selected,
      id: `template-${Date.now()}`,
      name: `${selected.name} copy`
    };
    this.automationTemplates = [...this.automationTemplates, copy];
    this.selectedTemplateId = copy.id;
    this.automationNotice = 'Template duplicated. Save when the copy is ready.';
  }

  saveAutomationSettings(): void {
    this.automation.saveSettings({
      templates: this.automationTemplates,
      rules: this.automationRules
    });
    this.automationNotice = 'Automation templates and rules saved.';
  }

  resetAutomationSettings(): void {
    const defaults = this.automation.resetSettings();
    this.automationTemplates = defaults.templates;
    this.automationRules = defaults.rules;
    this.selectedTemplateId = this.automationTemplates[0]?.id || '';
    this.automationNotice = 'Automation templates and rules reset to defaults.';
  }

  insertTemplateVariable(variable: string): void {
    const template = this.selectedTemplate;
    if (!template) return;
    const token = `{{${variable}}}`;
    const spacer = template.body.trim() ? '\n' : '';
    template.body = `${template.body}${spacer}${token}`;
  }

  addAutomationRule(): void {
    const templateId = this.selectedTemplateId || this.automationTemplates[0]?.id || '';
    const rule: SocialAutomationRule = {
      id: `rule-${Date.now()}`,
      name: 'New publish rule',
      trigger: 'blog_published',
      enabled: true,
      templateId,
      platformIds: ['x'],
      delayMinutes: 0,
      requiresReview: true,
      quietMode: true
    };

    this.automationRules = [...this.automationRules, rule];
    this.activeWorkspaceTab = 'rules';
    this.automationNotice = 'Rule created. Choose destinations, timing, and review behavior.';
  }

  deleteAutomationRule(rule: SocialAutomationRule): void {
    this.automationRules = this.automationRules.filter((candidate) => candidate.id !== rule.id);
    this.automationNotice = `${rule.name} removed. Save automation settings to persist the change.`;
  }

  toggleRulePlatform(rule: SocialAutomationRule, platformId: string): void {
    const existing = new Set(rule.platformIds);
    if (existing.has(platformId)) {
      existing.delete(platformId);
    } else {
      existing.add(platformId);
    }
    rule.platformIds = Array.from(existing);
  }

  ruleUsesPlatform(rule: SocialAutomationRule, platformId: string): boolean {
    return rule.platformIds.includes(platformId);
  }

  getTemplatePlatformLabel(template: SocialDistributionTemplate): string {
    if (template.platformId === 'all') return 'All platforms';
    return this.getPlatformName(template.platformId);
  }

  getPlatformName(platformId: string): string {
    return this.platforms.find((platform) => platform.id === platformId)?.name || platformId;
  }

  getTemplateName(templateId: string): string {
    return this.automationTemplates.find((template) => template.id === templateId)?.name || 'Missing template';
  }

  getTriggerLabel(trigger: SocialAutomationTrigger): string {
    return this.triggerOptions.find((option) => option.value === trigger)?.label || 'Blog is published';
  }

  getAutomationPreviews(trigger: SocialAutomationTrigger = this.automationPreviewTrigger): SocialAutomationPreview[] {
    return this.automation.buildPreviews(
      { templates: this.automationTemplates, rules: this.automationRules },
      this.buildAutomationContext(),
      trigger,
      this.getAutomationBaseDate()
    );
  }

  getSelectedTemplatePreview(): string {
    const template = this.selectedTemplate;
    if (!template) return '';
    return this.automation.renderTemplate(template, this.buildAutomationContext());
  }

  queueAutomationRules(): void {
    const previews = this.getAutomationPreviews(this.automationPreviewTrigger);
    if (!previews.length) {
      this.automationNotice = 'No enabled automation rules match this trigger yet.';
      return;
    }

    this.queueItems = previews.map((preview) => {
      const platform = this.platforms.find((candidate) => candidate.id === preview.platformId);
      const missingLogin = !platform || platform.connectionState === 'expired' || platform.connectionState === 'not-connected';
      const manualReview = !platform || platform.connectionState === 'manual' || preview.requiresReview;
      const missingMedia = preview.usesCoverImage && !this.coverImageUrl.trim();
      const status = this.getDraftStatus(platform, missingLogin, missingMedia, manualReview);

      return {
        postTitle: this.selectedPostTitle,
        platform: platform?.name || preview.platformId,
        platformClass: platform?.accentClass || 'secondary',
        destination: preview.destination,
        runAt: this.formatDateTime(preview.runAt),
        status: status.label,
        statusClass: status.severity,
        receipt: preview.quietMode ? status.receipt : 'Delivery receipt'
      };
    });

    this.activeWorkspaceTab = 'queue';
    this.automationNotice = `${previews.length} automated ${previews.length === 1 ? 'post' : 'posts'} staged from ${this.getTriggerLabel(this.automationPreviewTrigger).toLowerCase()}.`;
  }

  formatPreviewRunAt(preview: SocialAutomationPreview): string {
    return this.formatDateTime(preview.runAt);
  }

  togglePlatform(platform: DistributionPlatform): void {
    if (platform.disabled) return;
    platform.selected = !platform.selected;
  }

  connectPlatform(platform: DistributionPlatform): void {
    if (platform.disabled) return;
    if (!this.platformCanUseOAuth(platform)) {
      this.draftNotice = `${platform.name} does not have an OAuth connector wired yet.`;
      return;
    }

    this.socialAuthLoading = true;
    this.socialAuthError = '';
    this.blogApi.startSocialAuth(platform.id, window.location.href.split('?')[0]).subscribe({
      next: (response) => {
        if (response?.authUrl) {
          window.location.assign(response.authUrl);
          return;
        }
        this.socialAuthLoading = false;
        this.socialAuthError = `${platform.name} did not return an authorization URL.`;
      },
      error: (err) => {
        this.socialAuthLoading = false;
        const message = this.extractErrorMessage(err);
        this.socialAuthError = message;
        platform.connectionState = 'not-connected';
        platform.connectionLabel = 'Setup needed';
        platform.connectionDetail = message;
        platform.lastChecked = 'Just now';
        platform.expiresIn = 'No token';
      }
    });
  }

  disconnectPlatform(platform: DistributionPlatform): void {
    if (platform.disabled) return;
    if (!this.platformCanUseOAuth(platform)) {
      platform.connectionState = 'manual';
      platform.connectionLabel = 'Manual';
      platform.connectionDetail = 'This connector is not wired for OAuth yet.';
      platform.lastChecked = 'Manual';
      platform.expiresIn = 'Manual';
      platform.selected = false;
      return;
    }

    this.socialAuthLoading = true;
    this.socialAuthError = '';
    this.blogApi.disconnectSocialAuth(platform.id).subscribe({
      next: () => {
        this.socialAuthLoading = false;
        platform.connectionState = 'not-connected';
        platform.connectionLabel = 'Not connected';
        platform.connectionDetail = 'Reconnect before this platform can post.';
        platform.lastChecked = 'Just now';
        platform.expiresIn = 'No token';
        platform.selected = false;
      },
      error: (err) => {
        this.socialAuthLoading = false;
        this.socialAuthError = this.extractErrorMessage(err);
      }
    });
  }

  refreshConnections(): void {
    this.socialAuthLoading = true;
    this.socialAuthError = '';
    this.blogApi.getSocialAuthStatus().subscribe({
      next: (response) => {
        this.socialAuthLoading = false;
        const statuses = response?.providers || [];
        statuses.forEach((status) => this.applyProviderStatus(status));
        for (const platform of this.platforms) {
          if (!this.platformCanUseOAuth(platform) && !platform.disabled) {
            platform.connectionState = 'manual';
            platform.connectionLabel = 'Future connector';
            platform.connectionDetail = 'OAuth is not wired for this platform yet.';
            platform.lastChecked = 'Manual';
            platform.expiresIn = 'Manual';
          }
        }
        if (this.oauthReturnNoticeActive) {
          this.oauthReturnNoticeActive = false;
        } else {
          this.draftNotice = 'Connection statuses refreshed.';
        }
      },
      error: (err) => {
        this.socialAuthLoading = false;
        this.applyOAuthStatusFallback();
        if (this.oauthReturnNoticeActive) {
          this.oauthReturnNoticeActive = false;
          return;
        }
        this.socialAuthError = this.extractErrorMessage(err);
        this.draftNotice = 'Could not refresh live OAuth status. Showing local setup defaults.';
      }
    });
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
    if (!this.platformCanUseOAuth(platform) && platform.connectionState === 'manual') return 'Future connector';
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

  platformCanUseOAuth(platform: DistributionPlatform): boolean {
    return this.oauthProviderIds.has(platform.id);
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

  trackByTemplate(index: number, template: SocialDistributionTemplate): string {
    return template.id || `${index}`;
  }

  trackByRule(index: number, rule: SocialAutomationRule): string {
    return rule.id || `${index}`;
  }

  trackByPreview(index: number, preview: SocialAutomationPreview): string {
    return `${preview.ruleId}:${preview.platformId}:${index}`;
  }

  private loadAutomationSettings(): void {
    const settings = this.automation.loadSettings();
    this.automationTemplates = settings.templates;
    this.automationRules = settings.rules;
    this.selectedTemplateId = this.automationTemplates[0]?.id || '';
  }

  private applyWorkspaceTabFromRoute(): void {
    const tab = String(this.route.snapshot.queryParamMap.get('distributionTab') || '').trim();
    if (this.workspaceTabs.some((candidate) => candidate.id === tab)) {
      this.activeWorkspaceTab = tab as DistributionWorkspaceTab;
    }
  }

  private getDraftStatus(
    platform: DistributionPlatform | undefined,
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

    if (platform?.connectionState === 'attention') {
      return { label: 'Review', severity: 'warn', receipt: 'Media/caption check' };
    }

    return { label: 'Queued', severity: 'info', receipt: 'Delivery receipt only' };
  }

  private buildAutomationContext() {
    const publishDate = this.getAutomationBaseDate();
    return {
      title: this.selectedPostTitle,
      summary: this.masterCaption,
      url: this.postUrl,
      category: this.postCategory,
      tags: this.hashtagText,
      publishedDate: this.formatDateTime(publishDate),
      readingTime: this.readingTime,
      coverImage: this.coverImageUrl
    };
  }

  private getAutomationBaseDate(): Date {
    const date = new Date(this.publishTime);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private formatDateTime(date: Date): string {
    if (Number.isNaN(date.getTime())) return 'Not scheduled';
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
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

  private initializeConnectionDefaults(): void {
    for (const platform of this.platforms) {
      if (this.platformCanUseOAuth(platform)) {
        platform.connectionState = 'not-connected';
        platform.connectionLabel = 'Checking';
        platform.connectionDetail = `Checking ${platform.name} OAuth status from the backend.`;
        platform.lastChecked = 'Pending';
        platform.expiresIn = 'Pending';
        platform.selected = false;
        continue;
      }

      platform.connectionState = 'manual';
      platform.connectionLabel = platform.disabled ? 'Evaluate' : 'Future connector';
      platform.connectionDetail = platform.disabled
        ? 'No official connector is configured yet.'
        : 'OAuth is not wired for this platform yet.';
      platform.lastChecked = 'Manual';
      platform.expiresIn = 'Manual';
      platform.selected = false;
    }
  }

  private applyProviderStatus(status: SocialAuthProviderStatus): void {
    const platform = this.platforms.find((candidate) => candidate.id === status.provider);
    if (!platform) return;

    platform.handle = status.accountLabel || platform.handle;
    platform.lastChecked = 'Just now';
    platform.expiresIn = this.formatConnectionExpiry(status);

    if (!status.configured) {
      platform.connectionState = 'not-connected';
      platform.connectionLabel = 'Setup needed';
      platform.connectionDetail = `${platform.name} app credentials are not configured in the backend yet.`;
      platform.selected = false;
      return;
    }

    if (status.connected) {
      platform.connectionState = 'connected';
      platform.connectionLabel = 'Connected';
      platform.connectionDetail = this.formatCredentialArtifacts(platform.name, status);
      return;
    }

    if (status.status === 'expired') {
      platform.connectionState = 'expired';
      platform.connectionLabel = 'Login needed';
      platform.connectionDetail = `${platform.name} token expired. Reconnect before scheduling posts.`;
      platform.selected = false;
      return;
    }

    platform.connectionState = 'not-connected';
    platform.connectionLabel = 'Not connected';
    platform.connectionDetail = `Connect ${platform.name} to enable API posting.`;
    platform.selected = false;
  }

  private applyOAuthStatusFallback(): void {
    for (const platform of this.platforms) {
      if (!this.platformCanUseOAuth(platform)) continue;
      platform.connectionState = 'not-connected';
      platform.connectionLabel = 'Not connected';
      platform.connectionDetail = `Could not refresh ${platform.name} status from the backend.`;
      platform.lastChecked = 'Local fallback';
      platform.expiresIn = 'Unknown';
      platform.selected = false;
    }
  }

  private formatConnectionExpiry(status: SocialAuthProviderStatus): string {
    if (!status.configured) return 'Missing app setup';
    if (!status.expiresAt) return status.connected ? 'No expiry reported' : 'No token';
    const expiresAt = new Date(status.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) return 'No expiry reported';
    const diffMs = expiresAt.getTime() - Date.now();
    if (diffMs <= 0) return 'Expired';
    const days = Math.max(1, Math.ceil(diffMs / 86_400_000));
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }

  private formatCredentialArtifacts(platformName: string, status: SocialAuthProviderStatus): string {
    const artifacts = status.credentialArtifacts;
    const captured = [
      artifacts?.hasAccessToken ? 'access token' : '',
      artifacts?.hasRefreshToken ? 'refresh token' : '',
      artifacts?.hasIdToken ? 'identity token' : ''
    ].filter(Boolean);

    if (!captured.length) {
      return `${platformName} OAuth credential is stored and ready for API posting.`;
    }

    return `${platformName} login captured ${captured.join(', ')} for backend posting.`;
  }

  private applyOAuthReturnNotice(): void {
    const provider = String(this.route.snapshot.queryParamMap.get('socialProvider') || '').trim();
    const status = String(this.route.snapshot.queryParamMap.get('socialStatus') || '').trim();
    const error = String(this.route.snapshot.queryParamMap.get('socialError') || '').trim();
    if (!provider || !status) return;

    this.oauthReturnNoticeActive = true;
    if (status === 'error') {
      this.socialAuthError = error || `${provider} connection failed.`;
      this.draftNotice = `${provider} connection failed.`;
    } else {
      this.draftNotice = `${provider} ${status === 'connected' ? 'connected' : status}.`;
    }

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        socialProvider: null,
        socialStatus: null,
        socialError: null
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private extractErrorMessage(err: unknown): string {
    const anyErr = err as { error?: { error?: string; message?: string }; message?: string };
    return anyErr?.error?.error || anyErr?.error?.message || anyErr?.message || 'Social auth request failed.';
  }
}
