import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultHighlight,
  ExamHighlights,
  highlightRectangle,
  moveHighlight,
} from '../src/examHighlights';
const settings = vi.hoisted(() => ({ remember: true }));
vi.mock('../src/privacy', () => ({
  documentationHighlightsStorageKey: 'highlights',
  rememberStudentFolder: () => settings.remember,
}));

beforeEach(() => {
  settings.remember = true;
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
describe('preview highlights', () => {
  it('creates a rectangle from a reverse drag and clamps selection to the image', () => {
    expect(highlightRectangle({ x: 0.7, y: 0.8 }, { x: 0.2, y: 0.3 })).toMatchObject({
      x: 0.2,
      y: 0.3,
    });
    expect(highlightRectangle({ x: -0.5, y: -0.1 }, { x: 2, y: 3 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
  it('supports keyboard moving and resizing within the image bounds', () => {
    expect(moveHighlight(defaultHighlight, 'ArrowRight', false).x).toBeCloseTo(0.11);
    expect(moveHighlight(defaultHighlight, 'ArrowDown', true).height).toBeCloseTo(0.21);
    expect(
      moveHighlight({ x: 0.8, y: 0.8, width: 0.2, height: 0.2 }, 'ArrowRight', false).x,
    ).toBeCloseTo(0.8);
    expect(
      moveHighlight({ x: 0.8, y: 0.8, width: 0.2, height: 0.2 }, 'ArrowDown', true).height,
    ).toBeCloseTo(0.2);
  });
  it('remembers separate points and grade areas for each course', () => {
    const highlights = new ExamHighlights();
    highlights.set('course-a', 'points', defaultHighlight);
    highlights.set('course-a', 'mark', { x: 0.6, y: 0.1, width: 0.2, height: 0.2 });
    expect(new ExamHighlights().get('course-a', 'points')).toEqual(defaultHighlight);
    expect(highlights.get('course-b', 'points')).toBeUndefined();
    highlights.set('course-a', 'points');
    expect(new ExamHighlights().get('course-a', 'points')).toBeUndefined();
    expect(new ExamHighlights().get('course-a', 'mark')?.x).toBe(0.6);
  });
  it('uses memory without writing preferences when remembering is disabled', () => {
    settings.remember = false;
    const highlights = new ExamHighlights();
    highlights.set('course-a', 'points', defaultHighlight);
    expect(highlights.get('course-a', 'points')).toEqual(defaultHighlight);
    expect(localStorage.getItem('highlights')).toBeNull();
    expect(new ExamHighlights().get('course-a', 'points')).toBeUndefined();
  });
  it('ignores malformed or out-of-bounds remembered areas', () => {
    localStorage.setItem(
      'highlights',
      '{"course-a":{"points":{"x":1,"y":0,"width":1,"height":1},"mark":{"x":0,"y":0,"width":0.2,"height":0.2}}}',
    );
    expect(new ExamHighlights().get('course-a', 'points')).toBeUndefined();
    expect(new ExamHighlights().get('course-a', 'mark')).toEqual({
      x: 0,
      y: 0,
      width: 0.2,
      height: 0.2,
    });
  });
});
