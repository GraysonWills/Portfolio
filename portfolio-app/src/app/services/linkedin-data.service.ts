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
      'Angular',
      'Python',
      'Computer Vision',
      'Power BI',
      'TypeScript',
      'Node.js'
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
