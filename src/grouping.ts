import type { PageRange } from './types';

/** Pages are one-based; never silently discard pages before the first marker. */
export function groupPages(frontPages: readonly boolean[]): PageRange[] {
  if (!frontPages.length) throw new Error('This PDF has no pages.');
  if (!frontPages.some(Boolean)) {
    throw new Error('No QR markers found. Mark the front pages below, or choose another PDF.');
  }
  if (!frontPages[0]) {
    throw new Error('Page 1 has no QR marker. Mark it as a front page before continuing so no pages are left out.');
  }
  const starts = frontPages.flatMap((frontPage, index) => frontPage ? [index + 1] : []);
  return starts.map((start, index) => ({ start, end: (starts[index + 1] ?? frontPages.length + 1) - 1 }));
}

export function examFilename(sourceName: string, index: number, range: PageRange): string {
  const stem = sourceName.replace(/\.pdf$/i, '').replace(/[\u0000-\u001f/\\]/g, '_').trim() || 'exam';
  return `${stem}_exam-${String(index + 1).padStart(3, '0')}_pages-${range.start}-${range.end}.pdf`;
}
