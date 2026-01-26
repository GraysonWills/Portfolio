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
  // LinkedIn profile data - will be loaded from Redis or environment
  private linkedInProfile: LinkedInProfile = {
    contact: {
      email: 'calvarygman@gmail.com',
      linkedin: 'www.linkedin.com/in/grayson-wills',
      website: 'www.grayson-wills.com'
    },
    topSkills: [
      'Statistics',
      'Solution Architecture',
      'Data Architecture'
    ],
    certifications: [
      {
        name: 'DFSS Green Belt',
        issuer: 'Six Sigma'
      }
    ],
    summary: 'Experienced professional specializing in statistics, solution architecture, and data architecture. ' +
             'Dedicated to delivering innovative solutions and driving business value through technology.',
    experience: [],
    education: []
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
   * Creates Redis content entries from LinkedIn profile data
   */
  syncToRedis(): Observable<RedisContent[]> {
    const contentItems: RedisContent[] = [];

    // Landing page summary (PageID: 0, PageContentID: 7)
    contentItems.push({
      ID: `linkedin-summary-${Date.now()}`,
      Text: this.linkedInProfile.summary,
      PageID: PageID.Landing,
      PageContentID: PageContentID.LandingText,
      CreatedAt: new Date()
    });

    // Landing page contact information
    contentItems.push({
      ID: `linkedin-contact-${Date.now()}`,
      Text: JSON.stringify(this.linkedInProfile.contact),
      PageID: PageID.Landing,
      PageContentID: PageContentID.LandingText,
      CreatedAt: new Date()
    });

    // Work page experience entries (PageID: 1, PageContentID: 8)
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

    // Skills and certifications for Work page
    contentItems.push({
      ID: `linkedin-skills-${Date.now()}`,
      Text: JSON.stringify({
        skills: this.linkedInProfile.topSkills,
        certifications: this.linkedInProfile.certifications
      }),
      PageID: PageID.Work,
      PageContentID: PageContentID.WorkText,
      CreatedAt: new Date()
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
}
