import { Component, OnInit, OnDestroy } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, NavigationEnd, ActivatedRoute, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';
import { RedisService } from './services/redis.service';
import { MailchimpService } from './services/mailchimp.service';
import { environment } from '../environments/environment';
import { routeTransition } from './animations/route-animations';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  standalone: false,
  styleUrl: './app.component.scss',
  animations: [routeTransition]
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Grayson Wills - Portfolio';
  private routerSub!: Subscription;

  constructor(
    private redisService: RedisService,
    private mailchimpService: MailchimpService,
    private titleService: Title,
    private router: Router,
    private activatedRoute: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.redisService.setApiEndpoint(environment.redisApiUrl);
    this.mailchimpService.loadMailchimpScript();

    this.routerSub = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.activatedRoute),
      map(route => {
        while (route.firstChild) { route = route.firstChild; }
        return route;
      }),
      mergeMap(route => route.data)
    ).subscribe(data => {
      const pageTitle = data['title'];
      this.titleService.setTitle(
        pageTitle ? `${pageTitle} | Grayson Wills` : 'Grayson Wills - Portfolio'
      );
    });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
  }

  getRouteAnimationData(outlet: RouterOutlet): string {
    return outlet?.activatedRouteData?.['title'] || '';
  }
}
