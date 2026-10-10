import { describe, expect, it } from 'vitest';
import { rememberCourse, rememberStudentList, type WorkflowPaths } from '../src/workflow';
import { folderMimeType } from '../src/config';

describe('recent courses', () => {
  it('keeps only ten unique courses, moving revisited courses to the front with their latest name', () => {
    const paths: WorkflowPaths = {};
    for (let index = 0; index < 12; index++) {
      rememberCourse(paths, {
        id: String(index),
        name: `Course ${index}`,
        mimeType: folderMimeType,
      });
    }
    rememberCourse(paths, { id: '5', name: 'Renamed course', mimeType: folderMimeType });
    expect(paths.recentCourses?.map((course) => course.id)).toEqual([
      '5',
      '11',
      '10',
      '9',
      '8',
      '7',
      '6',
      '4',
      '3',
      '2',
    ]);
    expect(paths.recentCourses?.[0].name).toBe('Renamed course');
  });
});

describe('recent student lists', () => {
  it('limits history to ten unique files and refreshes renamed files without changing courses', () => {
    const paths: WorkflowPaths = { course: { id: 'course', name: '8a', mimeType: folderMimeType } };
    for (let index = 0; index < 12; index++) {
      rememberStudentList(paths, {
        id: String(index),
        name: `Class ${index}.csv`,
        mimeType: 'text/csv',
      });
    }
    rememberStudentList(paths, { id: '5', name: 'Updated.csv', mimeType: 'text/csv' });
    expect(paths.recentStudentLists?.map((file) => file.id)).toEqual([
      '5',
      '11',
      '10',
      '9',
      '8',
      '7',
      '6',
      '4',
      '3',
      '2',
    ]);
    expect(paths.recentStudentLists?.[0].name).toBe('Updated.csv');
    expect(paths.course?.id).toBe('course');
  });
});
