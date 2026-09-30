import { describe, expect, it } from 'vitest';
import { movePage } from '../src/pageEdits';
const pages = () => Array.from({ length: 6 }, (_, i) => ({ pageNumber: i + 1, hasQr: i === 0 || i === 4, thumbnailUrl: '' }));
describe('page reordering', () => {
  it('keeps source identities while moving only continuation pages within an exam', () => {
    const input = pages();
    const fronts = [true, false, false, false, true, false];
    expect(movePage(input, fronts, 3, 1)).toBe(true);
    expect(input.map(page => page.pageNumber)).toEqual([1, 4, 2, 3, 5, 6]);
    expect(fronts).toEqual([true, false, false, false, true, false]);
  });
  it.each([[0, 1], [1, 0], [3, 5], [5, 3], [-1, 2], [2, 6]])('rejects moving %s to %s across a boundary or front page', (from, to) => {
    const input = pages();
    expect(movePage(input, [true, false, false, false, true, false], from, to)).toBe(false);
    expect(input).toEqual(pages());
  });
});
