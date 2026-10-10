import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';

export interface CachedExam {
  bytes: Uint8Array;
  corner: Blob;
}
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
  private courseId?: string;
  private entries = new Map<string, CachedExam & { checksum?: string }>();
  private pending = new Map<string, PendingExam>();
  private cachedBytes = 0;

  constructor(
    private drive: Pick<GoogleDrive, 'downloadPdf'>,
    private renderCorner: (bytes: Uint8Array, signal: AbortSignal) => Promise<Blob> = async (
      bytes,
      signal,
    ) => {
      const { renderNameCropBlob } = await import('./pdf');
      return renderNameCropBlob(bytes, signal);
    },
    private maxCacheBytes = 128 * 1024 * 1024,
  ) {}

  setCourse(id?: string): void {
    if (this.courseId === id) {
      return;
    }

    this.clear();
    this.courseId = id;
  }

  clear(): void {
    for (const entry of this.pending.values()) {
      entry.controller.abort();
    }
    this.pending.clear();
    this.entries.clear();
    this.cachedBytes = 0;
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      this.cachedBytes -= entry.bytes.byteLength + entry.corner.size;
    }
    this.entries.delete(id);
  }

  private startDownload(item: DriveItem): PendingExam {
    const controller = new AbortController();
    const pending: PendingExam = {
      checksum: item.md5Checksum,
      controller,
      users: 0,
      progress: new Set(),
      promise: undefined!,
    };

    pending.promise = (async () => {
      const bytes = await this.drive.downloadPdf(item, controller.signal, (received, total) => {
        for (const listener of pending.progress) {
          listener(received, total);
        }
      });
      const corner = await this.renderCorner(bytes, controller.signal);
      controller.signal.throwIfAborted();

      const result = { bytes, corner, checksum: item.md5Checksum };
      const entryBytes = bytes.byteLength + corner.size;
      if (entryBytes <= this.maxCacheBytes) {
        while (this.cachedBytes + entryBytes > this.maxCacheBytes && this.entries.size) {
          this.remove(this.entries.keys().next().value!);
        }
        this.entries.set(item.id, result);
        this.cachedBytes += entryBytes;
      }

      return result;
    })().finally(() => {
      // A stale download must not remove a newer request for the same Drive file.
      if (this.pending.get(item.id) === pending) {
        this.pending.delete(item.id);
      }
    });
    this.pending.set(item.id, pending);

    return pending;
  }

  async get(item: DriveItem, signal: AbortSignal, onProgress?: Progress): Promise<CachedExam> {
    signal.throwIfAborted();
    const cached = this.entries.get(item.id);
    if (cached && cached.checksum === item.md5Checksum) {
      // Map insertion order tracks recency for eviction.
      this.entries.delete(item.id);
      this.entries.set(item.id, cached);
      onProgress?.(cached.bytes.byteLength, cached.bytes.byteLength);
      return cached;
    }
    if (cached) {
      this.remove(item.id);
    }

    let entry = this.pending.get(item.id);
    if (entry && (entry.checksum !== item.md5Checksum || entry.controller.signal.aborted)) {
      entry.controller.abort();
      this.pending.delete(item.id);
      entry = undefined;
    }
    if (!entry) {
      entry = this.startDownload(item);
    }

    const activeDownload = entry;
    activeDownload.users++;
    if (onProgress) {
      activeDownload.progress.add(onProgress);
    }

    let rejectOnAbort!: () => void;
    const cancellation = new Promise<never>((_, reject) => {
      rejectOnAbort = () =>
        reject(signal.reason || new DOMException('Loading cancelled', 'AbortError'));
      signal.addEventListener('abort', rejectOnAbort, { once: true });
    });

    try {
      return await Promise.race([activeDownload.promise, cancellation]);
    } finally {
      signal.removeEventListener('abort', rejectOnAbort);
      if (onProgress) {
        activeDownload.progress.delete(onProgress);
      }
      // Cancelling one consumer must not cancel a download another task still needs.
      activeDownload.users--;
      if (activeDownload.users === 0 && this.pending.get(item.id) === activeDownload) {
        activeDownload.controller.abort();
      }
    }
  }
}
