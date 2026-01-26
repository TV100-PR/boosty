/**
 * Signing Queue
 * Rate-limited queue for transaction signing operations
 */

import { v4 as uuidv4 } from 'uuid';
import type { SigningQueueEntry, WalletErrorCode } from '../types.js';
import { WalletManagerError } from '../types.js';

/**
 * Default rate limit: 60 signing operations per minute
 */
const DEFAULT_RATE_LIMIT = 60;

/**
 * Rate limit window in milliseconds (1 minute)
 */
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Signing queue state
 */
interface QueueState {
  entries: Map<string, SigningQueueEntry>;
  timestamps: number[];
  rateLimit: number;
  processing: boolean;
}

/**
 * Signing Queue implementation
 */
export class SigningQueue {
  private state: QueueState;
  private onProcess?: (entry: SigningQueueEntry) => Promise<void>;

  constructor(options?: {
    rateLimit?: number;
    onProcess?: (entry: SigningQueueEntry) => Promise<void>;
  }) {
    this.state = {
      entries: new Map(),
      timestamps: [],
      rateLimit: options?.rateLimit || DEFAULT_RATE_LIMIT,
      processing: false,
    };
    this.onProcess = options?.onProcess;
  }

  /**
   * Add an entry to the queue
   */
  add(entry: Omit<SigningQueueEntry, 'id' | 'createdAt' | 'status'>): SigningQueueEntry {
    const fullEntry: SigningQueueEntry = {
      ...entry,
      id: uuidv4(),
      createdAt: new Date(),
      status: 'pending',
    };

    this.state.entries.set(fullEntry.id, fullEntry);
    return fullEntry;
  }

  /**
   * Get an entry by ID
   */
  get(entryId: string): SigningQueueEntry | undefined {
    return this.state.entries.get(entryId);
  }

  /**
   * Remove an entry from the queue
   */
  remove(entryId: string): boolean {
    return this.state.entries.delete(entryId);
  }

  /**
   * Check if we can sign (rate limit check)
   */
  canSign(): boolean {
    this.cleanupOldTimestamps();
    return this.state.timestamps.length < this.state.rateLimit;
  }

  /**
   * Record a signing operation
   */
  recordSigning(): void {
    this.state.timestamps.push(Date.now());
  }

  /**
   * Wait for rate limit to allow signing
   */
  async waitForRateLimit(): Promise<void> {
    while (!this.canSign()) {
      // Calculate wait time until oldest timestamp expires
      const oldestTimestamp = this.state.timestamps[0];
      const waitTime = oldestTimestamp + RATE_LIMIT_WINDOW_MS - Date.now() + 100;

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      this.cleanupOldTimestamps();
    }
  }

  /**
   * Clean up timestamps outside the rate limit window
   */
  private cleanupOldTimestamps(): void {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    this.state.timestamps = this.state.timestamps.filter(ts => ts > cutoff);
  }

  /**
   * Get the current rate (signings per minute)
   */
  getCurrentRate(): number {
    this.cleanupOldTimestamps();
    return this.state.timestamps.length;
  }

  /**
   * Get remaining capacity in the current window
   */
  getRemainingCapacity(): number {
    this.cleanupOldTimestamps();
    return Math.max(0, this.state.rateLimit - this.state.timestamps.length);
  }

  /**
   * Get time until next available signing slot (in ms)
   */
  getTimeUntilNextSlot(): number {
    if (this.canSign()) {
      return 0;
    }

    const oldestTimestamp = this.state.timestamps[0];
    return Math.max(0, oldestTimestamp + RATE_LIMIT_WINDOW_MS - Date.now());
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    queueSize: number;
    pendingCount: number;
    signingCount: number;
    completedCount: number;
    failedCount: number;
    currentRate: number;
    remainingCapacity: number;
  } {
    let pendingCount = 0;
    let signingCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    for (const entry of this.state.entries.values()) {
      switch (entry.status) {
        case 'pending':
          pendingCount++;
          break;
        case 'signing':
          signingCount++;
          break;
        case 'completed':
          completedCount++;
          break;
        case 'failed':
          failedCount++;
          break;
      }
    }

    return {
      queueSize: this.state.entries.size,
      pendingCount,
      signingCount,
      completedCount,
      failedCount,
      currentRate: this.getCurrentRate(),
      remainingCapacity: this.getRemainingCapacity(),
    };
  }

  /**
   * Update the rate limit
   */
  setRateLimit(limit: number): void {
    if (limit <= 0) {
      throw new WalletManagerError(
        'RATE_LIMITED' as WalletErrorCode,
        'Rate limit must be positive'
      );
    }
    this.state.rateLimit = limit;
  }

  /**
   * Clear all entries from the queue
   */
  clear(): void {
    this.state.entries.clear();
  }

  /**
   * Get all pending entries sorted by priority
   */
  getPendingEntries(): SigningQueueEntry[] {
    return Array.from(this.state.entries.values())
      .filter(e => e.status === 'pending')
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Update entry status
   */
  updateStatus(
    entryId: string,
    status: SigningQueueEntry['status'],
    error?: string
  ): void {
    const entry = this.state.entries.get(entryId);
    if (entry) {
      entry.status = status;
      if (error) {
        entry.error = error;
      }
    }
  }
}

/**
 * Create a signing queue instance
 */
export function createSigningQueue(options?: {
  rateLimit?: number;
}): SigningQueue {
  return new SigningQueue(options);
}
