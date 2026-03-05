/**
 * LinkedIn Data Service
 * Integrates LinkedIn profile data into the application
 * Optimized for ATS and recruiter visibility
 */

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { LinkedInProfile } from '../models/redis-content.model';
import { RedisService } from './redis.service';
import { PageID, PageContentID, RedisContent } from '../models/redis-content.model';

@Injectable({
  providedIn: 'root'
})
export class LinkedInDataService {
  private readonly defaultCareerMetrics: Array<{
    label: string;
    value: number;
    level: string;
    summary: string;
  }> = [
    {
      label: 'AI Systems Architecture',
      value: 86,
      level: 'Advanced',
      summary: 'Production design and platform integration across analytics + AI workflows'
    },
    {
      label: 'Data Science Delivery',
      value: 91,
      level: 'Advanced',
      summary: 'Experimentation, KPI translation, and executive-facing dashboard outcomes'
    },
    {
      label: 'Computer Vision',
      value: 74,
      level: 'Developing',
      summary: 'Active in CV pipelines, model experimentation, and edge case tuning'
    },
    {
      label: 'Product + Executive Communication',
      value: 80,
      level: 'Strong',
      summary: 'Cross-functional decision support and narrative framing for leadership'
    }
  ];

  private linkedInProfile: LinkedInProfile = {
    contact: {
      email: 'calvarygman@gmail.com',
      linkedin: 'www.linkedin.com/in/grayson-wills',
      website: 'www.grayson-wills.com'
    },
    topSkills: [
      'Technical Writing',
      'Teaching',
      'Organization',
      'AI Agents',
      'Statistics',
      'Solution Architecture',
      'Data Architecture',
      'Web Development',
      'Angular',
      'React',
      'Python',
      'ETL Pipelines',
      'SQL',
      'Power BI',
      'Computer Vision',
      'Neural Networks',
      'Transformers',
      'Embedded Systems',
      'Robotics',
      'Concurrent Programming',
      'Web Scraping',
      'API Integration',
      'TypeScript',
      'Node.js',
      'Program Leadership',
      'Executive Communication'
    ],
    certifications: [
      {
        name: 'DFSS Green Belt',
        issuer: 'Six Sigma'
      }
    ],
    summary: "I'm a passionate software developer dedicated to crafting elegant and efficient solutions " +
             'that make a meaningful impact. With a genuine love for coding and problem-solving, I thrive on ' +
             'turning ideas into powerful and scalable applications. Throughout my journey I have gained ' +
             'extensive experience in a variety of programming languages, frameworks, and tools — equipped ' +
             'with a versatile skill set that allows me to tackle diverse challenges head-on.',
    experience: [
      {
        title: 'Data Analyst',
        company: 'General Motors',
        location: 'Warren, Michigan',
        startDate: 'June 2025',
        endDate: 'Present',
        description: [
          'Developed and optimized data pipelines and ETL processes for large-scale analytics.',
          'Designed Power BI dashboards for operational and executive reporting.'
        ],
        achievements: [
          'Delivered dashboards reducing manual reporting time for leadership',
          'Led enterprise data quality efforts across reporting platforms',
          'Initiated computer vision PoC for connector recognition using NVIDIA libraries'
        ]
      },
      {
        title: 'Internal Investigator & Angular Developer',
        company: 'General Motors',
        location: 'Warren, Michigan',
        startDate: 'September 2024',
        endDate: 'June 2025',
        description: [
          'Conducted data analysis to resolve vehicle performance issues.',
          'Developed Angular tools for internal investigation workflows.'
        ],
        achievements: [
          'Discovered transmission issue leading to safety recall',
          'Reported findings to VPs securing funding for issue resolution'
        ]
      },
      {
        title: 'TRACK Website Lead Developer',
        company: 'General Motors',
        location: 'Warren, Michigan',
        startDate: 'October 2023',
        endDate: 'February 2025',
        description: [
          'Led design of LinkedIn-style internal platform for rotational program.',
          'Built full-stack solution enhancing employee engagement.'
        ],
        achievements: [
          'Improved job search efficiency for rotational program employees',
          'Implemented job-specific details and contact features'
        ]
      },
      {
        title: 'Robotics Intern',
        company: 'NASA',
        location: 'Houston, Texas',
        startDate: 'June 2019',
        endDate: 'August 2019',
        description: [
          'Collaborated with NASA experts on robotics challenges.',
          'Enhanced Space Exploration Vehicle with camera technology.'
        ],
        achievements: [
          'Contributed to camera system improvements for the SEV',
          'Developed skills in robotics and project management'
        ]
      }
    ],
    education: [
      {
        degree: 'Master of Science in Artificial Intelligence',
        institution: 'Purdue University',
        location: 'West Lafayette, IN',
        graduationDate: '2025'
      },
      {
        degree: 'Bachelor of Science in Electrical & Computer Engineering',
        institution: 'The University of Texas at Austin',
        location: 'Austin, TX',
        graduationDate: '2023'
      }
    ],
    communityService: [
      {
        role: 'Advisor',
        organization: 'Midwest Roundnet',
        startDate: 'Dec 2024',
        endDate: 'Present',
        cause: 'Sports Governance',
        summary: 'Providing guidance on rule regulation, tour-series structure, scheduling, and tournament field setup support across the Midwest Roundnet circuit.'
      },
      {
        role: 'Team Lead',
        organization: 'USA Roundnet',
        startDate: 'Aug 2021',
        endDate: 'Dec 2024',
        cause: 'Social Services',
        summary: 'Led insurance operations for sanctioned U.S. tournaments and built workflow automations to improve COI and player insurance process flow year-round.'
      },
      {
        role: 'Volunteer',
        organization: 'Texas Association for the Sport of Roundnet',
        startDate: 'Aug 2019',
        endDate: 'May 2023',
        cause: 'Community Sports',
        summary: 'Supported tournament-day operations including player communications, supply prep (water/snacks), and on-site field setup logistics.'
      },
      {
        role: 'Volunteer',
        organization: 'Austin Pets Alive!',
        startDate: 'Dec 2022',
        endDate: 'May 2023',
        cause: 'Animal Welfare',
        summary: 'Contributed weekly to facility operations by completing recurring care tasks and maintaining clean, ready-to-use animal support spaces.'
      },
      {
        role: 'Taekwondo Instructor',
        organization: 'UT Elementary',
        startDate: 'Aug 2019',
        endDate: 'Mar 2020',
        cause: 'Children',
        summary: 'Taught K-3 students weekly beginner taekwondo fundamentals, stretching routines, and game-based movement sessions.'
      },
      {
        role: 'Counselor',
        organization: 'Camp For All',
        startDate: 'Jul 2017',
        endDate: 'Jul 2018',
        cause: 'Children',
        summary: 'Supported special-needs children at overnight camp through teamwork activities, confidence-building challenges, and social development programming.'
      },
      {
        role: 'Co President',
        organization: 'Mentors for Others',
        startDate: 'Aug 2016',
        endDate: 'May 2019',
        cause: 'Social Services',
        summary: 'Organized and participated in monthly social outings designed to help special-needs teens engage confidently in community environments.'
      },
      {
        role: 'Floor Staff',
        organization: 'Tri City Churches Resale Shop',
        startDate: 'Jul 2016',
        endDate: 'Aug 2019',
        cause: 'Poverty Alleviation',
        summary: 'Contributed weekly to resale operations, including checkout support, pricing/tagging donations, and merchandising the sales floor.'
      },
      {
        role: 'Announcer',
        organization: 'Greatwood Senior Living',
        startDate: 'Aug 2015',
        endDate: 'May 2016',
        cause: 'Social Services',
        summary: 'Facilitated weekly bingo events for residents, coordinating game flow and prize announcements for community engagement.'
      },
      {
        role: 'Mower',
        organization: 'Mow-On Movement',
        startDate: 'Jan 2012',
        endDate: 'Jul 2015',
        cause: 'Social Services',
        summary: 'Provided weekly volunteer lawncare services in underprivileged Houston communities, including mowing, edging, and fertilizing recurring homes.'
      }
    ]
  };

  constructor(private redisService: RedisService) {}

  /**
   * Get LinkedIn profile data
   */
  getLinkedInProfile(): Observable<LinkedInProfile> {
    return of(this.linkedInProfile);
  }

  /**
   * Sync LinkedIn data to Redis
   */
  syncToRedis(): Observable<RedisContent[]> {
    const contentItems: RedisContent[] = [];

    // Landing page summary
    contentItems.push({
      ID: `linkedin-summary-${Date.now()}`,
      Text: this.linkedInProfile.summary,
      PageID: PageID.Landing,
      PageContentID: PageContentID.LandingText,
      Metadata: { type: 'summary' },
      CreatedAt: new Date()
    });

    // Work page experience entries
    this.linkedInProfile.experience.forEach((exp, index) => {
      contentItems.push({
        ID: `linkedin-exp-${index}-${Date.now()}`,
        Text: JSON.stringify({
          title: exp.title,
          company: exp.company,
          location: exp.location,
          startDate: exp.startDate,
          endDate: exp.endDate,
          description: exp.description,
          achievements: exp.achievements
        }),
        PageID: PageID.Work,
        PageContentID: PageContentID.WorkText,
        ListItemID: `experience-${index}`,
        CreatedAt: new Date()
      });
    });

    // Work page career metrics
    this.defaultCareerMetrics.forEach((metric, index) => {
      contentItems.push({
        ID: `linkedin-metric-${index}-${Date.now()}`,
        Text: JSON.stringify(metric),
        PageID: PageID.Work,
        PageContentID: PageContentID.WorkSkillMetric,
        ListItemID: `career-metric-${index + 1}`,
        Metadata: { type: 'career-metric', order: index + 1 },
        CreatedAt: new Date()
      });
    });

    return this.redisService.batchCreateContent(contentItems);
  }

  /**
   * Get contact information
   */
  getContactInfo(): Observable<{email: string; linkedin: string; website: string}> {
    return of(this.linkedInProfile.contact);
  }

  /**
   * Get top skills
   */
  getTopSkills(): Observable<string[]> {
    return of(this.linkedInProfile.topSkills);
  }

  /**
   * Get certifications
   */
  getCertifications(): Observable<Array<{name: string; issuer: string; date?: string}>> {
    return of(this.linkedInProfile.certifications);
  }

  /**
   * Get education
   */
  getEducation(): Observable<Array<{degree: string; institution: string; location: string; graduationDate?: string}>> {
    return of(this.linkedInProfile.education);
  }
}
