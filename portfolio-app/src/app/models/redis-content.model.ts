/**
 * Redis Content Data Model
 * Defines the structure for all content stored in Redis database
 * Supports dynamic page rendering based on PageID and PageContentID
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
  ProjectsText = 12,
  BlogBody = 13,
  WorkSkillMetric = 14
}

export interface RedisContent {
  ID: string;                    // Redis-generated row identifier
  Text?: string;                 // Main textual content (optional)
  Photo?: string;                // Associated image content (URL/Base64) (optional)
  ListItemID?: string;           // Grouping for text/photo as one list element
  PageID: PageID;                // Determines the application section
  PageContentID: PageContentID;  // Semantic role within the page
  CreatedAt?: Date;              // Timestamp for creation
  UpdatedAt?: Date;              // Timestamp for last update
  Metadata?: Record<string, any>; // Additional metadata (tags, status, etc.)
}

/**
 * LinkedIn Profile Data Structure
 * Optimized for ATS and recruiter visibility
 */
export interface LinkedInProfile {
  contact: {
    email: string;
    linkedin: string;
    website: string;
  };
  summary: string;
  topSkills: string[];
  certifications: Array<{
    name: string;
    issuer: string;
    date?: string;
  }>;
  experience: Array<{
    title: string;
    company: string;
    location: string;
    startDate: string;
    endDate?: string;
    description: string[];
    achievements: string[];
  }>;
  education: Array<{
    degree: string;
    institution: string;
    location: string;
    graduationDate?: string;
  }>;
}

/**
 * Blog Post Metadata
 */
export interface BlogPostMetadata {
  title: string;
  summary: string;
  tags: string[];
  publishDate: Date;
  status: 'draft' | 'scheduled' | 'published';
  category?: string;
}

/**
 * Blog Body Content Blocks
 * Stored as JSON array in BlogBody (PageContentID: 13) Text field.
 * Supports rich content: paragraphs (Markdown), images, carousels, headings, quotes.
 */
export type BlogBodyBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'heading'; content: string; level: 2 | 3 | 4 }
  | { type: 'image'; url: string; alt: string; caption?: string }
  | { type: 'carousel'; images: Array<{ url: string; alt: string }>; caption?: string }
  | { type: 'quote'; content: string; author?: string };

/**
 * Content Group for List Rendering
 * Groups related content items by ListItemID
 */
export interface ContentGroup {
  listItemID: string;
  items: RedisContent[];
  metadata?: BlogPostMetadata | Record<string, unknown>;
}
