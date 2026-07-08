import { Injectable } from '@angular/core';

/** Opens the global support (buy-me-a-coffee) modal from anywhere. */
@Injectable({ providedIn: 'root' })
export class SupportService {
  isOpen = false;

  open(): void { this.isOpen = true; }
  close(): void { this.isOpen = false; }
}
