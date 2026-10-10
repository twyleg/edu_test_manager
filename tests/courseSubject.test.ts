import { describe, expect, it, vi } from 'vitest';
import { deriveCourseSubject, subjectFromFolderName } from '../src/courseSubject';
import type { GoogleDrive } from '../src/googleDrive';
import type { DriveItem } from '../src/types';
import { folderMimeType } from '../src/config';

const folder = (id: string, name = id): DriveItem => ({ id, name, mimeType: folderMimeType });

describe('subject from course path', () => {
  it.each([
    ['Physik', 'Physik'], ['informatik', 'Informatik'], ['08_Physik_2026', 'Physik'],
    ['8a – Informatik', 'Informatik'], ['8a', undefined], ['Metaphysik', undefined],
    ['Physik und Informatik', undefined],
  ])('recognizes an unambiguous subject in %s', (name, expected) => {
    expect(subjectFromFolderName(name)).toBe(expected);
  });

  it('reads ancestors until the nearest subject and stops before unrelated parents', async () => {
    const parents = new Map([
      ['course', folder('year', '2026-2027')],
      ['year', folder('grade', '08')],
      ['grade', folder('subject', 'Physik')],
      ['subject', folder('outer-subject', 'Informatik')],
    ]);
    const getParentFolder = vi.fn(async (item: DriveItem) => parents.get(item.id)!);
    const drive = { getParentFolder } as unknown as GoogleDrive;
    expect(await deriveCourseSubject(drive, folder('course', '8a'))).toBe('Physik');
    expect(getParentFolder.mock.calls.map(([item]) => item.id)).toEqual(['course', 'year', 'grade']);
  });

  it('uses a subject in the course name without requesting parent folders', async () => {
    const getParentFolder = vi.fn();
    expect(await deriveCourseSubject({ getParentFolder } as unknown as GoogleDrive, folder('course', 'Physik 8a'))).toBe('Physik');
    expect(getParentFolder).not.toHaveBeenCalled();
  });

  it('leaves subject selection available when a parent is unavailable', async () => {
    const getParentFolder = vi.fn(async () => { throw new Error('No accessible parent'); });
    expect(await deriveCourseSubject({ getParentFolder } as unknown as GoogleDrive, folder('course', '8a'))).toBeUndefined();
  });

  it('stops if a path contains a cycle', async () => {
    const course = folder('course', '8a');
    const getParentFolder = vi.fn(async () => course);
    expect(await deriveCourseSubject({ getParentFolder } as unknown as GoogleDrive, course)).toBeUndefined();
    expect(getParentFolder).toHaveBeenCalledTimes(1);
  });
});
