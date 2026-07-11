import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import {
  BlogApiService,
  SocialAuthAccount,
  SocialAuthProviderStatus,
  SocialDistributionDelivery
} from '../../services/blog-api.service';
import {
  SocialAutomationPreview,
  SocialAutomationRule,
  SocialAutomationTrigger,
  SocialDistributionAutomationService,
  SocialDistributionTemplate
} from '../../services/social-distribution-automation.service';
import { NativePlatformService } from '../../services/native-platform.service';

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
  deliveryId?: string;
  postTitle: string;
  platform: string;
  platformClass: string;
  destination: string;
  runAt: string;
  status: string;
  statusClass: QueueStatusClass;
  receipt: string;
  caption?: string;
  error?: string;
  canSend?: boolean;
  canDelete?: boolean;
};

@Component({
  selector: 'app-distribution',
  templateUrl: './distribution.component.html',
  styleUrl: './distribution.component.scss',
  standalone: false
})
export class DistributionComponent implements OnInit, OnDestroy {
  private readonly oauthProviderIds = new Set([
    'facebook',
    'x',
    'linkedin',
    'instagram',
    'threads',
    'tiktok',
    'reddit',
    'pinterest',
    'mastodon',
    'tumblr',
    'google'
  ]);
  private readonly webhookProviderIds = new Set(['discord']);
  private readonly manualImportProviderIds = new Set(['medium']);
  private readonly tokenImportProviderIds = new Set(['instagram', 'threads', 'mastodon']);
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
  socialAccountsLoading = false;
  tokenImportProviderId = '';
  tokenImportValue = '';
  tokenImportInstanceUrl = '';
  tokenImportLoading = false;
  deliveryLoading = false;
  deliveryError = '';
  automationNotice = 'Automation rules are ready for the next publish event.';
  automationTemplates: SocialDistributionTemplate[] = [];
  automationRules: SocialAutomationRule[] = [];
  selectedTemplateId = '';
  automationPreviewTrigger: SocialAutomationTrigger = 'blog_published';
  accountsByProvider: Record<string, SocialAuthAccount[]> = {};
  selectedAccountIds: Record<string, string> = {};
  accountLoadAttemptedByProvider: Record<string, boolean> = {};
  deliveryItems: SocialDistributionDelivery[] = [];

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
      connectionLabel: 'Creator auth',
      connectionDetail: 'Connect your Instagram creator account directly for API publishing.',
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
      id: 'google',
      name: 'Google APIs',
      handle: 'No account selected',
      mark: 'G',
      accentClass: 'google',
      connectionState: 'not-connected',
      connectionLabel: 'Not connected',
      connectionDetail: 'Connect Google OAuth for Gmail, YouTube, Ads, Analytics, and Drive automations.',
      lastChecked: 'Not checked',
      expiresIn: 'No token',
      destinationOptions: [
        { label: 'Gmail reply draft', value: 'gmail-reply-draft' },
        { label: 'YouTube upload', value: 'youtube-upload', requiresMedia: true },
        { label: 'Marketing report', value: 'marketing-report' }
      ],
      destination: 'gmail-reply-draft',
      selected: false
    },
    {
      id: 'youtube',
      name: 'YouTube',
      handle: '@graysonwills',
      mark: 'YT',
      accentClass: 'youtube',
      connectionState: 'manual',
      connectionLabel: 'Uses Google',
      connectionDetail: 'Connect Google APIs first; YouTube upload automation will use that credential.',
      lastChecked: 'Manual',
      expiresIn: 'Manual',
      destinationOptions: [
        { label: 'Community post', value: 'community-post' },
        { label: 'Short description', value: 'short-description', requiresMedia: true },
        { label: 'Video description', value: 'video-description' }
      ],
      destination: 'community-post',
      selected: false,
      disabled: true
    },
    {
      id: 'threads',
      name: 'Threads',
      handle: 'No account selected',
      mark: 'TH',
      accentClass: 'threads',
      connectionState: 'not-connected',
      connectionLabel: 'Not connected',
      connectionDetail: 'Connect Threads with OAuth or import a generated access token for API posting.',
      lastChecked: 'Not checked',
      expiresIn: 'No token',
      destinationOptions: [
        { label: 'Post', value: 'post' },
        { label: 'Image post', value: 'image-post', requiresMedia: true }
      ],
      destination: 'post',
      selected: false
    },
    {
      id: 'bluesky',
      name: 'Bluesky',
      handle: '@graysonwills.com',
      mark: 'BS',
      accentClass: 'bluesky',
      connectionState: 'manual',
      connectionLabel: 'Planned',
      connectionDetail: 'AT Protocol OAuth needs a dedicated connector before API posting.',
      lastChecked: 'Manual',
      expiresIn: 'Manual',
      destinationOptions: [
        { label: 'Post', value: 'post' }
      ],
      destination: 'post',
      selected: false,
      disabled: true
    },
    {
      id: 'mastodon',
      name: 'Mastodon',
      handle: 'No account selected',
      mark: 'M',
      accentClass: 'mastodon',
      connectionState: 'not-connected',
      connectionLabel: 'Not connected',
      connectionDetail: 'Connect Mastodon with OAuth or import a server access token for API posting.',
      lastChecked: 'Not checked',
      expiresIn: 'No token',
      destinationOptions: [
        { label: 'Post', value: 'post' },
        { label: 'Unlisted post', value: 'unlisted-post' }
      ],
      destination: 'post',
      selected: false
    },
    {
      id: 'pinterest',
      name: 'Pinterest',
      handle: 'No board selected',
      mark: 'P',
      accentClass: 'pinterest',
      connectionState: 'not-connected',
      connectionLabel: 'Not connected',
      connectionDetail: 'Connect Pinterest, then choose a board for pins.',
      lastChecked: 'Not checked',
      expiresIn: 'No token',
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
      handle: 'No account selected',
      mark: 'TT',
      accentClass: 'tiktok',
      connectionState: 'not-connected',
      connectionLabel: 'Not connected',
      connectionDetail: 'Connect TikTok after the app credentials are configured.',
      lastChecked: 'Not checked',
      expiresIn: 'No token',
      destinationOptions: [
        { label: 'Photo upload', value: 'photo-upload', requiresMedia: true },
        { label: 'Video upload', value: 'video-upload', requiresMedia: true }
      ],
      destination: 'photo-upload',
      selected: false
    },
    {
      id: 'reddit',
      name: 'Reddit',
      handle: 'No account selected',
      mark: 'R',
      accentClass: 'reddit',
      connectionState: 'not-connected',
      connectionLabel: 'Not connected',
      connectionDetail: 'Connect Reddit OAuth before profile or subreddit posts.',
      lastChecked: 'Not checked',
      expiresIn: 'No token',
      destinationOptions: [
        { label: 'Profile post', value: 'profile-post' },
        { label: 'Subreddit post', value: 'subreddit-post' }
      ],
      destination: 'profile-post',
      selected: false
    },
    {
      id: 'medium',
      name: 'Medium',
      handle: 'medium.com',
      mark: 'M',
      accentClass: 'medium',
      connectionState: 'manual',
      connectionLabel: 'Manual import',
      connectionDetail: 'Medium no longer accepts new API integrations. Import the published blog URL manually.',
      lastChecked: 'Manual workflow',
      expiresIn: 'No OAuth',
      destinationOptions: [
        { label: 'Import published story', value: 'manual-import' }
      ],
      destination: 'manual-import',
      selected: false
    },
    {
      id: 'tumblr',
      name: 'Tumblr',
      handle: 'No blog selected',
      mark: 'T',
      accentClass: 'tumblr',
      connectionState: 'not-connected',
      connectionLabel: 'Not connected',
      connectionDetail: 'Connect Tumblr, then choose the blog to post to.',
      lastChecked: 'Not checked',
      expiresIn: 'No token',
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
      connectionState: 'manual',
      connectionLabel: 'Webhook',
      connectionDetail: 'Uses the server-side Discord webhook URL when configured.',
      lastChecked: 'Manual',
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

  queueItems: QueueItem[] = [];
  private oauthReturnSubscription: Subscription | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly authService: AuthService,
    private readonly blogApi: BlogApiService,
    private readonly automation: SocialDistributionAutomationService,
    private readonly nativePlatform: NativePlatformService
  ) {}

  ngOnInit(): void {
    this.loadAutomationSettings();
    this.applyWorkspaceTabFromRoute();
    this.initializeConnectionDefaults();
    this.refreshConnections();
    this.refreshDeliveries();
    let initialQueryEmission = true;
    this.oauthReturnSubscription = this.route.queryParamMap.subscribe((params) => {
      const handled = this.applyOAuthReturnNotice(params);
      if (!initialQueryEmission && handled) this.refreshConnections();
      initialQueryEmission = false;
    });
  }

  ngOnDestroy(): void {
    this.oauthReturnSubscription?.unsubscribe();
    this.oauthReturnSubscription = null;
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
    const settings = {
      templates: this.automationTemplates,
      rules: this.automationRules
    };
    this.automation.saveSettings(settings);
    this.blogApi.saveSocialDistributionSettings(settings).subscribe({
      next: (saved) => {
        this.automationTemplates = saved.templates;
        this.automationRules = saved.rules;
        this.automation.saveSettings(saved);
        this.automationNotice = 'Automation templates and rules saved to the backend.';
      },
      error: (err) => {
        this.automationNotice = `Saved locally, but backend save failed: ${this.extractErrorMessage(err)}`;
      }
    });
  }

  resetAutomationSettings(): void {
    const defaults = this.automation.resetSettings();
    this.automationTemplates = defaults.templates;
    this.automationRules = defaults.rules;
    this.selectedTemplateId = this.automationTemplates[0]?.id || '';
    this.blogApi.saveSocialDistributionSettings(defaults).subscribe({
      next: () => {
        this.automationNotice = 'Automation templates and rules reset to defaults.';
      },
      error: (err) => {
        this.automationNotice = `Defaults restored locally, but backend save failed: ${this.extractErrorMessage(err)}`;
      }
    });
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
    const browserReturnUrl = window.location.href.split('?')[0];
    const returnUrl = this.nativePlatform.getSocialOAuthReturnUrl(browserReturnUrl);
    this.blogApi.startSocialAuth(platform.id, returnUrl).subscribe({
      next: (response) => {
        if (response?.authUrl) {
          void this.nativePlatform.openExternalAuth(response.authUrl).catch((error) => {
            this.socialAuthLoading = false;
            this.socialAuthError = this.extractErrorMessage(error);
          });
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

  platformUsesManualImport(platform: DistributionPlatform): boolean {
    return this.manualImportProviderIds.has(platform.id);
  }

  copyMediumImportUrl(): void {
    const url = this.postUrl.trim();
    if (!url) {
      this.draftNotice = 'Add the published blog URL before copying it for Medium.';
      return;
    }

    if (!navigator.clipboard?.writeText) {
      this.draftNotice = 'Clipboard access is unavailable. Use the canonical link from the Composer.';
      return;
    }

    navigator.clipboard.writeText(url).then(() => {
      this.draftNotice = 'Blog URL copied for Medium import.';
    }).catch(() => {
      this.draftNotice = 'Could not copy the URL. Use the canonical link from the Composer.';
    });
  }

  openMediumImport(): void {
    void this.nativePlatform.openExternalUrl('https://medium.com/p/import');
    this.draftNotice = 'Medium import opened. Paste the published blog URL to create the canonical copy.';
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

  canImportAccessToken(platform: DistributionPlatform): boolean {
    return this.tokenImportProviderIds.has(platform.id);
  }

  openTokenImport(platform: DistributionPlatform): void {
    this.tokenImportProviderId = platform.id;
    this.tokenImportValue = '';
    this.tokenImportInstanceUrl = platform.id === 'mastodon' ? 'https://mastodon.social' : '';
    this.socialAuthError = '';
  }

  cancelTokenImport(): void {
    this.tokenImportProviderId = '';
    this.tokenImportValue = '';
    this.tokenImportInstanceUrl = '';
    this.tokenImportLoading = false;
  }

  importPlatformToken(platform: DistributionPlatform): void {
    const accessToken = this.tokenImportValue.trim();
    if (!accessToken) {
      this.socialAuthError = `Paste a ${platform.name} access token first.`;
      return;
    }

    const instanceUrl = this.tokenImportInstanceUrl.trim();
    if (platform.id === 'mastodon' && !instanceUrl) {
      this.socialAuthError = 'Add the Mastodon instance URL for this token.';
      return;
    }

    this.tokenImportLoading = true;
    this.socialAuthError = '';
    this.blogApi.importSocialAuthToken(platform.id, accessToken, { instanceUrl }).subscribe({
      next: (response) => {
        this.tokenImportLoading = false;
        this.tokenImportProviderId = '';
        this.tokenImportValue = '';
        this.tokenImportInstanceUrl = '';
        const account = response.selectedAccount;
        platform.handle = account?.handle || account?.label || platform.handle;
        platform.connectionState = 'connected';
        platform.connectionLabel = 'Connected';
        platform.connectionDetail = `${account?.label || platform.name} is selected from imported token.`;
        platform.lastChecked = 'Just now';
        platform.expiresIn = response.expiresAt ? this.formatExpiresAt(response.expiresAt) : 'Token imported';
        this.draftNotice = `${platform.name} token imported and encrypted.`;
        this.refreshConnections();
      },
      error: (err) => {
        this.tokenImportLoading = false;
        this.socialAuthError = this.extractErrorMessage(err);
      }
    });
  }

  tokenImportNeedsInstance(platform: DistributionPlatform): boolean {
    return platform.id === 'mastodon';
  }

  tokenImportPlaceholder(platform: DistributionPlatform): string {
    if (platform.id === 'threads') return 'Paste Threads access token';
    if (platform.id === 'mastodon') return 'Paste Mastodon access token';
    return 'Paste Instagram access token';
  }

  tokenImportHint(platform: DistributionPlatform): string {
    if (platform.id === 'mastodon') return 'Stored encrypted and used only by the backend for Mastodon API calls.';
    return 'Stored encrypted and used only by the backend for API posting.';
  }

  loadProviderAccounts(platform: DistributionPlatform): void {
    if (!this.platformCanUseOAuth(platform) || platform.connectionState === 'not-connected' || platform.connectionState === 'expired') return;
    this.socialAccountsLoading = true;
    this.blogApi.getSocialAuthAccounts(platform.id).subscribe({
      next: (response) => {
        this.socialAccountsLoading = false;
        this.accountLoadAttemptedByProvider[platform.id] = true;
        this.accountsByProvider[platform.id] = response.accounts || [];
        if (response.selectedAccount?.id) {
          this.selectedAccountIds[platform.id] = response.selectedAccount.id;
        } else if (response.accounts?.length === 1) {
          this.selectedAccountIds[platform.id] = response.accounts[0].id;
        }
      },
      error: (err) => {
        this.socialAccountsLoading = false;
        this.accountLoadAttemptedByProvider[platform.id] = true;
        this.socialAuthError = this.extractErrorMessage(err);
      }
    });
  }

  selectProviderAccount(platform: DistributionPlatform): void {
    const accountId = this.selectedAccountIds[platform.id];
    if (!accountId) {
      this.socialAuthError = `Choose a ${platform.name} account first.`;
      return;
    }

    this.socialAccountsLoading = true;
    this.blogApi.selectSocialAuthAccount(platform.id, accountId).subscribe({
      next: (response) => {
        this.socialAccountsLoading = false;
        const account = response.selectedAccount;
        platform.handle = account?.handle || account?.label || platform.handle;
        platform.connectionState = 'connected';
        platform.connectionLabel = 'Connected';
        platform.connectionDetail = `${account?.label || platform.name} is selected for API posting.`;
        platform.lastChecked = 'Just now';
        this.draftNotice = `${platform.name} posting identity selected.`;
        this.refreshConnections();
      },
      error: (err) => {
        this.socialAccountsLoading = false;
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
          if (this.platformUsesManualImport(platform)) continue;
          if (!this.platformCanUseOAuth(platform) && !this.platformCanUseWebhook(platform) && !platform.disabled) {
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

  refreshDeliveries(): void {
    this.deliveryLoading = true;
    this.deliveryError = '';
    this.blogApi.getSocialDistributionDeliveries().subscribe({
      next: (response) => {
        this.deliveryLoading = false;
        this.deliveryItems = response.deliveries || [];
        this.queueItems = this.deliveryItems.map((delivery) => this.mapDeliveryToQueueItem(delivery));
      },
      error: (err) => {
        this.deliveryLoading = false;
        this.deliveryError = this.extractErrorMessage(err);
      }
    });
  }

  sendQueuedDelivery(item: QueueItem): void {
    if (!item.deliveryId) return;
    this.deliveryLoading = true;
    this.blogApi.sendSocialDistributionDelivery(item.deliveryId).subscribe({
      next: () => {
        this.deliveryLoading = false;
        this.draftNotice = 'Delivery sent.';
        this.refreshDeliveries();
      },
      error: (err) => {
        this.deliveryLoading = false;
        this.deliveryError = this.extractErrorMessage(err);
      }
    });
  }

  deleteQueuedDelivery(item: QueueItem): void {
    if (!item.deliveryId) return;
    this.deliveryLoading = true;
    this.blogApi.deleteSocialDistributionDelivery(item.deliveryId).subscribe({
      next: () => {
        this.deliveryLoading = false;
        this.draftNotice = 'Delivery removed.';
        this.refreshDeliveries();
      },
      error: (err) => {
        this.deliveryLoading = false;
        this.deliveryError = this.extractErrorMessage(err);
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

  /** Maps a platform's connection state to the shared .as-badge color class. */
  getConnectionBadgeClass(platform: DistributionPlatform): string {
    if (platform.connectionState === 'connected') return 'green';
    if (platform.connectionState === 'attention') return 'amber';
    if (platform.connectionState === 'expired') return 'red';
    if (platform.connectionState === 'not-connected') {
      return platform.connectionLabel === 'Setup needed' ? 'amber' : 'red';
    }
    if (this.platformCanUseWebhook(platform)) return 'blue';
    return 'neutral';
  }

  /** Maps a queue status severity to the shared .as-badge color class. */
  getQueueBadgeClass(statusClass: QueueStatusClass): string {
    switch (statusClass) {
      case 'success': return 'green';
      case 'info': return 'blue';
      case 'warn': return 'amber';
      case 'danger': return 'red';
      default: return 'neutral';
    }
  }

  platformIsConnected(platform: DistributionPlatform): boolean {
    return platform.connectionState === 'connected'
      || platform.connectionState === 'attention'
      || (this.platformCanUseWebhook(platform) && platform.connectionState === 'manual');
  }

  destinationNeedsMedia(platform: DistributionPlatform): boolean {
    return Boolean(platform.destinationOptions.find((option) => option.value === platform.destination)?.requiresMedia);
  }

  getSelectedDestinationLabel(platform: DistributionPlatform): string {
    return platform.destinationOptions.find((option) => option.value === platform.destination)?.label || 'Post';
  }

  getTargetReadiness(platform: DistributionPlatform): string {
    if (platform.disabled) return 'Connector unavailable';
    if (this.platformUsesManualImport(platform)) return 'Manual import after the blog is published';
    if (this.platformCanUseWebhook(platform)) return 'Ready when webhook is configured';
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
    if (this.platformUsesManualImport(platform)) return 'Copy the canonical URL into Medium’s importer.';
    if (platform.connectionState === 'connected') return `${this.getSelectedDestinationLabel(platform)} is available.`;
    if (platform.connectionState === 'attention') return `${this.getSelectedDestinationLabel(platform)} needs media review.`;
    if (platform.connectionState === 'expired') return 'Login expired before posting.';
    if (platform.connectionState === 'not-connected') return 'Account is not connected.';
    if (this.platformCanUseWebhook(platform)) return 'Webhook delivery through the backend.';
    return 'Manual workflow only.';
  }

  platformCanUseOAuth(platform: DistributionPlatform): boolean {
    return this.oauthProviderIds.has(platform.id);
  }

  platformCanUseWebhook(platform: DistributionPlatform): boolean {
    return this.webhookProviderIds.has(platform.id);
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

  private mapDeliveryToQueueItem(delivery: SocialDistributionDelivery): QueueItem {
    const platform = this.platforms.find((candidate) => candidate.id === delivery.provider);
    const status = this.mapDeliveryStatus(delivery);
    return {
      deliveryId: delivery.deliveryId,
      postTitle: delivery.title || delivery.listItemID,
      platform: platform?.name || delivery.provider,
      platformClass: platform?.accentClass || 'secondary',
      destination: delivery.destination || 'Post',
      runAt: delivery.runAt ? this.formatDateTime(new Date(delivery.runAt)) : 'Not scheduled',
      status: status.label,
      statusClass: status.severity,
      receipt: status.receipt,
      caption: delivery.caption,
      error: delivery.lastError,
      canSend: ['needs_review', 'failed', 'draft'].includes(String(delivery.status || '')),
      canDelete: String(delivery.status || '') !== 'sent'
    };
  }

  private mapDeliveryStatus(delivery: SocialDistributionDelivery): { label: string; severity: QueueStatusClass; receipt: string } {
    switch (delivery.status) {
      case 'sent':
        return { label: 'Sent', severity: 'success', receipt: delivery.providerPostUrl || delivery.providerPostId || 'Delivered' };
      case 'sending':
        return { label: 'Sending', severity: 'info', receipt: 'Posting now' };
      case 'scheduled':
        return { label: 'Scheduled', severity: 'info', receipt: 'Queued by scheduler' };
      case 'needs_review':
        return { label: 'Review', severity: 'warn', receipt: 'Manual approval needed' };
      case 'failed':
        return { label: 'Failed', severity: 'danger', receipt: delivery.lastError || 'Posting failed' };
      case 'skipped':
        return { label: 'Skipped', severity: 'secondary', receipt: 'Duplicate avoided' };
      default:
        return { label: 'Draft', severity: 'secondary', receipt: 'Ready to send' };
    }
  }

  private loadAutomationSettings(): void {
    const settings = this.automation.loadSettings();
    this.automationTemplates = this.normalizeManualImportTemplates(settings.templates);
    this.automationRules = settings.rules;
    this.selectedTemplateId = this.automationTemplates[0]?.id || '';
    this.blogApi.getSocialDistributionSettings().subscribe({
      next: (remote) => {
        this.automationTemplates = this.normalizeManualImportTemplates(remote.templates);
        this.automationRules = remote.rules;
        this.selectedTemplateId = this.selectedTemplateId || this.automationTemplates[0]?.id || '';
        this.automation.saveSettings({
          templates: this.automationTemplates,
          rules: this.automationRules
        });
        this.automationNotice = 'Automation settings loaded from the backend.';
      },
      error: () => {
        this.automationNotice = 'Using local automation settings until the backend is available.';
      }
    });
  }

  private normalizeManualImportTemplates(templates: SocialDistributionTemplate[]): SocialDistributionTemplate[] {
    return templates.map((template) => template.platformId === 'medium'
      ? {
          ...template,
          name: 'Medium import handoff',
          destination: 'Manual import',
          body: '{{url}}',
          hashtags: '',
          useCoverImage: false
        }
      : template);
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
      if (this.platformUsesManualImport(platform)) {
        platform.connectionState = 'manual';
        platform.connectionLabel = 'Manual import';
        platform.connectionDetail = 'Medium no longer accepts new API integrations. Import the published blog URL manually.';
        platform.lastChecked = 'Manual workflow';
        platform.expiresIn = 'No OAuth';
        platform.selected = false;
        continue;
      }

      if (this.platformCanUseOAuth(platform)) {
        platform.connectionState = 'not-connected';
        platform.connectionLabel = 'Checking';
        platform.connectionDetail = `Checking ${platform.name} OAuth status from the backend.`;
        platform.lastChecked = 'Pending';
        platform.expiresIn = 'Pending';
        platform.selected = false;
        continue;
      }

      if (this.platformCanUseWebhook(platform)) {
        platform.connectionState = 'manual';
        platform.connectionLabel = 'Webhook';
        platform.connectionDetail = 'Uses the server-side Discord webhook URL when configured.';
        platform.lastChecked = 'Manual';
        platform.expiresIn = 'Webhook';
        platform.selected = true;
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
    if (this.platformUsesManualImport(platform)) return;

    platform.handle = status.accountLabel || platform.handle;
    platform.lastChecked = 'Just now';
    platform.expiresIn = this.formatConnectionExpiry(status);
    if (status.selectedAccount?.id) {
      this.selectedAccountIds[platform.id] = status.selectedAccount.id;
    }

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

    if (status.status === 'needs-reconnect' || status.needsReconnect) {
      const missingScopes = status.missingScopes?.length ? ` Missing scopes: ${status.missingScopes.join(', ')}.` : '';
      platform.connectionState = 'attention';
      platform.connectionLabel = 'Reconnect needed';
      platform.connectionDetail = `${platform.name} is connected, but needs a fresh login for newly enabled permissions.${missingScopes}`;
      return;
    }

    if (status.status === 'needs-selection') {
      platform.connectionState = 'attention';
      platform.connectionLabel = 'Choose account';
      platform.connectionDetail = `${platform.name} is authenticated. Select the posting identity before scheduling posts.`;
      platform.selected = false;
      this.loadProviderAccounts(platform);
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
    if (status.provider === 'x' && status.credentialArtifacts?.hasRefreshToken && status.connected) {
      return 'Auto-refresh enabled';
    }
    if ((status.provider === 'instagram' || status.provider === 'threads') && status.credentialArtifacts?.hasAccessToken && status.connected) {
      return 'Auto-refresh enabled';
    }
    if (status.provider === 'google' && status.credentialArtifacts?.hasRefreshToken && status.connected) {
      return 'Auto-refresh enabled';
    }
    if (!status.expiresAt) return status.connected ? 'No expiry reported' : 'No token';
    return this.formatExpiresAt(status.expiresAt);
  }

  private formatExpiresAt(value: string): string {
    const expiresAt = new Date(value);
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

  private applyOAuthReturnNotice(params: ParamMap = this.route.snapshot.queryParamMap): boolean {
    const provider = String(params.get('socialProvider') || '').trim();
    const status = String(params.get('socialStatus') || '').trim();
    const error = String(params.get('socialError') || '').trim();
    if (!provider || !status) return false;

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
    return true;
  }

  private extractErrorMessage(err: unknown): string {
    const anyErr = err as { error?: { error?: string; message?: string }; message?: string };
    return anyErr?.error?.error || anyErr?.error?.message || anyErr?.message || 'Social auth request failed.';
  }
}
