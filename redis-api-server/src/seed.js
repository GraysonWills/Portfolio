/**
 * Redis Seed Data Script
 * Seeds the Redis database with portfolio content for Grayson Wills
 * Data sourced from LinkedIn profile PDF
 * 
 * Usage: node src/seed.js
 */

require('dotenv').config();
const { createClient } = require('redis');

const redisHost = process.env.REDIS_HOST || '';
const redisPort = parseInt(process.env.REDIS_PORT || '15545');
const requiresTLS = process.env.REDIS_TLS === 'true';

const redisConfig = {
  socket: {
    host: redisHost,
    port: redisPort,
    tls: requiresTLS,
    ...(requiresTLS && { rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false' })
  },
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB || '0')
};

// ── PageID enum values ──
const PageID = { Landing: 0, Work: 1, Projects: 2, Blog: 3 };

// ── PageContentID enum values ──
const PageContentID = {
  HeaderText: 0, HeaderIcon: 1, FooterIcon: 2,
  BlogItem: 3, BlogText: 4, BlogImage: 5,
  LandingPhoto: 6, LandingText: 7, WorkText: 8,
  ProjectsCategoryPhoto: 9, ProjectsCategoryText: 10,
  ProjectsPhoto: 11, ProjectsText: 12,
  BlogBody: 13
};

function now() { return new Date().toISOString(); }

// ── Seed Data — sourced from Profile.pdf ──
const seedData = [
  // ═══════════════════════════════════════
  // HEADER & FOOTER (shared across pages)
  // ═══════════════════════════════════════
  {
    ID: 'header-text-001',
    Text: 'Grayson Wills',
    PageID: PageID.Landing,
    PageContentID: PageContentID.HeaderText,
    Metadata: { type: 'site-title' }
  },
  {
    ID: 'header-icon-001',
    Photo: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=128&h=128&fit=crop&q=80',
    PageID: PageID.Landing,
    PageContentID: PageContentID.HeaderIcon,
    Metadata: { alt: 'Grayson Wills profile photo' }
  },
  {
    ID: 'footer-icon-github',
    Text: 'GitHub',
    Photo: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/github/github-original.svg',
    PageID: PageID.Landing,
    PageContentID: PageContentID.FooterIcon,
    Metadata: { url: 'https://github.com/grayson-wills', type: 'social' }
  },
  {
    ID: 'footer-icon-linkedin',
    Text: 'LinkedIn',
    Photo: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/linkedin/linkedin-original.svg',
    PageID: PageID.Landing,
    PageContentID: PageContentID.FooterIcon,
    Metadata: { url: 'https://www.linkedin.com/in/grayson-wills', type: 'social' }
  },

  // ═══════════════════════════════════════
  // LANDING PAGE (PageID: 0)
  // ═══════════════════════════════════════
  {
    ID: 'landing-photo-001',
    Photo: 'https://images.unsplash.com/photo-1639322537228-f710d846310a?w=1920&q=80',
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingPhoto,
    ListItemID: 'hero-carousel',
    Metadata: { alt: 'Artificial intelligence neural network visualization', order: 1 }
  },
  {
    ID: 'landing-photo-002',
    Photo: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1920&q=80',
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingPhoto,
    ListItemID: 'hero-carousel',
    Metadata: { alt: 'AI robot face with digital data streams', order: 2 }
  },
  {
    ID: 'landing-photo-003',
    Photo: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1920&q=80',
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingPhoto,
    ListItemID: 'hero-carousel',
    Metadata: { alt: 'Data analytics dashboard with charts and graphs', order: 3 }
  },
  {
    ID: 'landing-photo-004',
    Photo: 'https://images.unsplash.com/photo-1518432031352-d6fc5c10da5a?w=1920&q=80',
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingPhoto,
    ListItemID: 'hero-carousel',
    Metadata: { alt: 'Connected lines forming a network topology', order: 4 }
  },
  {
    ID: 'landing-text-summary',
    Text: "Welcome to my portfolio! I'm a passionate software developer dedicated to crafting elegant and efficient solutions that make a meaningful impact. With a genuine love for coding and problem-solving, I thrive on turning ideas into powerful and scalable applications that drive positive change. Throughout my journey as a software developer, I have gained extensive experience in a variety of programming languages, frameworks, and tools. I am equipped with a versatile skill set that allows me to tackle diverse challenges head-on. Beyond technical proficiency, I am a firm believer in the power of collaboration and communication — working closely with cross-functional teams to deliver solutions that exceed expectations.",
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingText,
    Metadata: { type: 'summary' }
  },
  {
    ID: 'landing-text-tagline',
    Text: 'Data Analyst & AI Engineer — turning complex data into elegant solutions.',
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingText,
    Metadata: { type: 'tagline' }
  },

  // ═══════════════════════════════════════
  // WORK PAGE (PageID: 1) — Real GM roles from Profile.pdf
  // ═══════════════════════════════════════
  {
    ID: 'work-exp-001',
    Text: JSON.stringify({
      title: 'Data Analyst',
      company: 'General Motors',
      location: 'Warren, Michigan',
      startDate: 'June 2025',
      endDate: 'Present',
      description: [
        'Developed and optimized data pipelines and ETL processes for large-scale analytics, ensuring accuracy and traceability across multiple sources.',
        'Designed and maintained Power BI dashboards for operational and executive reporting, improving usability and reducing refresh failures.'
      ],
      achievements: [
        'Delivered high-impact dashboards that reduced manual reporting time and improved visibility for leadership decision-making',
        'Enhanced data refresh reliability, cutting latency and increasing stakeholder confidence in analytics outputs',
        'Closed critical data integrity gaps, aligning schemas and eliminating inconsistencies across multiple systems',
        'Initiated computer vision proof-of-concept, developing a framework for connector type/state recognition using NVIDIA libraries',
        'Led enterprise data quality efforts, standardizing definitions and implementing validation checks across reporting platforms'
      ]
    }),
    PageID: PageID.Work,
    PageContentID: PageContentID.WorkText,
    ListItemID: 'experience-0',
    Metadata: { type: 'experience', order: 1 }
  },
  {
    ID: 'work-exp-002',
    Text: JSON.stringify({
      title: 'Internal Investigator & Angular Developer',
      company: 'General Motors',
      location: 'Warren, Michigan',
      startDate: 'September 2024',
      endDate: 'June 2025',
      description: [
        'Conducted in-depth data analysis to identify and resolve customer dissatisfaction and vehicle performance issues.',
        'Developed internal tools as an Angular developer to streamline data analysis for Internal Investigators.'
      ],
      achievements: [
        'Reported findings to VPs to secure funding for issue resolution, improving customer satisfaction and vehicle safety',
        'Discovered transmission issue leading to safety recall, identified errors in owner\'s manual, and scheduled multiple OTA hot fixes',
        'Collaborated with cross-functional teams to enhance tools for easier data analysis and reporting'
      ]
    }),
    PageID: PageID.Work,
    PageContentID: PageContentID.WorkText,
    ListItemID: 'experience-1',
    Metadata: { type: 'experience', order: 2 }
  },
  {
    ID: 'work-exp-003',
    Text: JSON.stringify({
      title: 'TRACK Website Lead Developer',
      company: 'General Motors',
      location: 'Warren, Michigan',
      startDate: 'October 2023',
      endDate: 'February 2025',
      description: [
        'Led the design and construction of the TRACK website for General Motors, facilitating easy navigation and personal comments on potential jobs for rotational program employees.',
        'Developed a user-friendly interface similar to LinkedIn, enhancing employee engagement and job search efficiency.'
      ],
      achievements: [
        'Implemented features to provide job-specific details and contacts, improving the overall user experience',
        'Built full-stack solution serving GM\'s rotational program employees'
      ]
    }),
    PageID: PageID.Work,
    PageContentID: PageContentID.WorkText,
    ListItemID: 'experience-2',
    Metadata: { type: 'experience', order: 3 }
  },
  {
    ID: 'work-exp-004',
    Text: JSON.stringify({
      title: 'Camera Vision/LiDAR Software Engineer',
      company: 'General Motors',
      location: 'Warren, Michigan',
      startDate: 'June 2024',
      endDate: 'August 2024',
      description: [
        'Constructed RESTful services for dark-room camera testing, automating light balance and color testing procedures.',
        'Designed automated data gathering and analysis from LiDAR field testing.'
      ],
      achievements: [
        'Utilized YOLO AI techniques to create a user interface for target detection and center correction',
        'Automated previously manual camera calibration workflows'
      ]
    }),
    PageID: PageID.Work,
    PageContentID: PageContentID.WorkText,
    ListItemID: 'experience-3',
    Metadata: { type: 'experience', order: 4 }
  },
  {
    ID: 'work-exp-005',
    Text: JSON.stringify({
      title: 'Financial Software Engineer',
      company: 'General Motors',
      location: 'Warren, Michigan',
      startDate: 'November 2023',
      endDate: 'June 2024',
      description: [
        'Designed robust frontend/backend project budget trackers for the ATW team to keep track of multi-million dollar projects.',
        'Provided valuable input in workshops to brainstorm affordable vehicle structure designs for engineers.'
      ],
      achievements: [
        'Leveraged knowledge from projects to streamline processes and improve project management efficiency',
        'Built financial dashboards used by engineering leadership'
      ]
    }),
    PageID: PageID.Work,
    PageContentID: PageContentID.WorkText,
    ListItemID: 'experience-4',
    Metadata: { type: 'experience', order: 5 }
  },
  {
    ID: 'work-exp-006',
    Text: JSON.stringify({
      title: 'Robotics Intern',
      company: 'NASA',
      location: 'Houston, Texas',
      startDate: 'June 2019',
      endDate: 'August 2019',
      description: [
        'Collaborated with NASA experts on developing robots for unique challenges.',
        'Enhanced the Space Exploration Vehicle (SEV) with innovative camera technology.'
      ],
      achievements: [
        'Honed skills in robotics, project management, and problem-solving',
        'Contributed to camera system improvements for the SEV platform'
      ]
    }),
    PageID: PageID.Work,
    PageContentID: PageContentID.WorkText,
    ListItemID: 'experience-5',
    Metadata: { type: 'experience', order: 6 }
  },
  {
    ID: 'work-exp-007',
    Text: JSON.stringify({
      title: 'Software Engineer IT Intern',
      company: 'EnVen Energy Corporation',
      location: 'Lafayette, Louisiana',
      startDate: 'June 2021',
      endDate: 'August 2022',
      description: [
        'Attended weekly IT safety meetings for oil rig control systems.',
        'Learned cybersecurity risk assessment fundamentals and system protection etiquette.'
      ],
      achievements: [
        'Developed skills in IT safety protocols and risk management',
        'Gained experience with industrial control system security'
      ]
    }),
    PageID: PageID.Work,
    PageContentID: PageContentID.WorkText,
    ListItemID: 'experience-6',
    Metadata: { type: 'experience', order: 7 }
  },

  // ═══════════════════════════════════════
  // PROJECTS PAGE (PageID: 2)
  // ═══════════════════════════════════════

  // Category: Web Applications
  {
    ID: 'proj-cat-web',
    Text: JSON.stringify({ name: 'Web Applications' }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsCategoryText,
    ListItemID: 'category-web'
  },
  {
    ID: 'proj-cat-web-photo',
    Photo: 'https://images.unsplash.com/photo-1547658719-da2b51169166?w=200&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsCategoryPhoto,
    ListItemID: 'category-web',
    Metadata: { alt: 'Web development on a monitor' }
  },
  {
    ID: 'proj-web-portfolio',
    Text: JSON.stringify({
      title: 'Portfolio Website',
      description: 'Full-stack portfolio site built with Angular 19, PrimeNG, Node.js/Express, and Redis Cloud. Features dynamic content management, blog, lazy-loaded modules, and CI/CD deployment.',
      techStack: ['Angular 19', 'PrimeNG', 'Node.js', 'Redis Cloud'],
      githubUrl: 'https://github.com/grayson-wills/portfolio-site',
      liveUrl: 'https://www.grayson-wills.com',
      date: '2025-01'
    }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsText,
    ListItemID: 'category-web'
  },
  {
    ID: 'proj-web-portfolio-photo',
    Photo: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsPhoto,
    ListItemID: 'category-web',
    Metadata: { alt: 'Portfolio website on laptop' }
  },
  {
    ID: 'proj-web-track',
    Text: JSON.stringify({
      title: 'GM TRACK Internal Platform',
      description: 'Led design and construction of the TRACK website for General Motors — a LinkedIn-style platform enabling rotational program employees to browse, comment on, and track potential job opportunities.',
      techStack: ['Angular', 'TypeScript', 'Node.js', 'REST APIs'],
      date: '2023-10'
    }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsText,
    ListItemID: 'category-web'
  },
  {
    ID: 'proj-web-track-photo',
    Photo: 'https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsPhoto,
    ListItemID: 'category-web',
    Metadata: { alt: 'Team collaboration on internal platform' }
  },

  // Category: AI & Computer Vision
  {
    ID: 'proj-cat-ai',
    Text: JSON.stringify({ name: 'AI & Computer Vision' }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsCategoryText,
    ListItemID: 'category-ai'
  },
  {
    ID: 'proj-cat-ai-photo',
    Photo: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=200&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsCategoryPhoto,
    ListItemID: 'category-ai',
    Metadata: { alt: 'Artificial intelligence concept' }
  },
  {
    ID: 'proj-ai-yolo',
    Text: JSON.stringify({
      title: 'Camera Vision & LiDAR Testing Platform',
      description: 'RESTful services for dark-room camera testing at GM, automating light balance and color calibration. Includes YOLO-based target detection UI and automated LiDAR field data analysis.',
      techStack: ['Python', 'YOLO', 'REST APIs', 'OpenCV', 'LiDAR'],
      date: '2024-06'
    }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsText,
    ListItemID: 'category-ai'
  },
  {
    ID: 'proj-ai-yolo-photo',
    Photo: 'https://images.unsplash.com/photo-1561557944-6e7860d1a7eb?w=800&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsPhoto,
    ListItemID: 'category-ai',
    Metadata: { alt: 'Computer vision detection interface' }
  },
  {
    ID: 'proj-ai-connector',
    Text: JSON.stringify({
      title: 'Connector Vision PoC',
      description: 'Computer vision proof-of-concept for connector type/state recognition at GM. Evaluated NVIDIA libraries and captured baseline performance metrics for production deployment.',
      techStack: ['Python', 'NVIDIA TAO', 'TensorRT', 'Computer Vision'],
      date: '2025-06'
    }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsText,
    ListItemID: 'category-ai'
  },
  {
    ID: 'proj-ai-connector-photo',
    Photo: 'https://images.unsplash.com/photo-1555255707-c07966088b7b?w=800&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsPhoto,
    ListItemID: 'category-ai',
    Metadata: { alt: 'Machine learning model training' }
  },

  // Category: Data & Analytics
  {
    ID: 'proj-cat-data',
    Text: JSON.stringify({ name: 'Data & Analytics' }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsCategoryText,
    ListItemID: 'category-data'
  },
  {
    ID: 'proj-cat-data-photo',
    Photo: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=200&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsCategoryPhoto,
    ListItemID: 'category-data',
    Metadata: { alt: 'Data analytics charts' }
  },
  {
    ID: 'proj-data-powerbi',
    Text: JSON.stringify({
      title: 'Executive Reporting Dashboards',
      description: 'Designed and maintained Power BI dashboards for GM operational and executive reporting. Improved usability, reduced refresh failures, and cut manual reporting time significantly.',
      techStack: ['Power BI', 'SQL', 'Python', 'DAX'],
      date: '2025-06'
    }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsText,
    ListItemID: 'category-data'
  },
  {
    ID: 'proj-data-powerbi-photo',
    Photo: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsPhoto,
    ListItemID: 'category-data',
    Metadata: { alt: 'Business intelligence dashboard' }
  },
  {
    ID: 'proj-data-budget',
    Text: JSON.stringify({
      title: 'ATW Budget Tracker',
      description: 'Robust frontend/backend project budget tracking application for GM\'s ATW team. Manages multi-million dollar project budgets with real-time visibility for engineering leadership.',
      techStack: ['Angular', 'Node.js', 'SQL Server', 'TypeScript'],
      date: '2023-11'
    }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsText,
    ListItemID: 'category-data'
  },
  {
    ID: 'proj-data-budget-photo',
    Photo: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsPhoto,
    ListItemID: 'category-data',
    Metadata: { alt: 'Financial dashboard and budget tracking' }
  },

  // ═══════════════════════════════════════
  // BLOG PAGE (PageID: 3)
  // ═══════════════════════════════════════
  {
    ID: 'blog-post-001-item',
    Text: 'Building Scalable APIs with Redis',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogItem,
    ListItemID: 'blog-post-001',
    Metadata: {
      title: 'Building Scalable APIs with Redis',
      summary: 'How to leverage Redis as both a cache and a primary data store for lightning-fast APIs.',
      tags: ['Redis', 'Node.js'],
      publishDate: '2025-01-15T00:00:00.000Z',
      status: 'published',
      category: 'Backend'
    }
  },
  {
    ID: 'blog-post-001-text',
    Text: 'Redis is more than just a caching layer. With RedisJSON and RedisSearch modules, it becomes a powerful primary data store capable of handling complex queries with sub-millisecond latency. In this article, we explore patterns for building REST APIs backed by Redis, including data modeling strategies, connection pooling, and horizontal scaling techniques.',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogText,
    ListItemID: 'blog-post-001'
  },
  {
    ID: 'blog-post-001-image',
    Photo: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&q=80',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogImage,
    ListItemID: 'blog-post-001',
    Metadata: { alt: 'Server infrastructure' }
  },

  {
    ID: 'blog-post-002-item',
    Text: 'From Intern to Engineer: My Journey at GM',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogItem,
    ListItemID: 'blog-post-002',
    Metadata: {
      title: 'From Intern to Engineer: My Journey at GM',
      summary: 'Reflections on rotating through 7 roles at General Motors — from program management to computer vision.',
      tags: ['Career', 'GM'],
      publishDate: '2025-01-28T00:00:00.000Z',
      status: 'published',
      category: 'Career'
    }
  },
  {
    ID: 'blog-post-002-text',
    Text: 'General Motors gave me the rare opportunity to explore seven distinct roles across data analytics, Angular development, financial engineering, LiDAR/camera vision, and program management. Each rotation shaped a different dimension of my engineering mindset. In this post, I share how the rotational program accelerated my growth and what I learned about finding your niche in a massive organization.',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogText,
    ListItemID: 'blog-post-002'
  },
  {
    ID: 'blog-post-002-image',
    Photo: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&q=80',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogImage,
    ListItemID: 'blog-post-002',
    Metadata: { alt: 'Modern office workspace' }
  },

  {
    ID: 'blog-post-003-item',
    Text: 'YOLO for Industrial Quality Inspection',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogItem,
    ListItemID: 'blog-post-003',
    Metadata: {
      title: 'YOLO for Industrial Quality Inspection',
      summary: 'Applying real-time object detection to automotive camera calibration and connector recognition.',
      tags: ['AI', 'Computer Vision'],
      publishDate: '2025-02-03T00:00:00.000Z',
      status: 'published',
      category: 'AI'
    }
  },
  {
    ID: 'blog-post-003-text',
    Text: 'YOLO (You Only Look Once) is one of the fastest object detection frameworks available, and it turns out to be perfectly suited for industrial applications. At GM, I used YOLO to build target detection UIs for camera calibration in dark-room testing environments and later for connector type/state recognition. This article covers the practical considerations: training data preparation, inference optimization with TensorRT, and deploying models in factory settings.',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogText,
    ListItemID: 'blog-post-003'
  },
  {
    ID: 'blog-post-003-image',
    Photo: 'https://images.unsplash.com/photo-1561557944-6e7860d1a7eb?w=800&q=80',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogImage,
    ListItemID: 'blog-post-003',
    Metadata: { alt: 'Computer vision object detection' }
  },

  {
    ID: 'blog-post-004-item',
    Text: 'Automating Everything with n8n',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogItem,
    ListItemID: 'blog-post-004',
    Metadata: {
      title: 'Automating Everything with n8n',
      summary: 'Self-hosted workflow automation for grocery syncing, project boards, and weekly reports.',
      tags: ['Automation', 'n8n'],
      publishDate: '2025-02-08T00:00:00.000Z',
      status: 'published',
      category: 'Automation'
    }
  },
  {
    ID: 'blog-post-004-text',
    Text: 'Workflow automation is not just for enterprises. With n8n, anyone can build sophisticated automations. In this post, I walk through my personal setup: syncing Kroger grocery data to Notion, auto-updating project boards from GitHub activity, generating weekly reports from multiple APIs, and handling error recovery with Slack notifications.',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogText,
    ListItemID: 'blog-post-004'
  },
  {
    ID: 'blog-post-004-image',
    Photo: 'https://images.unsplash.com/photo-1518432031352-d6fc5c10da5a?w=800&q=80',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogImage,
    ListItemID: 'blog-post-004',
    Metadata: { alt: 'Workflow automation nodes' }
  },

  // ── Blog Body Content (PageContentID: 13 — BlogBody) ──
  // Each stores a JSON array of content blocks for the full article.

  {
    ID: 'blog-post-001-body',
    Text: JSON.stringify([
      { type: 'paragraph', content: 'Redis is more than just a caching layer. With **RedisJSON** and **RedisSearch** modules, it becomes a powerful primary data store capable of handling complex queries with sub-millisecond latency.' },
      { type: 'heading', content: 'Why Redis as a Primary Store?', level: 2 },
      { type: 'paragraph', content: 'Traditionally, Redis has been pigeonholed as a cache sitting in front of PostgreSQL or MongoDB. But modern Redis modules change the game entirely. RedisJSON lets you store, update, and query JSON documents natively — no serialization overhead. RedisSearch adds full-text indexing, aggregation, and even vector similarity search.' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&q=80', alt: 'Server rack infrastructure', caption: 'Redis can handle millions of operations per second on commodity hardware.' },
      { type: 'heading', content: 'Data Modeling Strategies', level: 2 },
      { type: 'paragraph', content: 'When modeling data for Redis, think in terms of **access patterns** rather than relationships. Unlike SQL where you normalize everything, Redis rewards denormalization. Store your data the way your application reads it.' },
      { type: 'paragraph', content: 'For this portfolio, each content item is stored as a JSON document keyed by `content:{ID}`. A Set-based index (`content:_index`) tracks all IDs, making full scans efficient without using the dangerous `KEYS` command.' },
      { type: 'heading', content: 'Connection Pooling & Scaling', level: 2 },
      { type: 'paragraph', content: 'In production, always use connection pooling. The Node.js `redis` package supports this natively. For horizontal scaling, Redis Cluster distributes data across multiple shards automatically. Combined with read replicas, you can achieve *massive* read throughput.' },
      { type: 'quote', content: 'The fastest database query is the one you never have to make. Redis makes even the ones you do make feel instantaneous.', author: 'Grayson Wills' },
      { type: 'heading', content: 'Putting It All Together', level: 2 },
      { type: 'paragraph', content: 'The API server backing this site uses Express.js with Redis as its sole data store. Every content item — from landing page text to blog posts — lives in Redis. The result? **Sub-5ms response times** on every endpoint, with zero additional caching infrastructure needed.' }
    ]),
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogBody,
    ListItemID: 'blog-post-001'
  },

  {
    ID: 'blog-post-002-body',
    Text: JSON.stringify([
      { type: 'paragraph', content: 'General Motors gave me the rare opportunity to explore **seven distinct roles** across data analytics, Angular development, financial engineering, LiDAR/camera vision, and program management. Each rotation shaped a different dimension of my engineering mindset.' },
      { type: 'heading', content: 'The Rotational Program', level: 2 },
      { type: 'paragraph', content: 'GM\'s TRACK rotational program places early-career engineers into different teams every 6-12 months. The idea is simple: *exposure breeds versatility*. But living it is far more nuanced than it sounds.' },
      { type: 'paragraph', content: 'My first rotation put me on a financial engineering team where I built budget trackers for multi-million dollar projects. I learned how large organizations allocate resources and make investment decisions — skills that would prove invaluable later when advocating for my own projects.' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=1200&q=80', alt: 'Modern office workspace at GM', caption: 'The GM Tech Center in Warren, Michigan — home base for most of my rotations.' },
      { type: 'heading', content: 'The Pivotal Moment: Camera Vision', level: 2 },
      { type: 'paragraph', content: 'My fourth rotation changed everything. Working with dark-room camera testing, I built RESTful services that automated light balance and color calibration. Then I discovered **YOLO** (You Only Look Once) and built a target detection UI that replaced tedious manual workflows.' },
      { type: 'paragraph', content: 'That rotation taught me that the best engineering happens at the intersection of *software and the physical world*. Seeing code move a camera, detect a target, and output calibration data in real-time was electrifying.' },
      { type: 'heading', content: 'Lessons Learned', level: 2 },
      { type: 'paragraph', content: 'After seven rotations, here\'s what I know:\n\n- **Breadth enables depth.** Understanding multiple domains lets you see connections others miss.\n- **Communication is engineering.** Presenting findings to VPs taught me more about impact than any code review.\n- **Curiosity compounds.** Each rotation\'s skills stacked on the last, creating unexpected synergies.' },
      { type: 'quote', content: 'The engineer who understands both the data pipeline and the business context will always outperform the one who only knows the code.', author: 'Grayson Wills' }
    ]),
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogBody,
    ListItemID: 'blog-post-002'
  },

  {
    ID: 'blog-post-003-body',
    Text: JSON.stringify([
      { type: 'paragraph', content: '**YOLO** (You Only Look Once) is one of the fastest object detection frameworks available, and it turns out to be perfectly suited for industrial applications. At GM, I used YOLO to build target detection UIs for camera calibration in dark-room testing environments and later for connector type/state recognition.' },
      { type: 'heading', content: 'The Dark Room Challenge', level: 2 },
      { type: 'paragraph', content: 'Camera calibration in automotive manufacturing happens in controlled dark-room environments. The camera needs to detect specific targets at precise positions to verify alignment, color accuracy, and light sensitivity. Previously, this was a manual process — an engineer would visually confirm each target.' },
      { type: 'paragraph', content: 'YOLO changed everything. By training a custom model on target images, we could automate detection with **>98% accuracy** at 30+ FPS on an NVIDIA Jetson device.' },
      { type: 'carousel', images: [
        { url: 'https://images.unsplash.com/photo-1561557944-6e7860d1a7eb?w=1200&q=80', alt: 'Computer vision detection interface' },
        { url: 'https://images.unsplash.com/photo-1555255707-c07966088b7b?w=1200&q=80', alt: 'Machine learning model training' },
        { url: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&q=80', alt: 'AI and neural network visualization' }
      ], caption: 'From training to deployment — the computer vision pipeline for industrial quality inspection.' },
      { type: 'heading', content: 'Training Data Preparation', level: 2 },
      { type: 'paragraph', content: 'The hardest part of any computer vision project isn\'t the model — it\'s the data. For our use case, we needed:\n\n- **500+ labeled images** per connector type\n- Variations in lighting, angle, and connector state (mated, unmated, damaged)\n- Consistent annotation standards across the team\n\nWe used CVAT for annotation and built a custom augmentation pipeline to generate synthetic variations.' },
      { type: 'heading', content: 'Inference Optimization with TensorRT', level: 2 },
      { type: 'paragraph', content: 'Raw YOLO inference is fast, but factory settings demand *consistent* latency. We used **NVIDIA TensorRT** to optimize the model for the target GPU, achieving a **3x speedup** over vanilla PyTorch inference. The final model ran at 45 FPS on an RTX 3060, well within our real-time requirements.' },
      { type: 'quote', content: 'In industrial AI, the last 10% of accuracy takes 90% of the effort — but it\'s the difference between a demo and a deployed system.' },
      { type: 'heading', content: 'Deploying in Factory Settings', level: 2 },
      { type: 'paragraph', content: 'Factory deployment introduces constraints that lab environments don\'t have: network restrictions, GPU memory limits, and the need for graceful degradation. We containerized the model with Docker, added health checks, and built a fallback to manual inspection if confidence dropped below threshold.' }
    ]),
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogBody,
    ListItemID: 'blog-post-003'
  },

  {
    ID: 'blog-post-004-body',
    Text: JSON.stringify([
      { type: 'paragraph', content: 'Workflow automation isn\'t just for enterprises. With **n8n**, anyone can build sophisticated automations that rival tools costing thousands per month. In this post, I walk through my personal setup and the philosophy behind it.' },
      { type: 'heading', content: 'Why n8n?', level: 2 },
      { type: 'paragraph', content: 'I evaluated Zapier, Make (formerly Integromat), and n8n. The decision came down to three factors:\n\n1. **Self-hosted** — My data stays on my infrastructure\n2. **No execution limits** — Run as many workflows as I want\n3. **Code nodes** — When a built-in integration doesn\'t exist, I can write JavaScript directly in the workflow' },
      { type: 'heading', content: 'The Kroger → Notion Grocery Sync', level: 2 },
      { type: 'paragraph', content: 'My most-used automation syncs my Kroger grocery orders to a Notion database. Every time I place an order, n8n:\n\n- Polls the Kroger API for new orders\n- Extracts item names, quantities, and prices\n- Creates or updates entries in a Notion database\n- Calculates weekly spending trends\n- Sends a Slack summary every Sunday' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1518432031352-d6fc5c10da5a?w=1200&q=80', alt: 'Workflow automation visualization', caption: 'A simplified view of the n8n workflow connecting Kroger, Notion, and Slack.' },
      { type: 'heading', content: 'GitHub → Project Board Automation', level: 2 },
      { type: 'paragraph', content: 'Every push to my repositories triggers an n8n workflow that updates my project tracking board. It parses commit messages for keywords like `fix`, `feat`, and `docs`, then auto-labels and moves cards between columns. This eliminates the busywork of manually updating project boards.' },
      { type: 'heading', content: 'Error Recovery & Monitoring', level: 2 },
      { type: 'paragraph', content: 'Automation is only useful if it\'s reliable. Every workflow has an error handler that:\n\n- Catches failures and retries up to 3 times with exponential backoff\n- Logs errors to a dedicated Notion database\n- Sends a Slack alert for any workflow that fails all retries\n- Generates a weekly reliability report' },
      { type: 'quote', content: 'The best automation is invisible. You should only notice it when it stops working — and with proper monitoring, even that notification is automated.', author: 'Grayson Wills' }
    ]),
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogBody,
    ListItemID: 'blog-post-004'
  }
];

async function seed() {
  console.log('Connecting to Redis...');
  console.log(`  Host: ${redisHost}:${redisPort} (TLS: ${requiresTLS})`);
  
  const client = createClient(redisConfig);
  client.on('error', (err) => console.error('Redis Error:', err));
  
  try {
    await client.connect();
    console.log('Connected to Redis successfully.\n');

    const existingKeys = await client.keys('content:*');
    if (existingKeys.length > 0) {
      console.log(`Found ${existingKeys.length} existing content keys.`);
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise(resolve => {
        rl.question('Clear existing data and re-seed? (y/N): ', resolve);
      });
      rl.close();
      if (answer.toLowerCase() === 'y') {
        console.log('Clearing existing content...');
        for (const key of existingKeys) { await client.del(key); }
        console.log(`Deleted ${existingKeys.length} keys.\n`);
      } else {
        console.log('Keeping existing data.\n');
      }
    }

    let success = 0, failed = 0;
    for (const item of seedData) {
      const key = `content:${item.ID}`;
      const record = { ...item, CreatedAt: item.CreatedAt || now(), UpdatedAt: now() };
      try {
        await client.json.set(key, '$', record);
        await client.sAdd('content:_index', item.ID);
        success++;
        console.log(`  [OK] ${key} — ${item.Text?.substring(0, 50) || item.Photo?.substring(0, 50) || '(content)'}...`);
      } catch (jsonErr) {
        try {
          await client.set(key, JSON.stringify(record));
          await client.sAdd('content:_index', item.ID);
          success++;
          console.log(`  [OK] ${key} (string fallback)`);
        } catch (strErr) {
          failed++;
          console.error(`  [FAIL] ${key}: ${strErr.message}`);
        }
      }
    }
    console.log(`\nSeed complete: ${success} inserted, ${failed} failed.`);
    console.log(`Content index size: ${await client.sCard('content:_index')}`);
  } catch (error) {
    console.error('Failed to seed database:', error.message);
    process.exit(1);
  } finally {
    await client.quit();
    console.log('Disconnected from Redis.');
  }
}

if (process.argv.includes('--force')) {
  require('readline').Interface.prototype.question = function(q, cb) { cb('y'); };
}

seed().catch(console.error);
