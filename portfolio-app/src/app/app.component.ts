import { Component, OnInit } from '@angular/core';
import { RedisService } from './services/redis.service';
import { MailchimpService } from './services/mailchimp.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  standalone: false,
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  title = 'Grayson Wills - Portfolio';

  constructor(
    private redisService: RedisService,
    private mailchimpService: MailchimpService
  ) {}

  ngOnInit(): void {
    // Initialize Redis service with API endpoint
    this.redisService.setApiEndpoint(environment.redisApiUrl);
    
    // Load Mailchimp script
    this.mailchimpService.loadMailchimpScript();
  }
}
