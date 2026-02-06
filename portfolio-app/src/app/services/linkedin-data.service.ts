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
  private linkedInProfile: LinkedInProfile = {
    contact: {
      email: 'calvarygman@gmail.com',
      linkedin: 'www.linkedin.com/in/grayson-wills',
      website: 'www.grayson-wills.com'
    },
    topSkills: [
      'Statistics',
      'Solution Architecture',
      'Data Architecture',
      'Cloud Infrastructure',
      'Full Stack Development',
      'CI/CD Pipelines',
      'Redis',
      'Angular',
      'Node.js',
      'Python',
      'AWS',
      'TypeScript'
    ],
    certifications: [
      {
        name: 'DFSS Green Belt',
        issuer: 'Six Sigma',
        date: '2023'
      },
      {
        name: 'AWS Solutions Architect',
        issuer: 'Amazon Web Services',
        date: '2024'
      }
    ],
    summary: 'Experienced Solution Architect and Data Specialist with a passion for building ' +
             'scalable, data-driven applications. I specialize in designing end-to-end systems ' +
             'that transform complex data challenges into elegant, performant solutions. With ' +
             'expertise spanning cloud architecture, statistical modeling, and full-stack development, ' +
             'I bridge the gap between business needs and technical execution.',
    experience: [
      {
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
      },
      {
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
      },
      {
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
      },
      {
        title: 'Junior Software Developer',
        company: 'CodeWorks Agency',
        location: 'Houston, TX',
        startDate: 'May 2018',
        endDate: 'Jul 2019',
        description: [
          'Built and maintained client websites and internal tools.',
          'Collaborated on agile team delivering bi-weekly sprint releases.'
        ],
        achievements: [
          'Delivered 8 client projects on time and under budget',
          'Introduced automated testing reducing regression bugs by 70%'
        ]
      }
    ],
    education: [
      {
        degree: 'Bachelor of Science in Computer Science',
        institution: 'University of Texas at Dallas',
        location: 'Richardson, TX',
        graduationDate: '2018'
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
