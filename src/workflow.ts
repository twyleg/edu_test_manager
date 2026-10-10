import { folderMimeType } from './config';
import type { GoogleDrive } from './googleDrive';
import { rememberStudentFolder } from './privacy';
import type { DriveItem } from './types';
import { courseFolderNames, uniqueFolder } from './testStructure';
import { escapeHtml as html } from './view';

export const workflowStorageKey = 'edu-test-manager-workflow-v1';
export interface WorkflowPaths {
  input?: DriveItem;
  csv?: DriveItem;
  course?: DriveItem;
  test?: DriveItem;
  recentCourses?: DriveItem[];
  recentStudentLists?: DriveItem[];
}

function isCourseFolder(item: unknown): item is DriveItem {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const folder = item as DriveItem;
  return (
    typeof folder.id === 'string' &&
    Boolean(folder.id) &&
    typeof folder.name === 'string' &&
    folder.mimeType === folderMimeType
  );
}

export function rememberCourse(paths: WorkflowPaths, course: DriveItem): void {
  paths.recentCourses = [course, ...(paths.recentCourses || [])]
    .filter(
      (folder, index, courses) => courses.findIndex((entry) => entry.id === folder.id) === index,
    )
    .slice(0, 10);
}

function isStudentList(item: unknown): item is DriveItem {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const file = item as DriveItem;
  return (
    typeof file.id === 'string' &&
    Boolean(file.id) &&
    typeof file.name === 'string' &&
    /\.csv$/i.test(file.name) &&
    typeof file.mimeType === 'string' &&
    file.mimeType !== folderMimeType
  );
}

export function rememberStudentList(paths: WorkflowPaths, file: DriveItem): void {
  paths.recentStudentLists = [file, ...(paths.recentStudentLists || [])]
    .filter(
      (entry, index, files) => files.findIndex((candidate) => candidate.id === entry.id) === index,
    )
    .slice(0, 10);
}

export function loadWorkflow(): WorkflowPaths {
  if (!rememberStudentFolder()) {
    return {};
  }
  try {
    const saved = JSON.parse(localStorage.getItem(workflowStorageKey) || '{}');
    const paths: WorkflowPaths = {};
    for (const key of ['input', 'csv', 'course', 'test'] as const) {
      const item = saved[key];
      if (
        item &&
        typeof item.id === 'string' &&
        item.id &&
        typeof item.name === 'string' &&
        typeof item.mimeType === 'string' &&
        (key === 'csv' ? /\.csv$/i.test(item.name) : item.mimeType === folderMimeType)
      ) {
        paths[key] = item;
      }
    }
    paths.recentCourses = [];
    if (Array.isArray(saved.recentCourses)) {
      for (const course of saved.recentCourses.filter(isCourseFolder).reverse()) {
        rememberCourse(paths, course);
      }
    }
    if (paths.course) {
      rememberCourse(paths, paths.course);
    }

    paths.recentStudentLists = [];
    if (Array.isArray(saved.recentStudentLists)) {
      for (const file of saved.recentStudentLists.filter(isStudentList).reverse()) {
        rememberStudentList(paths, file);
      }
    }
    if (paths.csv) {
      rememberStudentList(paths, paths.csv);
    }
    return paths;
  } catch {
    return {};
  }
}
export function saveWorkflow(paths: WorkflowPaths): void {
  try {
    if (rememberStudentFolder()) {
      localStorage.setItem(workflowStorageKey, JSON.stringify(paths));
    } else {
      localStorage.removeItem(workflowStorageKey);
    }
  } catch {
    /* Settings still work in memory. */
  }
}
export async function listCourseTests(drive: GoogleDrive, course: DriveItem): Promise<DriveItem[]> {
  const children = await drive.listFolderItems(course.id);
  const tests: DriveItem[] = [];
  for (const name of courseFolderNames) {
    const category = uniqueFolder(children, name);
    if (!category) {
      continue;
    }
    for (const test of await drive.listFolderItems(category.id, folderMimeType)) {
      tests.push({ ...test, name: `${category.name} / ${test.name}` });
    }
  }
  return tests;
}
export async function testFolders(
  drive: GoogleDrive,
  test: DriveItem,
): Promise<{ corrected?: DriveItem; split?: DriveItem; previews?: DriveItem }> {
  const items = await drive.listFolderItems(test.id, folderMimeType);
  const find = (name: string) => {
    const matches = items.filter((item) => item.name === name);
    if (matches.length > 1) {
      throw new Error(`Resolve duplicate ${name} folders in the selected test.`);
    }
    return matches[0];
  };
  return {
    corrected: find('02_Korrigiert'),
    split: find('03_Split'),
    previews: find('04_Previews'),
  };
}
export function renderWorkflowInputs(
  paths: WorkflowPaths,
  locked: boolean,
  ready: boolean,
  tests: DriveItem[],
  access: boolean,
  testMenuOpen = false,
  courseMenuOpen = false,
  studentMenuOpen = false,
): string {
  return `<div class="topbar-inputs" role="group" aria-label="Workflow inputs">
    <div class="topbar-course">
      <button id="workflow-course" class="topbar-input ${paths.course ? 'is-selected' : ''}" aria-expanded="${courseMenuOpen}" aria-controls="workflow-course-menu" aria-label="${html(`Course directory: ${paths.course?.name || 'Choose…'}`)}" title="${html(paths.course?.name || 'Choose course directory')}" ${locked || !ready ? 'disabled' : ''}>
        <span class="topbar-input-label">Course</span><span class="topbar-input-value">${html(paths.course?.name || 'Choose…')}</span><span class="topbar-input-chevron" aria-hidden="true">⌄</span>
      </button>
      <section id="workflow-course-menu" class="test-menu course-menu" aria-label="Course selection" ${courseMenuOpen ? '' : 'hidden'}>
        <div class="test-menu-heading"><strong>Recent courses</strong><span>Switch courses or choose another folder</span></div>
        ${paths.recentCourses?.length ? `<div class="test-menu-list">${paths.recentCourses.map((course, index) => `<button id="course-choice-${index}" class="test-menu-choice" data-course-id="${html(course.id)}" aria-pressed="${paths.course?.id === course.id}" ${locked ? 'disabled' : ''}><span><strong>${html(course.name)}</strong></span><span class="test-menu-check" aria-hidden="true">${paths.course?.id === course.id ? '✓' : ''}</span></button>`).join('')}</div>` : '<p class="test-menu-empty">No recent courses yet. Pick a course folder below.</p>'}
        <div class="test-menu-create"><button id="course-pick" class="btn btn-sm btn-primary" ${locked || !ready ? 'disabled' : ''}>Pick course from Google Drive</button></div>
      </section>
    </div>
    <div class="topbar-students">
    <button id="workflow-csv" class="topbar-input ${paths.csv ? 'is-selected' : ''}" aria-expanded="${studentMenuOpen}" aria-controls="workflow-student-menu" title="${html(paths.csv?.name || 'Choose student list')}" aria-label="${html(`Student list file: ${paths.csv?.name || 'Choose…'}`)}" ${locked || !ready ? 'disabled' : ''}>
      <span class="topbar-input-label">Students</span><span class="topbar-input-value">${html(paths.csv?.name || 'Choose…')}</span><span class="topbar-input-chevron" aria-hidden="true">⌄</span>
    </button>
      <section id="workflow-student-menu" class="test-menu" aria-label="Student list selection" ${studentMenuOpen ? '' : 'hidden'}>
        <div class="test-menu-heading"><strong>Recent student lists</strong><span>Switch lists or choose another CSV file</span></div>
        ${paths.recentStudentLists?.length ? `<div class="test-menu-list">${paths.recentStudentLists.map((file, index) => `<button id="student-list-choice-${index}" class="test-menu-choice" data-student-list-id="${html(file.id)}" aria-pressed="${paths.csv?.id === file.id}" ${locked ? 'disabled' : ''}><span><strong>${html(file.name)}</strong></span><span class="test-menu-check" aria-hidden="true">${paths.csv?.id === file.id ? '✓' : ''}</span></button>`).join('')}</div>` : '<p class="test-menu-empty">No recent student lists yet. Pick a CSV file below.</p>'}
        <div class="test-menu-create"><button id="student-list-pick" class="btn btn-sm btn-primary" ${locked || !ready ? 'disabled' : ''}>Pick student list from Google Drive</button></div>
      </section>
    </div>
    <div class="topbar-test">
      <button id="workflow-test" class="topbar-input ${paths.test ? 'is-selected' : ''}" aria-expanded="${testMenuOpen}" aria-controls="workflow-test-menu" title="${html(paths.test?.name || 'Choose a test')}" ${locked || !ready ? 'disabled' : ''}>
        <span class="topbar-input-label">Current test</span><span class="topbar-input-value">${html(paths.test?.name.split(' / ').at(-1) || 'Choose…')}</span><span class="topbar-input-chevron" aria-hidden="true">⌄</span>
      </button>
      <section id="workflow-test-menu" class="test-menu" aria-label="Test selection" ${testMenuOpen ? '' : 'hidden'}>
        <div class="test-menu-heading"><strong>Choose a test</strong><span>${html(paths.course?.name || 'Select a course first')}</span></div>
        ${
          !access
            ? `<div class="test-menu-empty"><p>Connect Google in the header to see the tests in your course.</p></div>`
            : !paths.course
              ? '<p class="test-menu-empty">Choose your course in the topbar to see its tests.</p>'
              : !tests.length
                ? '<p class="test-menu-empty">No tests yet. Create your first test below.</p>'
                : `<div class="test-menu-list">${tests
                    .map((test, index) => {
                      const parts = test.name.split(' / ');
                      return `<button id="test-choice-${index}" class="test-menu-choice" data-test-id="${html(test.id)}" aria-pressed="${paths.test?.id === test.id}" ${locked ? 'disabled' : ''}><span><strong>${html(parts.at(-1)!)}</strong>${parts.length > 1 ? `<small>${html(parts.slice(0, -1).join(' / '))}</small>` : ''}</span><span class="test-menu-check" aria-hidden="true">${paths.test?.id === test.id ? '✓' : ''}</span></button>`;
                    })
                    .join('')}</div>`
        }
        ${access && paths.course ? `<div class="test-menu-create"><button id="test-new" class="btn btn-sm btn-primary" ${locked ? 'disabled' : ''}>+ Create a new test</button></div><div class="test-menu-footer"><button id="workflow-refresh" class="btn btn-sm btn-outline-secondary" ${locked ? 'disabled' : ''}>Refresh tests</button>${paths.test ? `<button id="test-clear" class="btn btn-sm btn-link" data-test-id="" ${locked ? 'disabled' : ''}>Clear selection</button>` : ''}</div>` : ''}
      </section>
    </div>
  </div>`;
}
