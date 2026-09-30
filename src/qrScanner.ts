/** One outstanding detection per worker; pixel buffers are transferred, not copied. */
export class QrScanner {
  private worker = new Worker(new URL('./qr.worker.ts', import.meta.url), { type: 'module' });
  private reject?: (error: Error) => void;
  private stopped = false;

  detect(image: ImageData): Promise<boolean> {
    if (this.stopped) return Promise.reject(new Error('QR worker stopped.'));
    return new Promise((resolve, reject) => {
      this.reject = reject;
      this.worker.onmessage = (event: MessageEvent<{ hasQr: boolean; error?: string }>) => {
        this.reject = undefined;
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.hasQr);
      };
      this.worker.onerror = event => {
        event.preventDefault();
        this.reject = undefined;
        reject(new Error(event.message || 'Could not run QR worker.'));
      };
      this.worker.postMessage({ data: image.data, width: image.width, height: image.height }, [image.data.buffer]);
    });
  }

  stop(): void {
    this.stopped = true;
    this.worker.terminate();
    this.reject?.(new Error('QR worker stopped.'));
    this.reject = undefined;
  }
}
