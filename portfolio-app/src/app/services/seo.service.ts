import { Inject, Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';

export type SeoTags = {
  title?: string;
  description?: string;
  url?: string;
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'article';
  keywords?: string[];
};

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly defaultTitle = 'Grayson Wills';
  private readonly defaultDescription =
    'Portfolio of Grayson Wills — Solution Architect and Data Specialist. Expertise in cloud architecture, full-stack development, and data engineering.';
  private readonly defaultImage = 'https://www.grayson-wills.com/og-image.png';
  private readonly baseUrl = 'https://www.grayson-wills.com';

  constructor(
    private title: Title,
    private meta: Meta,
    @Inject(DOCUMENT) private document: Document
  ) {}

  update(tags: SeoTags): void {
    const pageTitle = (tags.title || '').trim();
    const fullTitle = pageTitle
      ? (pageTitle.includes('Grayson Wills') ? pageTitle : `${pageTitle} | ${this.defaultTitle}`)
      : this.defaultTitle;

    const description = (tags.description || this.defaultDescription).trim() || this.defaultDescription;
    const url = this.normalizeUrl(tags.url || this.baseUrl);
    const image = (tags.image || this.defaultImage).trim() || this.defaultImage;
    const imageAlt = (tags.imageAlt || 'Grayson Wills portfolio preview').trim() || 'Grayson Wills portfolio preview';
    const type = tags.type || 'website';
    const keywords = this.normalizeKeywords(tags.keywords || []);

    this.title.setTitle(fullTitle);
    this.meta.updateTag({ name: 'description', content: description });

    // Open Graph
    this.meta.updateTag({ property: 'og:title', content: fullTitle });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:type', content: type });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:image', content: image });
    this.meta.updateTag({ property: 'og:image:alt', content: imageAlt });

    // Twitter
    this.meta.updateTag({ name: 'twitter:title', content: fullTitle });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.updateTag({ name: 'twitter:image', content: image });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    if (keywords.length) {
      this.meta.updateTag({ name: 'keywords', content: keywords.join(', ') });
    } else {
      this.meta.removeTag("name='keywords'");
    }

    this.setCanonical(url);
  }

  setStructuredData(id: string, json: unknown): void {
    const scriptId = `jsonld-${id}`;
    const existing = this.document.getElementById(scriptId);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const script = this.document.createElement('script');
    script.id = scriptId;
    script.type = 'application/ld+json';
    script.text = JSON.stringify(json);
    this.document.head.appendChild(script);
  }

  clearStructuredData(id: string): void {
    const scriptId = `jsonld-${id}`;
    const existing = this.document.getElementById(scriptId);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  private setCanonical(url: string): void {
    let link = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return this.baseUrl;

    // If a relative path is passed, anchor it to the portfolio's canonical host.
    if (trimmed.startsWith('/')) return `${this.baseUrl}${trimmed}`;
    return trimmed;
  }

  private normalizeKeywords(raw: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const item of raw || []) {
      const value = String(item || '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(value);
    }

    return normalized;
  }
}
