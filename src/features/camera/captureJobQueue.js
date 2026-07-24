/**
 * CaptureQueue — background pipeline for captured photos.
 * Durability prefers CapturePipelineModule native file; AsyncStorage is fallback.
 */
import { DeviceEventEmitter, InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CapturePipeline from '../../shared/native/CapturePipeline';

const STORAGE_KEY = 'capture_queue_pending_v1';

export const CAPTURE_QUEUE_CHANGE = 'CAPTURE_QUEUE_CHANGE';

class CaptureQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.processor = null;
    this.deferGate = null;
    this.maxRetries = 4;
    this.deferPollMs = 50;
    this.maxDeferMs = 15000;
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
      const json = JSON.stringify(this.queue);
      const nativeOk = await CapturePipeline.persistQueue(json);
      if (!nativeOk) {
        await AsyncStorage.setItem(STORAGE_KEY, json);
      }
    } catch (_) {}
  }

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

  async hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      let saved = await CapturePipeline.loadQueue();
      if (!saved.length) {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) saved = parsed;
        }
      }
      if (Array.isArray(saved) && saved.length) {
        this.queue = [...saved, ...this.queue];
        this._emit();
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
    if (!this.processor) return;
    if (this.queue.length === 0) return;

    this.isProcessing = true;
    try {
      while (this.queue.length > 0) {
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

          await new Promise(resolve => InteractionManager.runAfterInteractions(resolve));
          await this._wait(0);
        } catch (e) {
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
      if (this.queue.length > 0) {
        this._drain();
      }
    }
  }

  async clearGuestJobs() {
    const before = this.queue.length;
    this.queue = this.queue.filter((job) => !job?.isGuest);
    if (this.queue.length !== before) {
      this._emit();
    }
    this.queue = [];
    this._emit();
    await this._flushPersist();
  }
}

export default new CaptureQueue();
