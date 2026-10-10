import type { DriveItem } from './types';
import { escapeHtml as html } from './view';

export function renderTaskInputs(
  folder: DriveItem | undefined,
  csv: DriveItem | undefined,
  expectedFolder: string,
): string {
  return `<div class="derived-inputs" aria-label="Inputs from current test">
    <div><span>Exam PDFs</span><strong>${html(folder?.name || `${expectedFolder} not available`)}</strong><small>${folder ? 'From the current test' : expectedFolder === '04_Previews' ? 'Select a test and create previews in Match students.' : 'Select a current test with a 03_Split folder.'}</small></div>
    <div><span>Student list</span><strong>${html(csv?.name || 'Choose a student list in the topbar')}</strong><small>Shared across tasks</small></div>
  </div>`;
}
