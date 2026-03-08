#!/usr/bin/env node
/**
 * Sync projects + work skill metrics to the deployed content API using the
 * same authenticated write path the blog authoring app uses.
 *
 * Required env vars:
 * - BLOG_AUTHOR_USERNAME
 * - BLOG_AUTHOR_PASSWORD
 *
 * Optional env vars:
 * - COGNITO_REGION (default us-east-2)
 * - COGNITO_CLIENT_ID (default from blog authoring app)
 * - PORTFOLIO_API_URL (default https://api.grayson-wills.com/api)
 */

const COGNITO_REGION = process.env.COGNITO_REGION || 'us-east-2';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '6v59a97qmb3hfl1n7ptp8npdoi';
const API_URL = (process.env.PORTFOLIO_API_URL || 'https://api.grayson-wills.com/api').replace(/\/+$/, '');

const username = (process.env.BLOG_AUTHOR_USERNAME || '').trim();
const password = (process.env.BLOG_AUTHOR_PASSWORD || '').trim();

if (!username || !password) {
  console.error('Missing BLOG_AUTHOR_USERNAME and/or BLOG_AUTHOR_PASSWORD.');
  process.exit(1);
}

const PROJECT_PAGE_ID = 2;
const PROJECT_CONTENT_IDS = new Set([9, 10, 11, 12]);
const WORK_PAGE_ID = 1;
const WORK_METRIC_CONTENT_ID = 14;

function nowIso() {
  return new Date().toISOString();
}

async function getIdToken() {
  const endpoint = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Cognito auth failed (${response.status})`);
  }

  const token = payload?.AuthenticationResult?.IdToken;
  if (!token) throw new Error('Cognito did not return IdToken.');
  return token;
}

function buildCategoryRecords() {
  return [
    {
      ID: 'proj-cat-ai',
      Text: JSON.stringify({ name: 'AI & Machine Learning' }),
      PageID: PROJECT_PAGE_ID,
      PageContentID: 10,
      ListItemID: 'category-ai',
      Metadata: { order: 1 }
    },
    {
      ID: 'proj-cat-ai-photo',
      Photo: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=200&q=80',
      PageID: PROJECT_PAGE_ID,
      PageContentID: 9,
      ListItemID: 'category-ai',
      Metadata: { alt: 'Artificial intelligence and neural network visuals', order: 1 }
    },
    {
      ID: 'proj-cat-web',
      Text: JSON.stringify({ name: 'Web & Product Development' }),
      PageID: PROJECT_PAGE_ID,
      PageContentID: 10,
      ListItemID: 'category-web',
      Metadata: { order: 2 }
    },
    {
      ID: 'proj-cat-web-photo',
      Photo: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=200&q=80',
      PageID: PROJECT_PAGE_ID,
      PageContentID: 9,
      ListItemID: 'category-web',
      Metadata: { alt: 'Web application engineering workspace', order: 2 }
    },
    {
      ID: 'proj-cat-automation',
      Text: JSON.stringify({ name: 'Automation & Productivity' }),
      PageID: PROJECT_PAGE_ID,
      PageContentID: 10,
      ListItemID: 'category-automation',
      Metadata: { order: 3 }
    },
    {
      ID: 'proj-cat-automation-photo',
      Photo: 'https://images.unsplash.com/photo-1516116216624-53e697fedbea?w=200&q=80',
      PageID: PROJECT_PAGE_ID,
      PageContentID: 9,
      ListItemID: 'category-automation',
      Metadata: { alt: 'Automation scripts and terminal workflow', order: 3 }
    },
    {
      ID: 'proj-cat-embedded',
      Text: JSON.stringify({ name: 'Embedded & Robotics' }),
      PageID: PROJECT_PAGE_ID,
      PageContentID: 10,
      ListItemID: 'category-embedded',
      Metadata: { order: 4 }
    },
    {
      ID: 'proj-cat-embedded-photo',
      Photo: 'https://images.unsplash.com/photo-1581092921461-eab62e97a780?w=200&q=80',
      PageID: PROJECT_PAGE_ID,
      PageContentID: 9,
      ListItemID: 'category-embedded',
      Metadata: { alt: 'Robotics and embedded engineering environment', order: 4 }
    },
    {
      ID: 'proj-cat-data',
      Text: JSON.stringify({ name: 'Data & Operations Analytics' }),
      PageID: PROJECT_PAGE_ID,
      PageContentID: 10,
      ListItemID: 'category-data',
      Metadata: { order: 5 }
    },
    {
      ID: 'proj-cat-data-photo',
      Photo: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=200&q=80',
      PageID: PROJECT_PAGE_ID,
      PageContentID: 9,
      ListItemID: 'category-data',
      Metadata: { alt: 'Operational analytics dashboard', order: 5 }
    }
  ];
}

function projectRecord({
  idBase,
  listItemID,
  order,
  title,
  description,
  techStack,
  date,
  photo,
  alt,
  githubUrl,
  liveUrl
}) {
  const textPayload = {
    title,
    description,
    techStack,
    date,
    ...(githubUrl ? { githubUrl } : {}),
    ...(liveUrl ? { liveUrl } : {})
  };

  return [
    {
      ID: idBase,
      Text: JSON.stringify(textPayload),
      PageID: PROJECT_PAGE_ID,
      PageContentID: 12,
      ListItemID: listItemID,
      Metadata: { order }
    },
    {
      ID: `${idBase}-photo`,
      Photo: photo,
      PageID: PROJECT_PAGE_ID,
      PageContentID: 11,
      ListItemID: listItemID,
      Metadata: { alt, order }
    }
  ];
}

function buildProjectRecords() {
  return [
    ...projectRecord({
      idBase: 'proj-ai-google-adk-hackathon',
      listItemID: 'category-ai',
      order: 1,
      title: 'Google ADK Hackathon',
      description: 'Participated in a Google-hosted Agent Development Kit hackathon focused on low-code AI agent pipelines, task orchestration patterns, and practical automation design.',
      techStack: ['AI Agents', 'Python', 'Prompt Engineering', 'Workflow Design'],
      date: 'May 2025 - Jun 2025',
      photo: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=1200&q=80',
      alt: 'AI agent architecture concept diagram',
      githubUrl: 'https://github.com/GraysonWills/Google-ADK-Hackathon'
    }),
    ...projectRecord({
      idBase: 'proj-ai-facial-expression-detection',
      listItemID: 'category-ai',
      order: 2,
      title: 'Facial Expression Detection',
      description: 'Built a computer vision and neural-network-driven prototype that detects facial expressions and provides real-time voice feedback based on predicted emotional states.',
      techStack: ['Computer Vision', 'Neural Networks', 'Python', 'OpenCV'],
      date: 'Mar 2025',
      photo: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?w=1200&q=80',
      alt: 'Facial recognition model visualization'
    }),
    ...projectRecord({
      idBase: 'proj-ai-audioldm-transformer-efficiency',
      listItemID: 'category-ai',
      order: 3,
      title: 'AudioLDM Transformer Efficiency Booster',
      description: 'Associated with Purdue University. Deconstructed and rebuilt key AudioLDM transformer components to retain similar runtime speed while reducing memory usage.',
      techStack: ['Transformers', 'PyTorch', 'Model Optimization', 'Performance Tuning'],
      date: 'Aug 2024 - Dec 2024',
      photo: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=1200&q=80',
      alt: 'Audio model and transformer optimization workflow'
    }),
    ...projectRecord({
      idBase: 'proj-ai-continuous-sign-language-interpretation',
      listItemID: 'category-ai',
      order: 4,
      title: 'Continuous Sign Language Interpretation',
      description: 'Associated with Purdue University. Attempted to reproduce research for continuous sign-language understanding that combines motion and facial cues; documented failure modes due to hardware and training constraints.',
      techStack: ['Computer Vision', 'Sequence Models', 'Failure Analysis', 'Research Reproduction'],
      date: 'Aug 2024 - Dec 2024',
      photo: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&q=80',
      alt: 'Gesture recognition and temporal model analysis',
      githubUrl: 'https://github.com/GraysonWills/GSL-ECE-57000'
    }),
    ...projectRecord({
      idBase: 'proj-ai-openai-to-z',
      listItemID: 'category-ai',
      order: 5,
      title: 'OpenAI-To-Z',
      description: 'Built as a structured learning and experimentation repository for LLM tooling, prompt workflows, and practical AI integration patterns across projects.',
      techStack: ['LLM Engineering', 'Prompt Design', 'AI Tooling', 'JavaScript'],
      date: 'Jun 2025',
      photo: 'https://images.unsplash.com/photo-1676299081847-824916de030a?w=1200&q=80',
      alt: 'Large language model experimentation workflow',
      githubUrl: 'https://github.com/GraysonWills/OpenAI-To-Z'
    }),

    ...projectRecord({
      idBase: 'proj-web-investment-calculator',
      listItemID: 'category-web',
      order: 1,
      title: 'Investment Calculator',
      description: 'Developing a finance-focused web calculator that projects investment value over time while serving as a structured sandbox for Angular, CSS, and front-end architecture practice.',
      techStack: ['Angular', 'TypeScript', 'CSS', 'HTML'],
      date: 'May 2025 - Present',
      photo: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1200&q=80',
      alt: 'Investment growth chart and portfolio analytics',
      githubUrl: 'https://github.com/GraysonWills/investment-calculator'
    }),
    ...projectRecord({
      idBase: 'proj-web-beerme',
      listItemID: 'category-web',
      order: 2,
      title: 'BeerMe (Deprecated)',
      description: 'Deprecated. Created a React web experience for travelers who want to discover local craft breweries, with a focus on approachable UX and useful regional discovery flows. The public beerme.org deployment has been retired, and this screenshot reflects the final project interface.',
      techStack: ['React', 'JavaScript', 'HTML', 'CSS'],
      date: 'Oct 2024 - Dec 2024',
      photo: '/projects/beerme-home-desktop.jpg',
      alt: 'BeerMe homepage screenshot',
      githubUrl: 'https://github.com/GraysonWills/BeerBelly'
    }),
    ...projectRecord({
      idBase: 'proj-web-personal-website',
      listItemID: 'category-web',
      order: 3,
      title: 'Personal Website',
      description: 'Built an early personal portfolio website from scratch using foundational front-end technologies to communicate skills, projects, and professional direction.',
      techStack: ['HTML', 'CSS', 'JavaScript', 'Bootstrap'],
      date: 'Apr 2024 - May 2024',
      photo: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1200&q=80',
      alt: 'Portfolio website interface on desktop',
      githubUrl: 'https://github.com/GraysonWills/Portfolio-Website'
    }),
    ...projectRecord({
      idBase: 'proj-web-roundnet-community-web-project',
      listItemID: 'category-web',
      order: 4,
      title: 'Roundnet Community Web Project',
      description: 'Contributing to a community-focused roundnet platform that centralizes tournament operations, user/team workflows, and organizational tooling with a modern web architecture.',
      techStack: ['React', 'Node.js', 'Express', 'MySQL', 'Knex', 'AWS'],
      date: '2025 - Present',
      photo: 'https://images.unsplash.com/photo-1521412644187-c49fa049e84d?w=1200&q=80',
      alt: 'Community sports web platform and tournament management',
      githubUrl: 'https://github.com/USA-Roundnet/community_web_project'
    }),
    ...projectRecord({
      idBase: 'proj-web-portfolio-platform',
      listItemID: 'category-web',
      order: 5,
      title: 'Portfolio Platform',
      description: 'Full portfolio platform with Angular frontend, authoring interface, API-driven content, and cloud deployment automation for rapid iteration and publishing.',
      techStack: ['Angular', 'TypeScript', 'Node.js', 'AWS', 'CI/CD'],
      date: '2026',
      photo: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200&q=80',
      alt: 'Modern full-stack portfolio platform architecture',
      githubUrl: 'https://github.com/GraysonWills/Portfolio',
      liveUrl: 'https://www.grayson-wills.com'
    }),

    ...projectRecord({
      idBase: 'proj-automation-toolbox',
      listItemID: 'category-automation',
      order: 1,
      title: "Grayson Wills' Toolbox",
      description: 'Maintaining a personal knowledge system in Markdown and Overleaf to document and revisit technical concepts in plain English, reinforcing retention and communication through teach-back writing.',
      techStack: ['Markdown', 'Technical Writing', 'Knowledge Management', 'Teaching'],
      date: 'Jun 2025 - Present',
      photo: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=1200&q=80',
      alt: 'Structured technical notes and documentation workspace',
      githubUrl: 'https://github.com/GraysonWills/Grayson-Wills-Toolbox'
    }),
    ...projectRecord({
      idBase: 'proj-automation-terminal-expense-tracker',
      listItemID: 'category-automation',
      order: 2,
      title: 'Python Terminal Expense Tracker',
      description: 'Built a keyboard-only terminal application to track expenses and persist user data, intentionally using the project to improve coding speed and editor shortcut fluency.',
      techStack: ['Python', 'CLI', 'File Persistence', 'Developer Productivity'],
      date: 'Jun 2025',
      photo: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&q=80',
      alt: 'Terminal-based personal finance application',
      githubUrl: 'https://github.com/GraysonWills/Personal-Expense-Tracker'
    }),
    ...projectRecord({
      idBase: 'proj-automation-terminal-task-manager',
      listItemID: 'category-automation',
      order: 3,
      title: 'Python Terminal Task Manager',
      description: 'Designed a keyboard-driven terminal task manager to strengthen fluency in rapid command-line development and practical productivity tooling.',
      techStack: ['Python', 'CLI', 'Task Management', 'Keyboard Shortcuts'],
      date: 'Jun 2025',
      photo: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?w=1200&q=80',
      alt: 'Command-line task workflow',
      githubUrl: 'https://github.com/GraysonWills/Task-Manager'
    }),
    ...projectRecord({
      idBase: 'proj-automation-insurance-organization',
      listItemID: 'category-automation',
      order: 4,
      title: 'Automated Insurance Organization',
      description: 'Automated eligibility processing for insurance submissions by replacing manual roster parsing with Python-based data processing and outbound email generation.',
      techStack: ['Python', 'Automation', 'Data Processing', 'Email Workflow'],
      date: 'Jun 2023',
      photo: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&q=80',
      alt: 'Automated insurance workflow and reporting'
    }),
    ...projectRecord({
      idBase: 'proj-automation-powershell-automations',
      listItemID: 'category-automation',
      order: 5,
      title: 'PowerShell Automations',
      description: 'Developed desktop and workflow automations in PowerShell to reduce repetitive operational tasks and improve local environment setup consistency.',
      techStack: ['PowerShell', 'Automation', 'Developer Tooling'],
      date: '2025',
      photo: 'https://images.unsplash.com/photo-1516116216624-53e697fedbea?w=1200&q=80',
      alt: 'PowerShell automation scripts running in terminal',
      githubUrl: 'https://github.com/GraysonWills/PowerShellAutomations'
    }),
    ...projectRecord({
      idBase: 'proj-automation-coupon-clipper',
      listItemID: 'category-automation',
      order: 6,
      title: 'CouponClipper',
      description: 'Prototype automation concept for reducing manual coupon discovery and clipping workflows with lightweight scripted processing.',
      techStack: ['JavaScript', 'Automation', 'Data Extraction'],
      date: 'Apr 2025',
      photo: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=80',
      alt: 'Automation flow for retail and coupon processing',
      githubUrl: 'https://github.com/GraysonWills/CouponClipper'
    }),
    ...projectRecord({
      idBase: 'proj-automation-qr-code-custom-dice',
      listItemID: 'category-automation',
      order: 7,
      title: 'QR Code Custom Dice',
      description: 'Explored interactive product tooling by combining QR-code logic with custom-dice concepts for lightweight physical/digital interaction experiments.',
      techStack: ['JavaScript', 'QR Codes', 'Prototype Development'],
      date: 'Apr 2025',
      photo: 'https://images.unsplash.com/photo-1595079835353-fb9f4f6f8c65?w=1200&q=80',
      alt: 'Prototype design combining QR code and physical artifacts',
      githubUrl: 'https://github.com/GraysonWills/QRCode-Custom-Dice'
    }),

    ...projectRecord({
      idBase: 'proj-embedded-never-ending-alarm-clocks',
      listItemID: 'category-embedded',
      order: 1,
      title: 'Never-Ending Alarm Clocks',
      description: 'Designed a hardware/software alarm experiment where snooze activates another alarm, using modified clock circuitry and off-board Arduino control logic for randomized triggering.',
      techStack: ['Embedded Systems', 'Arduino', 'Circuit Design', 'Control Logic'],
      date: 'Feb 2025',
      photo: 'https://images.unsplash.com/photo-1501139083538-0139583c060f?w=1200&q=80',
      alt: 'Embedded alarm circuit prototype on workbench'
    }),
    ...projectRecord({
      idBase: 'proj-embedded-concurrent-factory-floor-robots',
      listItemID: 'category-embedded',
      order: 2,
      title: 'Concurrent Factory Floor Robots',
      description: 'Associated with The University of Texas at Austin. Co-led a 5-engineer team with TI sponsorship to build two robots that concurrently navigated a mock factory floor while avoiding dynamic obstacles.',
      techStack: ['Robotics', 'Concurrent Programming', 'Embedded Control', 'Systems Integration'],
      date: 'Aug 2022 - May 2023',
      photo: 'https://images.unsplash.com/photo-1561144257-e32e8efc6c4f?w=1200&q=80',
      alt: 'Autonomous robots moving through a test environment'
    }),
    ...projectRecord({
      idBase: 'proj-embedded-audiobeats',
      listItemID: 'category-embedded',
      order: 3,
      title: 'AudioBeats',
      description: 'Audio-focused systems experimentation in C++ exploring signal-processing foundations and performance-oriented implementation patterns.',
      techStack: ['C++', 'Audio Processing', 'Systems Programming'],
      date: 'Oct 2024',
      photo: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200&q=80',
      alt: 'Audio engineering and signal processing environment',
      githubUrl: 'https://github.com/GraysonWills/AudioBeats'
    }),

    ...projectRecord({
      idBase: 'proj-data-automated-inventory-detection',
      listItemID: 'category-data',
      order: 1,
      title: 'Automated Inventory Detection',
      description: 'Associated with St. Hubertus Wild Game Stewards. Removed manual post-market inventory counting through a pipeline combining web scraping, Shopify API integration, and structured reporting.',
      techStack: ['Web Scraping', 'Shopify API', 'Data Analysis', 'Automation'],
      date: 'Feb 2022 - Mar 2022',
      photo: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1200&q=80',
      alt: 'Inventory operations and fulfillment analytics'
    }),
    ...projectRecord({
      idBase: 'proj-data-titanic-ml',
      listItemID: 'category-data',
      order: 2,
      title: 'Titanic Survival Modeling',
      description: 'Built a supervised-learning pipeline for the Titanic dataset to benchmark feature engineering and classification performance on structured tabular data.',
      techStack: ['Python', 'Machine Learning', 'Feature Engineering', 'Classification'],
      date: 'Jul 2025',
      photo: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&q=80',
      alt: 'Classification modeling workflow for tabular data',
      githubUrl: 'https://github.com/GraysonWills/Titanic'
    }),
    ...projectRecord({
      idBase: 'proj-data-spaceship-titanic-ml',
      listItemID: 'category-data',
      order: 3,
      title: 'Spaceship Titanic Prediction',
      description: 'Implemented a predictive modeling workflow for the Spaceship Titanic dataset to compare model behavior under noisy and partially missing features.',
      techStack: ['Python', 'Machine Learning', 'Data Cleaning', 'Classification'],
      date: 'Jul 2025',
      photo: 'https://images.unsplash.com/photo-1446776877081-d282a0f896e2?w=1200&q=80',
      alt: 'Space-themed dataset modeling and evaluation',
      githubUrl: 'https://github.com/GraysonWills/SpaceshipTitanic'
    }),
    ...projectRecord({
      idBase: 'proj-data-house-prices-regression',
      listItemID: 'category-data',
      order: 4,
      title: 'House Prices Regression',
      description: 'Developed regression experiments on housing-market data to evaluate preprocessing, feature selection, and error-reduction strategies.',
      techStack: ['Python', 'Regression', 'Feature Engineering', 'Model Evaluation'],
      date: 'Jul 2025',
      photo: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200&q=80',
      alt: 'Real-estate forecasting and regression analytics',
      githubUrl: 'https://github.com/GraysonWills/HousePrices'
    }),
    ...projectRecord({
      idBase: 'proj-data-nyc-taxi-fare-prediction',
      listItemID: 'category-data',
      order: 5,
      title: 'NYC Taxi Fare Prediction',
      description: 'Modeled taxi-fare outcomes from trip attributes to practice geospatially influenced regression techniques and data-quality handling.',
      techStack: ['Python', 'Regression', 'Geospatial Features', 'Data Analysis'],
      date: 'Jul 2025',
      photo: 'https://images.unsplash.com/photo-1529429617124-aee71135234a?w=1200&q=80',
      alt: 'Urban mobility data analytics for fare prediction',
      githubUrl: 'https://github.com/GraysonWills/NYCTaxiFare'
    }),
    ...projectRecord({
      idBase: 'proj-data-forest-cover-type-classification',
      listItemID: 'category-data',
      order: 6,
      title: 'Forest Cover Type Classification',
      description: 'Built a multiclass classification workflow for forest cover type prediction, focusing on robust feature handling and model comparison.',
      techStack: ['Python', 'Classification', 'Multiclass Modeling', 'Data Science'],
      date: 'Jul 2025',
      photo: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1200&q=80',
      alt: 'Environmental data modeling and forest classification',
      githubUrl: 'https://github.com/GraysonWills/ForestCoverType'
    }),
    ...projectRecord({
      idBase: 'proj-data-digit-recognizer',
      listItemID: 'category-data',
      order: 7,
      title: 'Digit Recognizer',
      description: 'Implemented digit recognition experiments for handwritten input classification to benchmark baseline ML approaches on image-derived features.',
      techStack: ['Python', 'Classification', 'Image Features', 'Model Evaluation'],
      date: 'Jul 2025',
      photo: 'https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?w=1200&q=80',
      alt: 'Handwritten digit recognition modeling workflow',
      githubUrl: 'https://github.com/GraysonWills/DigitRecognizer'
    })
  ];
}

function buildWorkSkillMetrics() {
  return [
    {
      ID: 'work-metric-ai-ml',
      Text: JSON.stringify({
        label: 'AI & Machine Learning',
        value: 88,
        level: 'Advanced',
        summary: 'Applied model design, optimization, and experiment execution across vision and agent systems'
      }),
      PageID: 1,
      PageContentID: 14,
      ListItemID: 'career-metric-1',
      Metadata: { type: 'career-metric', order: 1 }
    },
    {
      ID: 'work-metric-data-analytics',
      Text: JSON.stringify({
        label: 'Data Engineering & Analytics',
        value: 90,
        level: 'Advanced',
        summary: 'Building reliable data pipelines and analytics products for operational and strategic decisions'
      }),
      PageID: 1,
      PageContentID: 14,
      ListItemID: 'career-metric-2',
      Metadata: { type: 'career-metric', order: 2 }
    },
    {
      ID: 'work-metric-fullstack-web',
      Text: JSON.stringify({
        label: 'Full-Stack Web Development',
        value: 85,
        level: 'Strong',
        summary: 'Shipping maintainable Angular and React experiences backed by practical API design'
      }),
      PageID: 1,
      PageContentID: 14,
      ListItemID: 'career-metric-3',
      Metadata: { type: 'career-metric', order: 3 }
    },
    {
      ID: 'work-metric-embedded-robotics',
      Text: JSON.stringify({
        label: 'Embedded & Robotics Systems',
        value: 76,
        level: 'Developing',
        summary: 'Hands-on embedded control, robotics prototyping, and concurrent system behavior design'
      }),
      PageID: 1,
      PageContentID: 14,
      ListItemID: 'career-metric-4',
      Metadata: { type: 'career-metric', order: 4 }
    },
    {
      ID: 'work-metric-computer-vision',
      Text: JSON.stringify({
        label: 'Computer Vision',
        value: 80,
        level: 'Strong',
        summary: 'Designing and evaluating detection workflows across quality, expression, and perception tasks'
      }),
      PageID: 1,
      PageContentID: 14,
      ListItemID: 'career-metric-5',
      Metadata: { type: 'career-metric', order: 5 }
    },
    {
      ID: 'work-metric-teaching-communication',
      Text: JSON.stringify({
        label: 'Teaching & Technical Communication',
        value: 84,
        level: 'Strong',
        summary: 'Translating complex topics into clear documentation and practical explanations for others'
      }),
      PageID: 1,
      PageContentID: 14,
      ListItemID: 'career-metric-6',
      Metadata: { type: 'career-metric', order: 6 }
    },
    {
      ID: 'work-metric-program-leadership',
      Text: JSON.stringify({
        label: 'Program Leadership',
        value: 79,
        level: 'Developing',
        summary: 'Coordinating execution across teams, timelines, and evolving technical constraints'
      }),
      PageID: 1,
      PageContentID: 14,
      ListItemID: 'career-metric-7',
      Metadata: { type: 'career-metric', order: 7 }
    }
  ];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function upsertRecords(token, records) {
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  const existingRes = await fetchJson(`${API_URL}/content`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!existingRes.response.ok || !Array.isArray(existingRes.payload)) {
    throw new Error('Failed to fetch existing content for upsert pass.');
  }

  const existingIds = new Set(existingRes.payload.map((item) => String(item?.ID || '')));

  let created = 0;
  let updated = 0;
  const now = nowIso();

  for (const record of records) {
    const id = String(record.ID || '').trim();
    if (!id) continue;

    const payload = {
      ...record,
      UpdatedAt: now
    };

    if (existingIds.has(id)) {
      const res = await fetchJson(`${API_URL}/content/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(payload)
      });
      if (!res.response.ok) {
        throw new Error(`Update failed for ${id}: ${res.payload?.error || res.response.status}`);
      }
      updated++;
    } else {
      const res = await fetchJson(`${API_URL}/content`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          ...payload,
          CreatedAt: now
        })
      });
      if (!res.response.ok) {
        throw new Error(`Create failed for ${id}: ${res.payload?.error || res.response.status}`);
      }
      created++;
    }
  }

  return { created, updated, total: records.length };
}

async function pruneProjectRecords(token, desiredProjectIds) {
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  const existing = await fetchJson(`${API_URL}/content/page/${PROJECT_PAGE_ID}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!existing.response.ok || !Array.isArray(existing.payload)) {
    throw new Error('Failed to fetch page projects for prune pass.');
  }

  const staleRecords = existing.payload.filter((item) => {
    const id = String(item?.ID || '');
    const pageContentID = Number(item?.PageContentID);
    return PROJECT_CONTENT_IDS.has(pageContentID) && id && !desiredProjectIds.has(id);
  });

  let deleted = 0;
  for (const stale of staleRecords) {
    const res = await fetchJson(`${API_URL}/content/${encodeURIComponent(stale.ID)}`, {
      method: 'DELETE',
      headers: authHeaders
    });
    if (!res.response.ok) {
      throw new Error(`Delete failed for stale record ${stale.ID}: ${res.payload?.error || res.response.status}`);
    }
    deleted++;
  }

  return { deleted, staleCount: staleRecords.length };
}

async function pruneWorkMetricRecords(token, desiredMetricIds) {
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  const existing = await fetchJson(`${API_URL}/content/page/${WORK_PAGE_ID}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!existing.response.ok || !Array.isArray(existing.payload)) {
    throw new Error('Failed to fetch work page metrics for prune pass.');
  }

  const staleRecords = existing.payload.filter((item) => {
    const id = String(item?.ID || '');
    const pageContentID = Number(item?.PageContentID);
    return pageContentID === WORK_METRIC_CONTENT_ID && id && !desiredMetricIds.has(id);
  });

  let deleted = 0;
  for (const stale of staleRecords) {
    const res = await fetchJson(`${API_URL}/content/${encodeURIComponent(stale.ID)}`, {
      method: 'DELETE',
      headers: authHeaders
    });
    if (!res.response.ok) {
      throw new Error(`Delete failed for stale work metric ${stale.ID}: ${res.payload?.error || res.response.status}`);
    }
    deleted++;
  }

  return { deleted, staleCount: staleRecords.length };
}

async function main() {
  const token = await getIdToken();
  const records = [
    ...buildCategoryRecords(),
    ...buildProjectRecords(),
    ...buildWorkSkillMetrics()
  ];

  const desiredProjectIds = new Set(
    records
      .filter((record) => Number(record.PageID) === PROJECT_PAGE_ID && PROJECT_CONTENT_IDS.has(Number(record.PageContentID)))
      .map((record) => String(record.ID))
  );
  const desiredMetricIds = new Set(
    records
      .filter((record) => Number(record.PageID) === WORK_PAGE_ID && Number(record.PageContentID) === WORK_METRIC_CONTENT_ID)
      .map((record) => String(record.ID))
  );

  const result = await upsertRecords(token, records);
  const pruneResult = await pruneProjectRecords(token, desiredProjectIds);
  const pruneMetricResult = await pruneWorkMetricRecords(token, desiredMetricIds);

  const verifyProjects = await fetchJson(`${API_URL}/content/page/${PROJECT_PAGE_ID}`);
  const verifyMetrics = await fetchJson(`${API_URL}/content/page/${WORK_PAGE_ID}`);

  const projectCount = Array.isArray(verifyProjects.payload)
    ? verifyProjects.payload.filter((item) => Number(item.PageContentID) === 12).length
    : -1;
  const projectCategoryCount = Array.isArray(verifyProjects.payload)
    ? verifyProjects.payload.filter((item) => Number(item.PageContentID) === 10).length
    : -1;
  const metricCount = Array.isArray(verifyMetrics.payload)
    ? verifyMetrics.payload.filter((item) => Number(item.PageContentID) === 14).length
    : -1;

  console.log(JSON.stringify({
    ok: true,
    ...result,
    deletedProjectRecords: pruneResult.deleted,
    staleProjectRecords: pruneResult.staleCount,
    deletedWorkMetrics: pruneMetricResult.deleted,
    staleWorkMetrics: pruneMetricResult.staleCount,
    postSync: {
      projectTextRecords: projectCount,
      projectCategoryRecords: projectCategoryCount,
      workMetricRecords: metricCount
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message || String(error)
  }, null, 2));
  process.exit(1);
});
