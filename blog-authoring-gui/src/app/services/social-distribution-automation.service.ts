import { Injectable } from '@angular/core';

export type SocialAutomationTrigger = 'blog_published' | 'blog_scheduled' | 'manual_review';
export type SocialTemplatePlatform = 'all' | string;

export type SocialDistributionTemplate = {
  id: string;
  name: string;
  platformId: SocialTemplatePlatform;
  destination: string;
  body: string;
  hashtags: string;
  useCoverImage: boolean;
};

export type SocialAutomationRule = {
  id: string;
  name: string;
  trigger: SocialAutomationTrigger;
  enabled: boolean;
  templateId: string;
  platformIds: string[];
  delayMinutes: number;
  requiresReview: boolean;
  quietMode: boolean;
};

export type SocialAutomationContext = {
  title: string;
  summary: string;
  url: string;
  category: string;
  tags: string;
  publishedDate: string;
  readingTime: string;
  coverImage: string;
};

export type SocialAutomationPreview = {
  ruleId: string;
  ruleName: string;
  templateId: string;
  templateName: string;
  platformId: string;
  destination: string;
  caption: string;
  runAt: Date;
  requiresReview: boolean;
  quietMode: boolean;
  usesCoverImage: boolean;
};

export type SocialAutomationSettings = {
  templates: SocialDistributionTemplate[];
  rules: SocialAutomationRule[];
};

@Injectable({
  providedIn: 'root'
})
export class SocialDistributionAutomationService {
  private readonly storageKey = 'blog_authoring_social_distribution_automation_v1';

  readonly templateVariables = [
    'title',
    'summary',
    'url',
    'category',
    'tags',
    'publishedDate',
    'readingTime',
    'coverImage'
  ];

  getDefaultSettings(): SocialAutomationSettings {
    return {
      templates: [
        {
          id: 'launch-note',
          name: 'Launch note',
          platformId: 'all',
          destination: 'Feed post',
          body: 'New post: {{title}}\n\n{{summary}}\n\nRead it here: {{url}}',
          hashtags: '{{tags}}',
          useCoverImage: true
        },
        {
          id: 'x-short-post',
          name: 'X short post',
          platformId: 'x',
          destination: 'Single post',
          body: '{{title}}\n\n{{summary}}\n\n{{url}}',
          hashtags: '{{tags}}',
          useCoverImage: false
        },
        {
          id: 'linkedin-reflection',
          name: 'LinkedIn reflection',
          platformId: 'linkedin',
          destination: 'Personal update',
          body: 'I published a new essay: {{title}}\n\n{{summary}}\n\n{{url}}',
          hashtags: '{{tags}}',
          useCoverImage: true
        },
        {
          id: 'instagram-story',
          name: 'Instagram story draft',
          platformId: 'instagram',
          destination: 'Story',
          body: '{{title}}\n\n{{summary}}\n\nLink: {{url}}',
          hashtags: '{{tags}}',
          useCoverImage: true
        },
        {
          id: 'threads-short-post',
          name: 'Threads short post',
          platformId: 'threads',
          destination: 'Post',
          body: '{{title}}\n\n{{summary}}\n\n{{url}}',
          hashtags: '{{tags}}',
          useCoverImage: false
        },
        {
          id: 'tiktok-photo-upload',
          name: 'TikTok photo upload',
          platformId: 'tiktok',
          destination: 'Photo upload',
          body: '{{title}}\n\n{{summary}}\n\n{{url}}',
          hashtags: '{{tags}}',
          useCoverImage: true
        }
      ],
      rules: [
        {
          id: 'publish-announcement',
          name: 'Publish announcement',
          trigger: 'blog_published',
          enabled: true,
          templateId: 'launch-note',
          platformIds: ['x', 'linkedin', 'facebook'],
          delayMinutes: 0,
          requiresReview: false,
          quietMode: true
        },
        {
          id: 'visual-story-draft',
          name: 'Visual story draft',
          trigger: 'blog_published',
          enabled: false,
          templateId: 'instagram-story',
          platformIds: ['instagram'],
          delayMinutes: 5,
          requiresReview: true,
          quietMode: true
        },
        {
          id: 'scheduled-reminder',
          name: 'Scheduled post reminder',
          trigger: 'blog_scheduled',
          enabled: true,
          templateId: 'linkedin-reflection',
          platformIds: ['linkedin'],
          delayMinutes: 1,
          requiresReview: true,
          quietMode: true
        }
      ]
    };
  }

  loadSettings(): SocialAutomationSettings {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.storageKey) || '');
      return this.normalizeSettings(parsed);
    } catch {
      return this.getDefaultSettings();
    }
  }

  saveSettings(settings: SocialAutomationSettings): void {
    localStorage.setItem(this.storageKey, JSON.stringify(this.normalizeSettings(settings)));
  }

  resetSettings(): SocialAutomationSettings {
    const defaults = this.getDefaultSettings();
    this.saveSettings(defaults);
    return defaults;
  }

  buildPreviews(
    settings: SocialAutomationSettings,
    context: SocialAutomationContext,
    trigger: SocialAutomationTrigger,
    baseDate: Date = new Date()
  ): SocialAutomationPreview[] {
    const templates = new Map(settings.templates.map((template) => [template.id, template]));
    return settings.rules
      .filter((rule) => rule.enabled && rule.trigger === trigger)
      .flatMap((rule) => {
        const template = templates.get(rule.templateId);
        if (!template) return [];
        return rule.platformIds.map((platformId) => ({
          ruleId: rule.id,
          ruleName: rule.name,
          templateId: template.id,
          templateName: template.name,
          platformId,
          destination: template.destination,
          caption: this.renderTemplate(template, context),
          runAt: new Date(baseDate.getTime() + Math.max(0, Number(rule.delayMinutes) || 0) * 60_000),
          requiresReview: rule.requiresReview,
          quietMode: rule.quietMode,
          usesCoverImage: template.useCoverImage
        }));
      });
  }

  renderTemplate(template: SocialDistributionTemplate, context: SocialAutomationContext): string {
    const values: Record<string, string> = {
      title: context.title,
      summary: context.summary,
      url: context.url,
      category: context.category,
      tags: context.tags,
      publishedDate: context.publishedDate,
      readingTime: context.readingTime,
      coverImage: context.coverImage
    };
    const body = this.replaceVariables(template.body, values);
    const hashtags = this.replaceVariables(template.hashtags, values).trim();
    return [body.trim(), hashtags].filter(Boolean).join('\n\n');
  }

  private replaceVariables(value: string, values: Record<string, string>): string {
    return String(value || '').replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_match, key: string) => values[key] || '');
  }

  private normalizeSettings(input: Partial<SocialAutomationSettings> | null): SocialAutomationSettings {
    const defaults = this.getDefaultSettings();
    const templateById = new Map(defaults.templates.map((template) => [template.id, template]));
    const ruleById = new Map(defaults.rules.map((rule) => [rule.id, rule]));

    for (const template of input?.templates || []) {
      if (!template?.id) continue;
      templateById.set(String(template.id), {
        id: String(template.id),
        name: String(template.name || 'Untitled template'),
        platformId: String(template.platformId || 'all'),
        destination: String(template.destination || 'Post'),
        body: String(template.body || ''),
        hashtags: String(template.hashtags || ''),
        useCoverImage: Boolean(template.useCoverImage)
      });
    }

    for (const rule of input?.rules || []) {
      if (!rule?.id) continue;
      ruleById.set(String(rule.id), {
        id: String(rule.id),
        name: String(rule.name || 'Untitled rule'),
        trigger: this.normalizeTrigger(rule.trigger),
        enabled: Boolean(rule.enabled),
        templateId: String(rule.templateId || defaults.templates[0].id),
        platformIds: Array.isArray(rule.platformIds) ? rule.platformIds.map(String).filter(Boolean) : [],
        delayMinutes: Math.max(0, Number(rule.delayMinutes) || 0),
        requiresReview: Boolean(rule.requiresReview),
        quietMode: rule.quietMode !== false
      });
    }

    return {
      templates: Array.from(templateById.values()),
      rules: Array.from(ruleById.values())
    };
  }

  private normalizeTrigger(value: unknown): SocialAutomationTrigger {
    if (value === 'blog_scheduled' || value === 'manual_review') return value;
    return 'blog_published';
  }
}
