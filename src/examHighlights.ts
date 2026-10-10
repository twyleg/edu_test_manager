import { documentationHighlightsStorageKey, rememberStudentFolder } from './privacy';

export interface HighlightArea { x: number; y: number; width: number; height: number }
export type ResultField = 'points' | 'mark';
type CourseAreas = Partial<Record<ResultField, HighlightArea>>;
export const defaultHighlight: HighlightArea = { x: .1, y: .1, width: .4, height: .2 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function highlightRectangle(start: { x: number; y: number }, end: { x: number; y: number }): HighlightArea {
  const x = clamp(Math.min(start.x, end.x), 0, 1), y = clamp(Math.min(start.y, end.y), 0, 1);
  return { x, y, width: clamp(Math.max(start.x, end.x), x, 1) - x, height: clamp(Math.max(start.y, end.y), y, 1) - y };
}
export function moveHighlight(area: HighlightArea, key: string, resize: boolean): HighlightArea {
  const dx = key === 'ArrowRight' ? .01 : key === 'ArrowLeft' ? -.01 : 0;
  const dy = key === 'ArrowDown' ? .01 : key === 'ArrowUp' ? -.01 : 0;
  return resize ? { ...area, width: clamp(area.width + dx, .02, 1 - area.x), height: clamp(area.height + dy, .02, 1 - area.y) }
    : { ...area, x: clamp(area.x + dx, 0, 1 - area.width), y: clamp(area.y + dy, 0, 1 - area.height) };
}
function valid(area: unknown): area is HighlightArea {
  if (!area || typeof area !== 'object') return false;
  const value = area as HighlightArea;
  return [value.x, value.y, value.width, value.height].every(Number.isFinite) && value.x >= 0 && value.y >= 0 && value.width >= .02 && value.height >= .02 && value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001;
}
/** Only rectangle coordinates are remembered; no exam content is stored. */
export class ExamHighlights {
  private courses = new Map<string, CourseAreas>();
  private loaded = false;
  private load(): void {
    if (this.loaded || !rememberStudentFolder()) return;
    this.loaded = true;
    try {
      const data = JSON.parse(localStorage.getItem(documentationHighlightsStorageKey) || '{}');
      for (const [course, values] of Object.entries(data)) {
        if (!values || typeof values !== 'object') continue;
        const areas: CourseAreas = {};
        for (const field of ['points', 'mark'] as const) {
          const area = (values as CourseAreas)[field];
          if (valid(area)) areas[field] = area;
        }
        this.courses.set(course, areas);
      }
    } catch { /* Invalid or blocked storage leaves highlight configuration in memory. */ }
  }
  get(course: string, field: ResultField): HighlightArea | undefined { this.load(); return this.courses.get(course)?.[field]; }
  set(course: string, field: ResultField, area?: HighlightArea): void {
    this.load();
    const values = { ...this.courses.get(course) };
    if (area && valid(area)) values[field] = { ...area }; else delete values[field];
    this.courses.set(course, values);
    try {
      if (rememberStudentFolder()) localStorage.setItem(documentationHighlightsStorageKey, JSON.stringify(Object.fromEntries(this.courses)));
      else localStorage.removeItem(documentationHighlightsStorageKey);
    } catch { /* Configuration still works without browser storage. */ }
  }
}
