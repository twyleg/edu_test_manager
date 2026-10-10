import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';

export interface CachedExam { bytes: Uint8Array; corner: Blob }
type Progress = (received: number, total?: number) => void;
interface PendingExam {
  checksum?: string;
  controller: AbortController;
  promise: Promise<CachedExam>;
  users: number;
  progress: Set<Progress>;
}

/** In-memory course cache. Tasks own their display URLs; eviction never breaks an open preview. */
export class ExamCache {
  private course?: string;
  private entries = new Map<string, CachedExam & { checksum?: string }>();
  private pending = new Map<string, PendingExam>();
  private size = 0;
  constructor(
    private drive: Pick<GoogleDrive, 'downloadPdf'>,
    private render: (bytes: Uint8Array, signal: AbortSignal) => Promise<Blob> = async (bytes, signal) => {
      const { renderNameCropBlob } = await import('./pdf');
      return renderNameCropBlob(bytes, signal);
    },
    private maxBytes = 128 * 1024 * 1024,
  ) {}

  setCourse(id?: string): void {
    if (this.course === id) return;
    this.clear(); this.course = id;
  }
  clear(): void {
    for (const entry of this.pending.values()) entry.controller.abort();
    this.pending.clear(); this.entries.clear(); this.size = 0;
  }
  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry) this.size -= entry.bytes.byteLength + entry.corner.size;
    this.entries.delete(id);
  }
  async get(item: DriveItem, signal: AbortSignal, onProgress?: Progress): Promise<CachedExam> {
    signal.throwIfAborted();
    const cached = this.entries.get(item.id);
    if (cached && cached.checksum === item.md5Checksum) {
      this.entries.delete(item.id); this.entries.set(item.id, cached);
      onProgress?.(cached.bytes.byteLength, cached.bytes.byteLength);
      return cached;
    }
    if (cached) this.remove(item.id);
    let entry = this.pending.get(item.id);
    if (entry && (entry.checksum !== item.md5Checksum || entry.controller.signal.aborted)) {
      entry.controller.abort(); this.pending.delete(item.id); entry = undefined;
    }
    if (!entry) {
      const controller = new AbortController();
      const pending: PendingExam = { checksum: item.md5Checksum, controller, users: 0, progress: new Set(), promise: undefined! };
      pending.promise = (async () => {
        const bytes = await this.drive.downloadPdf(item, controller.signal, (received, total) => {
          for (const listener of pending.progress) listener(received, total);
        });
        const corner = await this.render(bytes, controller.signal);
        controller.signal.throwIfAborted();
        const result = { bytes, corner, checksum: item.md5Checksum };
        const size = bytes.byteLength + corner.size;
        if (size <= this.maxBytes) {
          while (this.size + size > this.maxBytes && this.entries.size) this.remove(this.entries.keys().next().value!);
          this.entries.set(item.id, result); this.size += size;
        }
        return result;
      })().finally(() => { if (this.pending.get(item.id) === pending) this.pending.delete(item.id); });
      this.pending.set(item.id, pending); entry = pending;
    }
    const active = entry;
    active.users++;
    if (onProgress) active.progress.add(onProgress);
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason || new DOMException('Loading cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([active.promise, cancelled]); }
    finally {
      signal.removeEventListener('abort', abort);
      if (onProgress) active.progress.delete(onProgress);
      if (--active.users === 0 && this.pending.get(item.id) === active) active.controller.abort();
    }
  }
}
