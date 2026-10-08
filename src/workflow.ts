import { folderMimeType } from './config';
import type { GoogleDrive } from './googleDrive';
import { rememberStudentFolder } from './privacy';
import type { DriveItem } from './types';
import { courseFolderNames, uniqueFolder } from './testStructure';
import { escapeHtml as html } from './view';

export const workflowStorageKey = 'edu-test-manager-workflow-v1';
export interface WorkflowPaths { input?: DriveItem; csv?: DriveItem; course?: DriveItem; test?: DriveItem }
export function loadWorkflow(): WorkflowPaths {
  if (!rememberStudentFolder()) return {};
  try {
    const saved = JSON.parse(localStorage.getItem(workflowStorageKey) || '{}');
    const paths: WorkflowPaths = {};
    for (const key of ['input', 'csv', 'course', 'test'] as const) {
      const item = saved[key];
      if (item && typeof item.id === 'string' && item.id && typeof item.name === 'string' && typeof item.mimeType === 'string'
        && (key === 'csv' ? /\.csv$/i.test(item.name) : item.mimeType === folderMimeType)) paths[key] = item;
    }
    return paths;
  } catch { return {}; }
}
export function saveWorkflow(paths: WorkflowPaths): void {
  try {
    if (rememberStudentFolder()) localStorage.setItem(workflowStorageKey, JSON.stringify(paths));
    else localStorage.removeItem(workflowStorageKey);
  } catch { /* Settings still work in memory. */ }
}
export async function listCourseTests(drive: GoogleDrive, course: DriveItem): Promise<DriveItem[]> {
  const children = await drive.listFolderItems(course.id);
  const tests: DriveItem[] = [];
  for (const name of courseFolderNames) {
    const category = uniqueFolder(children, name);
    if (!category) continue;
    for (const test of await drive.listFolderItems(category.id, folderMimeType)) {
      tests.push({ ...test, name: `${category.name} / ${test.name}` });
    }
  }
  return tests;
}
export async function testFolders(drive: GoogleDrive, test: DriveItem): Promise<{ corrected?: DriveItem; split?: DriveItem; previews?: DriveItem }> {
  const items = await drive.listFolderItems(test.id, folderMimeType);
  const find = (name: string) => {
    const matches = items.filter(item => item.name === name);
    if (matches.length > 1) throw new Error(`Resolve duplicate ${name} folders in the selected test.`);
    return matches[0];
  };
  return { corrected: find('02_Korrigiert'), split: find('03_Split'), previews: find('04_Previews') };
}
export function renderWorkflowInputs(paths: WorkflowPaths, locked: boolean, ready: boolean, tests: DriveItem[], access: boolean, testMenuOpen = false): string {
  return `<div class="topbar-inputs" role="group" aria-label="Workflow inputs">
    ${(['course', 'csv'] as const).map((key, index) => `<button id="workflow-${key}" class="topbar-input ${paths[key] ? 'is-selected' : ''}" title="${html(paths[key]?.name || ['Choose course directory', 'Choose student list'][index])}" aria-label="${html(`${['Course directory', 'Student list file'][index]}: ${paths[key]?.name || 'Choose…'}`)}" ${locked || !ready ? 'disabled' : ''}>
      <span class="topbar-input-label">${['Course', 'Students'][index]}</span><span class="topbar-input-value">${html(paths[key]?.name || 'Choose…')}</span><span class="topbar-input-chevron" aria-hidden="true">⌄</span>
    </button>`).join('')}
    <div class="topbar-test">
      <button id="workflow-test" class="topbar-input ${paths.test ? 'is-selected' : ''}" aria-expanded="${testMenuOpen}" aria-controls="workflow-test-menu" title="${html(paths.test?.name || 'Choose a test')}" ${locked || !ready ? 'disabled' : ''}>
        <span class="topbar-input-label">Current test</span><span class="topbar-input-value">${html(paths.test?.name.split(' / ').at(-1) || 'Choose…')}</span><span class="topbar-input-chevron" aria-hidden="true">⌄</span>
      </button>
      <section id="workflow-test-menu" class="test-menu" aria-label="Test selection" ${testMenuOpen ? '' : 'hidden'}>
        <div class="test-menu-heading"><strong>Choose a test</strong><span>${html(paths.course?.name || 'Select a course first')}</span></div>
        ${!access ? `<div class="test-menu-empty"><p>Enable folder access to see the tests in your course.</p><button id="workflow-access" class="btn btn-sm btn-outline-primary" ${locked || !ready ? 'disabled' : ''}>Enable folder access</button></div>` : !paths.course ? '<p class="test-menu-empty">Choose your course in the topbar to see its tests.</p>' : !tests.length ? '<p class="test-menu-empty">No tests yet. Create your first test below.</p>' : `<div class="test-menu-list">${tests.map((test, index) => {
          const parts = test.name.split(' / ');
          return `<button id="test-choice-${index}" class="test-menu-choice" data-test-id="${html(test.id)}" aria-pressed="${paths.test?.id === test.id}" ${locked ? 'disabled' : ''}><span><strong>${html(parts.at(-1)!)}</strong>${parts.length > 1 ? `<small>${html(parts.slice(0, -1).join(' / '))}</small>` : ''}</span><span class="test-menu-check" aria-hidden="true">${paths.test?.id === test.id ? '✓' : ''}</span></button>`;
        }).join('')}</div>`}
        ${access && paths.course ? `<div class="test-menu-create"><button id="test-new" class="btn btn-sm btn-primary" ${locked ? 'disabled' : ''}>+ Create a new test</button></div><div class="test-menu-footer"><button id="workflow-refresh" class="btn btn-sm btn-outline-secondary" ${locked ? 'disabled' : ''}>Refresh tests</button>${paths.test ? `<button id="test-clear" class="btn btn-sm btn-link" data-test-id="" ${locked ? 'disabled' : ''}>Clear selection</button>` : ''}</div>` : ''}
      </section>
    </div>
  </div>`;
}
