import { Component } from '@angular/core';
import { SupportService } from '../../services/support.service';

/**
 * Global "Support my work" affordances (design: Grayson Wills Site.dc.html
 * SUPPORT MODAL + FLOATING SUPPORT): a floating pill button and the
 * buy-me-a-coffee modal, opened from anywhere via SupportService.
 */
@Component({
  selector: 'app-support',
  templateUrl: './support.component.html',
  styleUrl: './support.component.scss',
  standalone: false,
})
export class SupportComponent {
  readonly coffeeUrl = 'https://www.buymeacoffee.com/graysonwills';

  constructor(public support: SupportService) {}
}
