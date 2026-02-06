/**
 * Redis Seed Data Script
 * Seeds the Redis database with starter portfolio content for Grayson Wills
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
  ProjectsPhoto: 11, ProjectsText: 12
};

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now() { return new Date().toISOString(); }

// ── Seed Data ──
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
    Photo: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1920&q=80',
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingPhoto,
    ListItemID: 'hero-carousel',
    Metadata: { alt: 'Code on laptop screen', order: 1 }
  },
  {
    ID: 'landing-photo-002',
    Photo: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80',
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingPhoto,
    ListItemID: 'hero-carousel',
    Metadata: { alt: 'Data visualization globe', order: 2 }
  },
  {
    ID: 'landing-photo-003',
    Photo: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1920&q=80',
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingPhoto,
    ListItemID: 'hero-carousel',
    Metadata: { alt: 'Server infrastructure', order: 3 }
  },
  {
    ID: 'landing-text-summary',
    Text: 'Experienced Solution Architect and Data Specialist with a passion for building scalable, data-driven applications. I specialize in designing end-to-end systems that transform complex data challenges into elegant, performant solutions. With expertise spanning cloud architecture, statistical modeling, and full-stack development, I bridge the gap between business needs and technical execution.',
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingText,
    Metadata: { type: 'summary' }
  },
  {
    ID: 'landing-text-tagline',
    Text: 'Building the future, one architecture at a time.',
    PageID: PageID.Landing,
    PageContentID: PageContentID.LandingText,
    Metadata: { type: 'tagline' }
  },

  // ═══════════════════════════════════════
  // WORK PAGE (PageID: 1)
  // ═══════════════════════════════════════
  {
    ID: 'work-exp-001',
    Text: JSON.stringify({
      title: 'Solution Architect',
      company: 'Enterprise Solutions Corp',
      location: 'Remote',
      startDate: 'Jan 2023',
      endDate: 'Present',
      description: [
        'Lead architectural design for microservices-based platforms serving 500K+ users.',
        'Drive cloud migration strategies reducing infrastructure costs by 40%.'
      ],
      achievements: [
        'Architected a real-time analytics pipeline processing 2M events/day',
        'Reduced system downtime by 99.5% through redundancy patterns',
        'Mentored team of 8 engineers on cloud-native design principles'
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
      title: 'Senior Data Engineer',
      company: 'DataFlow Analytics',
      location: 'Austin, TX',
      startDate: 'Jun 2021',
      endDate: 'Dec 2022',
      description: [
        'Designed and implemented ETL pipelines processing terabytes of data daily.',
        'Built real-time dashboards for executive decision-making.'
      ],
      achievements: [
        'Reduced data processing time by 60% through pipeline optimization',
        'Implemented data quality framework catching 95% of anomalies',
        'Led migration from on-premise Hadoop to AWS cloud data lake'
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
      title: 'Full Stack Developer',
      company: 'TechStart Inc',
      location: 'Dallas, TX',
      startDate: 'Aug 2019',
      endDate: 'May 2021',
      description: [
        'Developed customer-facing web applications using Angular and Node.js.',
        'Integrated third-party APIs and payment processing systems.'
      ],
      achievements: [
        'Shipped 12 features ahead of schedule, improving customer retention by 25%',
        'Built reusable component library adopted across 3 product teams',
        'Implemented CI/CD pipeline reducing deployment time from 2 hours to 15 minutes'
      ]
    }),
    PageID: PageID.Work,
    PageContentID: PageContentID.WorkText,
    ListItemID: 'experience-2',
    Metadata: { type: 'experience', order: 3 }
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
    ID: 'proj-web-portfolio',
    Text: JSON.stringify({
      title: 'Portfolio Website',
      description: 'A full-stack portfolio site built with Angular 19, PrimeNG, Node.js/Express, and Redis Cloud. Features dynamic content management, blog authoring, and CI/CD deployment to AWS EC2.',
      techStack: ['Angular 19', 'PrimeNG', 'Node.js', 'Express', 'Redis Cloud', 'AWS EC2', 'GitHub Actions'],
      githubUrl: 'https://github.com/grayson-wills/portfolio-site',
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
    ListItemID: 'category-web'
  },

  // Category: Data Engineering
  {
    ID: 'proj-cat-data',
    Text: JSON.stringify({ name: 'Data Engineering' }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsCategoryText,
    ListItemID: 'category-data'
  },
  {
    ID: 'proj-data-pipeline',
    Text: JSON.stringify({
      title: 'Real-Time Analytics Pipeline',
      description: 'Scalable event-driven data pipeline using Apache Kafka, Spark Streaming, and AWS services. Processes 2M+ events/day with sub-second latency for real-time business intelligence dashboards.',
      techStack: ['Apache Kafka', 'Spark', 'AWS Kinesis', 'Python', 'PostgreSQL', 'Grafana'],
      date: '2024-06'
    }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsText,
    ListItemID: 'category-data'
  },
  {
    ID: 'proj-data-pipeline-photo',
    Photo: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsPhoto,
    ListItemID: 'category-data'
  },

  // Category: Cloud & DevOps
  {
    ID: 'proj-cat-cloud',
    Text: JSON.stringify({ name: 'Cloud & DevOps' }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsCategoryText,
    ListItemID: 'category-cloud'
  },
  {
    ID: 'proj-cloud-infra',
    Text: JSON.stringify({
      title: 'Cloud Infrastructure Automation',
      description: 'Infrastructure-as-Code solution using Terraform and AWS CDK for provisioning multi-region, highly available architectures. Includes monitoring, alerting, and auto-scaling configurations.',
      techStack: ['Terraform', 'AWS CDK', 'Docker', 'Kubernetes', 'CloudWatch', 'Datadog'],
      date: '2024-03'
    }),
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsText,
    ListItemID: 'category-cloud'
  },
  {
    ID: 'proj-cloud-infra-photo',
    Photo: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800&q=80',
    PageID: PageID.Projects,
    PageContentID: PageContentID.ProjectsPhoto,
    ListItemID: 'category-cloud'
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
      summary: 'Learn how to leverage Redis as both a cache and a primary data store to build lightning-fast APIs that scale horizontally under heavy load.',
      tags: ['Redis', 'API Design', 'Performance', 'Node.js'],
      publishDate: '2025-01-15T00:00:00.000Z',
      status: 'published',
      category: 'Backend'
    }
  },
  {
    ID: 'blog-post-001-text',
    Text: 'Redis is more than just a caching layer. With RedisJSON and RedisSearch modules, it becomes a powerful primary data store capable of handling complex queries with sub-millisecond latency. In this article, we explore patterns for building REST APIs backed by Redis, including data modeling strategies, connection pooling, and horizontal scaling techniques. We\'ll walk through real-world examples using Node.js and Express, demonstrating how to structure your Redis keys for optimal performance and maintainability.',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogText,
    ListItemID: 'blog-post-001'
  },
  {
    ID: 'blog-post-001-image',
    Photo: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&q=80',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogImage,
    ListItemID: 'blog-post-001'
  },

  {
    ID: 'blog-post-002-item',
    Text: 'Angular 19: What\'s New and Why It Matters',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogItem,
    ListItemID: 'blog-post-002',
    Metadata: {
      title: 'Angular 19: What\'s New and Why It Matters',
      summary: 'A deep dive into Angular 19\'s latest features including signal-based reactivity, improved SSR, and the new build system that makes development faster than ever.',
      tags: ['Angular', 'Frontend', 'TypeScript', 'Web Development'],
      publishDate: '2025-01-28T00:00:00.000Z',
      status: 'published',
      category: 'Frontend'
    }
  },
  {
    ID: 'blog-post-002-text',
    Text: 'Angular 19 represents a significant leap forward for the framework. The introduction of signal-based reactive primitives fundamentally changes how we think about state management in Angular applications. Combined with improved server-side rendering capabilities and the new esbuild-based build system, Angular 19 delivers faster development cycles and better runtime performance. This article explores the key features, migration strategies, and best practices for adopting Angular 19 in your projects.',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogText,
    ListItemID: 'blog-post-002'
  },
  {
    ID: 'blog-post-002-image',
    Photo: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&q=80',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogImage,
    ListItemID: 'blog-post-002'
  },

  {
    ID: 'blog-post-003-item',
    Text: 'The Art of Solution Architecture',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogItem,
    ListItemID: 'blog-post-003',
    Metadata: {
      title: 'The Art of Solution Architecture',
      summary: 'How to approach system design from first principles — balancing scalability, maintainability, and cost while meeting business requirements.',
      tags: ['Architecture', 'System Design', 'Best Practices', 'Cloud'],
      publishDate: '2025-02-03T00:00:00.000Z',
      status: 'published',
      category: 'Architecture'
    }
  },
  {
    ID: 'blog-post-003-text',
    Text: 'Solution architecture is about making deliberate trade-offs. Every system design decision — from choosing a database to defining service boundaries — involves balancing competing concerns. In this article, I share frameworks and mental models I\'ve developed over years of designing production systems. We\'ll cover the key principles: start simple, measure everything, design for failure, and optimize for change. These principles, combined with practical patterns like CQRS, event sourcing, and the strangler fig pattern, form the foundation of robust, evolvable architectures.',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogText,
    ListItemID: 'blog-post-003'
  },
  {
    ID: 'blog-post-003-image',
    Photo: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=800&q=80',
    PageID: PageID.Blog,
    PageContentID: PageContentID.BlogImage,
    ListItemID: 'blog-post-003'
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

    // Check for existing data
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
        for (const key of existingKeys) {
          await client.del(key);
        }
        console.log(`Deleted ${existingKeys.length} keys.\n`);
      } else {
        console.log('Keeping existing data. Appending new seed data (duplicates may occur).\n');
      }
    }

    // Insert seed data
    let success = 0;
    let failed = 0;

    for (const item of seedData) {
      const key = `content:${item.ID}`;
      const record = {
        ...item,
        CreatedAt: item.CreatedAt || now(),
        UpdatedAt: now()
      };
      
      try {
        await client.json.set(key, '$', record);
        await client.sAdd('content:_index', item.ID);
        success++;
        console.log(`  [OK] ${key} — ${item.Text?.substring(0, 50) || item.Photo?.substring(0, 50) || '(content)'}...`);
      } catch (jsonErr) {
        // Fallback to string storage if RedisJSON is not available
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

// Support --force flag to skip confirmation
if (process.argv.includes('--force')) {
  // Override readline to auto-confirm
  const originalQuestion = require('readline').Interface.prototype.question;
  require('readline').Interface.prototype.question = function(q, cb) { cb('y'); };
}

seed().catch(console.error);
