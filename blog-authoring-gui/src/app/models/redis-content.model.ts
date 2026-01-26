/**
 * Redis Content Data Model
 * Shared model between portfolio-app and blog-authoring-gui
 */

export enum PageID {
  Landing = 0,
  Work = 1,
  Projects = 2,
  Blog = 3
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
  ProjectsText = 12
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
  publishDate: Date;
  status: 'draft' | 'scheduled' | 'published';
  category?: string;
}

export interface ContentGroup {
  listItemID: string;
  items: RedisContent[];
  metadata?: BlogPostMetadata | Record<string, unknown>;
}
