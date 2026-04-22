/**
 * Redis Content Data Model
 * Shared model between portfolio-app and blog-authoring-gui
 */

export enum PageID {
  Landing = 0,
  Work = 1,
  Projects = 2,
  Blog = 3,
  Collections = 4
}

export enum PageContentID {
  HeaderText = 0,
  HeaderIcon = 1,
  FooterIcon = 2,
  BlogItem = 3,
  BlogText = 4,
  BlogImage = 5,
  LandingPhoto = 6,
  LandingText = 7,
  WorkText = 8,
  ProjectsCategoryPhoto = 9,
  ProjectsCategoryText = 10,
  ProjectsPhoto = 11,
  ProjectsText = 12,
  BlogBody = 13,
  WorkSkillMetric = 14,
  BlogSignatureSettings = 15,
  CollectionsCategoryRegistry = 16,
  CollectionsEntry = 17,
  BlogRoughDraft = 18
}

export interface RedisContent {
  ID: string;
  Text?: string;
  Photo?: string;
  ListItemID?: string;
  PageID: PageID;
  PageContentID: PageContentID;
  CreatedAt?: Date;
  UpdatedAt?: Date;
  Metadata?: Record<string, any>;
}

export interface BlogPostMetadata {
  title: string;
  summary: string;
  tags: string[];
  privateSeoTags?: string[];
  readTimeMinutes?: number;
  publishDate: Date;
  status: 'draft' | 'scheduled' | 'published';
  category?: string;
  signatureId?: string;
  signatureSnapshot?: BlogSignature;
  hasRoughDraft?: boolean;
}

export interface BlogSignature {
  id: string;
  label: string;
  quote: string;
  quoteAuthor: string;
  signOffName: string;
}

export interface BlogSignatureSettings {
  signatures: BlogSignature[];
  defaultSignatureId?: string;
}

export interface ContentGroup {
  listItemID: string;
  items: RedisContent[];
  metadata?: BlogPostMetadata | Record<string, unknown>;
}

export type CollectionsEntryType =
  | 'lyrics'
  | 'poem'
  | 'quote'
  | 'transcript'
  | 'interview'
  | 'note'
  | 'article'
  | 'custom';

export interface CollectionsCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isArchived?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CollectionsCategoryRegistry {
  categories: CollectionsCategory[];
  updatedAt?: string;
}

export interface CollectionsEntryMetadata {
  title: string;
  summary?: string;
  entryType: CollectionsEntryType;
  categoryId: string;
  categorySlug?: string;
  categoryName?: string;
  tags?: string[];
  isPublic: boolean;
  visibility: 'public' | 'hidden';
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
}
