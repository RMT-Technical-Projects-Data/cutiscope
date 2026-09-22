/**
 * CaptureQueue — a dedicated background pipeline for captured photos.
 *
 * Responsibilities:
 *   - Store captured (raw) images handed off by the camera instantly.
 *   - Continuously apply the filter (watermark / white-balance) and save the
 *     single final photo, then hand it off for S3 + Drive upload.
 *
 * Design goals (load balancing / queue management):
 *   - Serial processing (concurrency = 1) so the heavy image work never stacks
 *     and blows up memory / the JS thread.
 *   - SHUTTER PRIORITY: a `deferGate` predicate lets the queue yield while a
 *     takePhoto is in flight, so the next shot is never blocked by processing.
 *   - Durability: the pending list is persisted so a crash / app-kill does not
 *     lose captured images (their raw files live in a staging folder on disk).
 *   - Retries with backoff for transient failures.
 *
 * The actual work (processing + local save + upload) is injected via
 * `configure({ processor })` because it depends on the screen's setup.
 */
import { DeviceEventEmitter, InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'capture_queue_pending_v1';

export const CAPTURE_QUEUE_CHANGE = 'CAPTURE_QUEUE_CHANGE';

class CaptureQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.processor = null; // async (job) => void ; throws to trigger retry
    this.deferGate = null; // () => boolean ; true => wait (shutter busy)
    this.maxRetries = 4;
    this.deferPollMs = 50;
    this.maxDeferMs = 15000; // never starve forever
    // Backpressure: if the backlog grows past this, process even while the
    // shutter is busy so staged raw files don't pile up on disk unbounded.
    this.forceProcessAfter = 12;
    this.hydrated = false;
    this._persistTimer = null;
    this._persistInFlight = null;
  }

  configure({ processor, deferGate, maxRetries, forceProcessAfter } = {}) {
    if (processor) this.processor = processor;
    if (deferGate) this.deferGate = deferGate;
    if (typeof maxRetries === 'number') this.maxRetries = maxRetries;
    if (typeof forceProcessAfter === 'number') this.forceProcessAfter = forceProcessAfter;
    this._drain();
  }

  get size() {
    return this.queue.length;
  }

  _emit() {
    try {
      DeviceEventEmitter.emit(CAPTURE_QUEUE_CHANGE, { size: this.queue.length });
    } catch (_) {}
  }

  async _persist() {
    try {
      // Only persist serializable job data (no functions).
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (_) {}
  }

  /** Debounced persist so rapid bursts don't block on AsyncStorage every shot. */
  _schedulePersist() {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistInFlight = this._persist();
    }, 250);
  }

  async _flushPersist() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (this._persistInFlight) {
      try { await this._persistInFlight; } catch (_) {}
    }
    await this._persist();
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Restore any jobs left pending from a previous session. Their raw files are
   * still on disk in the staging folder, so they can be re-processed. Safe to
   * call multiple times; only runs once.
   */
  async hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length) {
          // Older (persisted) jobs go first, keeping FIFO order.
          this.queue = [...saved, ...this.queue];
          this._emit();
        }
      }
    } catch (_) {}
    this._drain();
  }

  enqueue(job) {
    const id = job.id || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.queue.push({ ...job, id, retries: 0 });
    this._emit();
    this._schedulePersist();
    this._drain();
    return id;
  }

  async _drain() {
    if (this.isProcessing) return;
    if (!this.processor) return; // not configured yet
    if (this.queue.length === 0) return;

    this.isProcessing = true;
    try {
      while (this.queue.length > 0) {
        // ── Load balancing: give the shutter priority ──
        // Only defer while a takePhoto is actively in flight (or briefly after).
        // Exceptions: bounded backlog (backpressure) or a max defer ceiling.
        let deferred = 0;
        while (
          this.deferGate &&
          this.deferGate() &&
          this.queue.length <= this.forceProcessAfter &&
          deferred < this.maxDeferMs
        ) {
          await this._wait(this.deferPollMs);
          deferred += this.deferPollMs;
        }

        const job = this.queue[0];
        try {
          await this.processor(job);
          this.queue.shift();
          this._emit();
          this._schedulePersist();

          // Yield so UI touches / animations stay responsive between jobs.
          await new Promise(resolve => InteractionManager.runAfterInteractions(resolve));
          await this._wait(0);
        } catch (e) {
          // Retry with backoff, then drop only after maxRetries.
          job.retries = (job.retries || 0) + 1;
          this.queue.shift();
          if (job.retries <= this.maxRetries) {
            console.warn(
              `CaptureQueue: retry ${job.retries}/${this.maxRetries} for ${job.fileName || job.id}:`,
              e?.message || e
            );
            this.queue.push(job);
            this._schedulePersist();
            await this._wait(300 * job.retries);
          } else {
            console.warn('CaptureQueue: dropping job after retries:', e?.message || e, job.fileName || job.id);
            this._emit();
            await this._flushPersist();
          }
        }
      }
      await this._flushPersist();
    } finally {
      this.isProcessing = false;
      // If something enqueued while we were finishing, keep draining.
      if (this.queue.length > 0) {
        this._drain();
      }
    }
  }

  /** Drop pending guest jobs and persist an empty queue (exit guest mode). */
  async clearGuestJobs() {
    const before = this.queue.length;
    this.queue = this.queue.filter((job) => !job?.isGuest);
    if (this.queue.length !== before) {
      this._emit();
    }
    // Guest exit should wipe the whole pending list — guest sessions only enqueue guest jobs,
    // but clear aggressively so nothing re-saves after deleteGuestPhotos.
    this.queue = [];
    this._emit();
    await this._flushPersist();
  }
}

export default new CaptureQueue();
