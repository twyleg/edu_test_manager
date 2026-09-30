import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { QrScanner } from './qrScanner';
import { examFilename, groupPages } from './grouping';
import type { ExamFile, PageScan } from './types';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function scanPdf(
  bytes: Uint8Array,
  onProgress: (completed: number, total: number) => void,
  signal: AbortSignal,
  threads = 2,
): Promise<PageScan[]> {
  if (!Number.isInteger(threads) || threads < 1 || threads > 8) {
    throw new Error('Choose between 1 and 8 scan threads.');
  }
  signal.throwIfAborted();
  // PDF.js transfers its input buffer. Retain the original for lossless splitting.
  const loading = getDocument({ data: bytes.slice() });
  loading.onPassword = () => { void loading.destroy(); };
  const scanners: QrScanner[] = [];
  const results: PageScan[] = [];
  let stopped = false;
  const stop = () => {
    stopped = true;
    scanners.forEach(scanner => scanner.stop());
    void loading.destroy();
  };
  const check = () => {
    signal.throwIfAborted();
    if (stopped) throw new Error('Scan stopped.');
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const pdf = await loading.promise;
    check();
    onProgress(0, pdf.numPages);
    let nextPage = 1;
    let completed = 0;
    const run = async (scanner: QrScanner) => {
      while (nextPage <= pdf.numPages) {
        check();
        const pageNumber = nextPage++;
        const page = await pdf.getPage(pageNumber);
        const original = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        try {
          let hasQr = false;
          for (const longestSide of [1600, 2600]) {
            check();
            const viewport = page.getViewport({ scale: longestSide / Math.max(original.width, original.height) });
            canvas.width = Math.ceil(viewport.width);
            // The smaller canvas clips rendering to the full-width top 20%.
            canvas.height = Math.ceil(viewport.height * 0.2);
            await page.render({ canvas, canvasContext: context, viewport }).promise;
            check();
            hasQr = await scanner.detect(context.getImageData(0, 0, canvas.width, canvas.height));
            if (hasQr) break;
          }
          check();
          // Render a separate, inexpensive full-page preview, preserving review context.
          const viewport = page.getViewport({ scale: 240 / original.width });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
            value => value ? resolve(value) : reject(new Error('Could not create page preview.')), 'image/jpeg', 0.75,
          ));
          check();
          results[pageNumber - 1] = { pageNumber, hasQr, thumbnailUrl: URL.createObjectURL(blob) };
          onProgress(++completed, pdf.numPages);
        } finally {
          canvas.width = canvas.height = 0;
          page.cleanup();
        }
      }
    };
    for (let index = 0; index < Math.min(threads, pdf.numPages); index++) scanners.push(new QrScanner());
    // Wait for every runner to settle before reclaiming previews on failure.
    const outcomes = await Promise.allSettled(scanners.map(scanner => run(scanner).catch(error => {
      stop();
      throw error;
    })));
    const failure = outcomes.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    check();
    return results;
  } catch (error) {
    results.forEach(page => URL.revokeObjectURL(page.thumbnailUrl));
    if (signal.aborted) throw new DOMException('Scan cancelled.', 'AbortError');
    throw new Error('Could not read this PDF. Use an unencrypted, valid PDF. ' + (error instanceof Error ? error.message : ''));
  } finally {
    signal.removeEventListener('abort', stop);
    scanners.forEach(scanner => scanner.stop());
    await loading.destroy();
  }
}

export async function splitPdf(bytes: Uint8Array, name: string, pages: PageScan[], frontPages: boolean[]): Promise<ExamFile[]> {
  const ranges = groupPages(frontPages);
  const source = await PDFDocument.load(bytes);
  if (source.getPageCount() !== frontPages.length) throw new Error('Page count changed. Please scan the PDF again.');
  const files: ExamFile[] = [];
  try {
    for (const [index, range] of ranges.entries()) {
      const output = await PDFDocument.create();
      const indices = Array.from({ length: range.end - range.start + 1 }, (_, offset) => range.start - 1 + offset);
      const copied = await output.copyPages(source, indices);
      copied.forEach(page => output.addPage(page));
      const blob = new Blob([new Uint8Array(await output.save())], { type: 'application/pdf' });
      files.push({ ...range, name: examFilename(name, index, range), blob,
        previewUrl: URL.createObjectURL(blob), thumbnailUrl: pages[range.start - 1].thumbnailUrl, uploaded: false });
    }
    return files;
  } catch (error) {
    files.forEach(file => URL.revokeObjectURL(file.previewUrl));
    throw error;
  }
}

export async function renderPagePreview(bytes: Uint8Array, pageNumber: number, canvas: HTMLCanvasElement, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const loading = getDocument({ data: bytes.slice() });
  const abort = () => { void loading.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  loading.onPassword = abort;
  try {
    const pdf = await loading.promise;
    signal.throwIfAborted();
    const page = await pdf.getPage(pageNumber);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 2200 / Math.max(original.width, original.height) });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
  } finally {
    signal.removeEventListener('abort', abort);
    await loading.destroy();
    if (signal.aborted) canvas.width = canvas.height = 0;
  }
}
