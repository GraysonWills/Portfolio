import { Injectable } from '@angular/core';

export interface TransactionEntry {
  timestamp: Date;
  action: string;
  detail: string;
}

@Injectable({
  providedIn: 'root'
})
export class TransactionLogService {
  private readonly STORAGE_KEY = 'blog_transaction_log';
  private entries: TransactionEntry[] = [];

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Log a transaction
   */
  log(action: string, detail: string): void {
    const entry: TransactionEntry = {
      timestamp: new Date(),
      action,
      detail
    };
    this.entries.unshift(entry); // newest first
    // Keep max 200 entries
    if (this.entries.length > 200) {
      this.entries = this.entries.slice(0, 200);
    }
    this.saveToStorage();
    console.log(`[TX] ${action}: ${detail}`);
  }

  /**
   * Get all log entries (newest first)
   */
  getEntries(): TransactionEntry[] {
    return this.entries;
  }

  /**
   * Clear the log
   */
  clear(): void {
    this.entries = [];
    this.saveToStorage();
  }

  /**
   * Persist to localStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.entries));
    } catch (e) {
      console.warn('Could not persist transaction log:', e);
    }
  }

  /**
   * Load from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        this.entries = JSON.parse(stored).map((e: any) => ({
          ...e,
          timestamp: new Date(e.timestamp)
        }));
      }
    } catch (e) {
      console.warn('Could not load transaction log:', e);
      this.entries = [];
    }
  }
}
