import type { PageScan } from './types';

/** Indices are review positions; pageNumber remains the immutable source page. */
export function movePage(pages: PageScan[], fronts: boolean[], from: number, to: number): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length || fronts[from]) return false;
  let start = from;
  while (start >= 0 && !fronts[start]) start--;
  if (start < 0) return false;
  let end = start + 1;
  while (end < pages.length && !fronts[end]) end++;
  if (to <= start || to >= end) return false;
  const [page] = pages.splice(from, 1);
  pages.splice(to, 0, page);
  return true;
}
