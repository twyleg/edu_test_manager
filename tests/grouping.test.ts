import { describe, expect, it } from 'vitest';
import { examFilename, groupPages } from '../src/grouping';

describe('QR front-page grouping', () => {
  it('includes each front page, intermediate pages and trailing pages exactly once', () => {
    expect(groupPages([true, false, true, false, false, true, false])).toEqual([
      { start: 1, end: 2 }, { start: 3, end: 5 }, { start: 6, end: 7 },
    ]);
  });
  it('supports consecutive markers and a marker on the final page', () => {
    expect(groupPages([true, true, true])).toEqual([{ start: 1, end: 1 }, { start: 2, end: 2 }, { start: 3, end: 3 }]);
  });
  it('retains an entire exam with only one marker', () => {
    expect(groupPages([true, false, false])).toEqual([{ start: 1, end: 3 }]);
    expect(groupPages([true])).toEqual([{ start: 1, end: 1 }]);
  });
  it('refuses empty documents or scans without markers', () => {
    expect(() => groupPages([])).toThrow('no pages');
    expect(() => groupPages([false, false])).toThrow('No QR markers');
  });
  it('does not silently discard leading pages', () => {
    expect(() => groupPages([false, true, false])).toThrow('Page 1');
  });
  it('uses deterministic numbered names without QR payloads', () => {
    expect(examFilename('Physics.PDF', 0, { start: 1, end: 3 })).toBe('Physics_exam-001_pages-1-3.pdf');
    expect(examFilename('folder/test.pdf', 12, { start: 20, end: 21 })).toBe('folder_test_exam-013_pages-20-21.pdf');
  });
});
