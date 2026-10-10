import { folderMimeType } from './config';
import type { DriveItem } from './types';
export type TestType = 'LZK' | 'Klausur';
export type Subject = 'Physik' | 'Informatik';
export function topicSlug(topic: string): string {
  const slug = topic.normalize('NFC').trim().replace(/\s+/gu, '-');
  if (!slug || /[/\\\u0000-\u001f\u007f]/u.test(slug) || /^\.+$/.test(slug)) {
    throw new Error('Enter a test topic without slashes or control characters.');
  }
  return slug;
}

export function scanFilename(input: {
  type: TestType;
  subject: Subject;
  course: string;
  topic: string;
  date: string;
}): string {
  if (
    !['LZK', 'Klausur'].includes(input.type) ||
    !['Physik', 'Informatik'].includes(input.subject)
  ) {
    throw new Error('Choose a subject and test type.');
  }
  const course = input.course.trim();
  if (!course || /[\s/\\\u0000-\u001f\u007f]/u.test(course)) {
    throw new Error('Enter a class code without spaces or slashes, for example 8a.');
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(Date.parse(input.date)) ||
    new Date(input.date).toISOString().slice(0, 10) !== input.date
  ) {
    throw new Error('Choose a valid test date.');
  }
  return `${input.date.replace(/-/g, '')}_${input.type === 'Klausur' ? 'KA' : 'LZK'}-${input.subject === 'Physik' ? 'PH' : 'IF'}${course}-${topicSlug(input.topic)}.pdf`;
}

export function nextTestFolderName(items: DriveItem[], topic: string): string {
  const numbers = items
    .filter((item) => item.mimeType === folderMimeType)
    .map((item) => Number(/^(\d+)_/.exec(item.name)?.[1] || 0));
  const next = numbers.reduce((highest, number) => Math.max(highest, number), 0) + 1;
  if (!Number.isSafeInteger(next)) {
    throw new Error('Existing test numbering is too large.');
  }
  return `${String(next).padStart(2, '0')}_${topicSlug(topic)}`;
}
