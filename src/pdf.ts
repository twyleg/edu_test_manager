import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import jsQR from 'jsqr';
import { examFilename, groupPages } from './grouping';
import type { ExamFile, PageScan } from './types';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function scanPdf(
  bytes: Uint8Array,
  onProgress: (completed: number, total: number) => void,
  signal: AbortSignal,
): Promise<PageScan[]> {
  // PDF.js transfers its input buffer to its worker. Keep our source intact for splitting.
  const loading = getDocument({ data: bytes.slice() });
  loading.onPassword = () => { void loading.destroy(); };
  const abort = () => { void loading.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  const results: PageScan[] = [];
  try {
    signal.throwIfAborted();
    const pdf = await loading.promise;
    onProgress(0, pdf.numPages);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      const original = page.getViewport({ scale: 1 });
      // Bounded resolution keeps large scans manageable. Retry small codes at a higher resolution.
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      let hasQr = false;
      for (const longestSide of [1600, 2600]) {
        signal.throwIfAborted();
        const viewport = page.getViewport({ scale: longestSide / Math.max(original.width, original.height) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        signal.throwIfAborted();
        // The sample's code is in the top-left. Fall back to the entire page to
        // support shifted or rotated scans. QR payloads are deliberately ignored.
        const corner = context.getImageData(0, 0, Math.ceil(canvas.width * 0.4), Math.ceil(canvas.height * 0.35));
        hasQr = Boolean(jsQR(corner.data, corner.width, corner.height, { inversionAttempts: 'attemptBoth' }));
        if (!hasQr) {
          const full = context.getImageData(0, 0, canvas.width, canvas.height);
          hasQr = Boolean(jsQR(full.data, full.width, full.height, { inversionAttempts: 'attemptBoth' }));
        }
        if (hasQr) break;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 240;
      thumbnail.height = Math.round(canvas.height * 240 / canvas.width);
      thumbnail.getContext('2d')!.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
      const blob = await new Promise<Blob>((resolve, reject) => thumbnail.toBlob(
        value => value ? resolve(value) : reject(new Error('Could not create page preview.')), 'image/jpeg', 0.75,
      ));
      results.push({ pageNumber, hasQr, thumbnailUrl: URL.createObjectURL(blob) });
      canvas.width = canvas.height = 0;
      page.cleanup();
      onProgress(pageNumber, pdf.numPages);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return results;
  } catch (error) {
    results.forEach(page => URL.revokeObjectURL(page.thumbnailUrl));
    if (signal.aborted) throw new DOMException('Scan cancelled.', 'AbortError');
    throw new Error('Could not read this PDF. Use an unencrypted, valid PDF. ' + (error instanceof Error ? error.message : ''));
  } finally {
    signal.removeEventListener('abort', abort);
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
