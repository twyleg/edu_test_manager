import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import { googleAllowed, localOnly, mountPrivacy } from './privacy';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/main.css';
import { BatchSendTask } from './batchSend';
import { DraftTask } from './drafts';
import { DocumentationTask } from './documentation';
import { ExamCache } from './examCache';
import { MatchingTask } from './matching';
import { ImportTask } from './preparation';
import { deriveCourseSubject } from './courseSubject';
import type { Subject } from './testNames';
import { confirmCourseSetup, openNewTestDialog } from './testDialogs';
import { loadWorkflow, saveWorkflow, listCourseTests, testFolders, renderWorkflowInputs } from './workflow';
import type { DriveItem } from './types';
import { GoogleDrive } from './googleDrive';
import { openPagePreview } from './pagePreview';
import { openNewFolderDialog } from './folderDialog';
import { hasGoogleConfig } from './config';
import { movePage } from './pageEdits';
import { groupPages } from './grouping';
import { renderApp, type AppState } from './view';

const app = document.querySelector<HTMLDivElement>('#app')!;
const drive = new GoogleDrive();
const state: AppState = { task: 'preparation', expanded: { setup: true, review: false, save: false }, ready: false, connected: false, busy: '', pages: [], frontPages: [], files: [],
  uploadStarted: false, message: '', error: '', progress: 0, scanThreads: 2 };
const paths = loadWorkflow();
let tests: DriveItem[] = paths.test ? [paths.test] : [];
let folders: Awaited<ReturnType<typeof testFolders>> = {};
let globalPicker: 'csv' | 'course' | undefined;
let checkedCourse: string | undefined;
const courseSubjects = new Map<string, Promise<Subject | undefined>>();
let correctedPdfs: DriveItem[] = [];
let sliceInputOverride: DriveItem | undefined;
let sliceOutputOverride: DriveItem | undefined;
let sliceTestId = paths.test?.id;
let slicePickerTarget: 'input' | 'output' = 'output';
let refreshingPaths = false;
let testMenuOpen = false;
let sourceBytes: Uint8Array | undefined;
let controller: AbortController | undefined;
let pickerTask: 'preparation' | 'slice' | 'match' | 'drafts' = 'slice';
const examCache = new ExamCache(drive);
examCache.setCourse(paths.course?.id);
const matching = new MatchingTask(drive, render, busy => { state.busy = busy ? 'match' : ''; }, examCache);
const batchSend = new BatchSendTask(drive, render, busy => { state.busy = busy ? 'send' : ''; });
const drafts = new DraftTask(drive, render, busy => { state.busy = busy ? 'drafts' : ''; });
const documentation = new DocumentationTask(drive, render, busy => { state.busy = busy ? 'documentation' : ''; }, examCache);
const preparation = new ImportTask(drive, render, busy => { state.busy = busy ? 'preparation' : ''; }, input => { paths.input = input; saveWorkflow(paths); });

preparation.setPaths(paths.input, paths.course, paths.test);
function pathsLocked(): boolean {
  return Boolean(state.busy || preparation.hasIncompleteJob || matching.hasIncompletePreviewExport || drafts.hasIncompleteBatch || documentation.hasUnsavedChanges || state.uploadStarted);
}
function syncSliceFolders(): void {
  if (sliceTestId !== paths.test?.id) {
    sliceInputOverride = sliceOutputOverride = undefined;
    sliceTestId = paths.test?.id;
  }
  state.inputFolder = sliceInputOverride || folders.corrected;
  state.folder = sliceOutputOverride || folders.split;
}
function applyPaths(): void {
  examCache.setCourse(paths.course?.id);
  preparation.setPaths(paths.input, paths.course, paths.test);
  syncSliceFolders();
  matching.setPaths(folders.split, paths.csv, folders.previews, paths.test);
  documentation.setPaths(paths.course, paths.test, matching.folder || folders.split, paths.csv);
  drafts.setPaths(folders, paths.csv);
  saveWorkflow(paths);
}
async function refreshPaths(): Promise<void> {
  if (refreshingPaths || !drive.matchingAccess || !paths.course) return;
  refreshingPaths = true; state.busy = 'folder'; render();
  try {
    const course = paths.course;
    if (!courseSubjects.has(course.id)) courseSubjects.set(course.id, deriveCourseSubject(drive, course));
    preparation.setDerivedSubject(course.id, await courseSubjects.get(course.id));
    if (checkedCourse !== paths.course.id) {
      await confirmCourseSetup(drive, paths.course);
      checkedCourse = paths.course.id;
    }
    tests = await listCourseTests(drive, paths.course);
    paths.test = tests.find(test => test.id === paths.test?.id);
    folders = paths.test ? await testFolders(drive, paths.test) : {};
    syncSliceFolders();
    correctedPdfs = state.inputFolder ? await drive.listFolderPdfs(state.inputFolder.id) : [];
    applyPaths();
  } catch (error) { state.error = errorMessage(error); }
  finally { refreshingPaths = false; state.busy = ''; render(); }
}
async function loadSliceInput(folder: DriveItem): Promise<void> {
  clearScan(); state.source = state.localFile = undefined;
  sliceInputOverride = folder; state.inputFolder = folder; correctedPdfs = [];
  state.busy = 'folder'; render();
  try { correctedPdfs = await drive.listFolderPdfs(folder.id); }
  catch (error) { state.error = errorMessage(error); }
  finally { state.busy = ''; render(); document.getElementById('slice-file')?.focus(); }
}
async function createTest(): Promise<void> {
  if (!paths.course || !drive.matchingAccess || pathsLocked()) return;
  closeTestMenu(); state.busy = 'folder'; state.error = ''; render();
  try {
    if (!await confirmCourseSetup(drive, paths.course)) return;
    checkedCourse = paths.course.id;
    const test = await openNewTestDialog(drive, paths.course);
    if (!test) return;
    clearScan(); state.source = state.localFile = undefined;
    paths.test = test;
    tests = [...tests.filter(item => item.id !== test.id), test];
    folders = {}; correctedPdfs = []; applyPaths();
    folders = await testFolders(drive, test);
    applyPaths();
    state.task = 'preparation';
  } catch (error) { state.error = errorMessage(error); }
  finally {
    state.busy = ''; render(); document.getElementById('workflow-test')?.focus();
  }
}
function render(): void {
  state.localOnly = localOnly();
  if (state.localOnly) state.task = 'slice';
  state.workflowTest = Boolean(paths.test);
  state.correctedPdfs = state.inputFolder ? correctedPdfs : undefined;
  const focused = document.activeElement?.id;
  app.innerHTML = renderApp(state, state.task === 'match' ? matching.render(state.ready && hasGoogleConfig() && !state.busy, Boolean(paths.course)) : '', state.task === 'drafts' ? drafts.render(state.ready && hasGoogleConfig(), Boolean(paths.course)) : '', state.task === 'send' ? batchSend.render(state.ready && hasGoogleConfig()) : '', state.task === 'preparation' ? preparation.render(state.ready && hasGoogleConfig()) : '', '', renderWorkflowInputs(paths, pathsLocked(), state.ready && state.connected && hasGoogleConfig(), tests, drive.matchingAccess, testMenuOpen), state.task === 'documentation' ? documentation.render(state.connected && !state.busy) : '');
  for (const id of [ paths.csv ? 'match-csv' : '', paths.csv ? 'draft-csv' : '', paths.test ? 'draft-folder' : '']) {
    if (id) document.getElementById(id)?.setAttribute('hidden', '');
  }
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}
// Keep the existing bar mounted so chunk updates do not restart its animation
// or replace the focused progress panel / Cancel button.
function renderProgress(): void {
  const panel = document.getElementById('task-progress');
  const bar = panel?.querySelector<HTMLElement>('[role="progressbar"]');
  if (!panel || !bar) { render(); return; }
  panel.querySelector('[role="status"]')!.textContent = state.message;
  bar.setAttribute('aria-valuetext', state.message);
  bar.classList.toggle('progress-indeterminate', state.progress === null);
  if (state.progress === null) bar.removeAttribute('aria-valuenow');
  else bar.setAttribute('aria-valuenow', String(Math.round(state.progress)));
  bar.querySelector<HTMLElement>('.progress-bar')!.style.width = `${state.progress === null ? 35 : state.progress}%`;
}

function focusSection(id: string): void {
  const element = document.getElementById(id);
  element?.focus({ preventScroll: true });
  if (id !== 'task-progress') element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function reportError(error: unknown): void { state.error = errorMessage(error); render(); }
function clearFiles(): void {
  state.files.forEach(file => URL.revokeObjectURL(file.previewUrl));
  state.files = [];
}
function clearScan(): void {
  clearFiles();
  state.pages.forEach(page => URL.revokeObjectURL(page.thumbnailUrl));
  state.expanded = { setup: true, review: false, save: false };
  state.pages = [];
  state.frontPages = [];
  state.uploadStarted = false;
  sourceBytes = undefined;
  state.message = state.error = '';
  state.progress = 0;
}

async function scan(): Promise<void> {
  if ((!state.source && !state.localFile) || state.busy) return;
  clearScan();
  state.busy = 'scan';
  state.message = state.localFile ? 'Reading PDF…' : 'Connecting to Google Drive for download…';
  state.progress = null;
  controller = new AbortController();
  render();
  focusSection('task-progress');
  try {
    const { scanPdf } = await import('./pdf');
    sourceBytes = state.localFile ? new Uint8Array(await state.localFile.arrayBuffer()) : await drive.downloadPdf(state.source!, controller.signal, (received, total) => {
      state.progress = total ? Math.min(100, received / total * 100) : null;
      const size = (bytes: number) => bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
      state.message = total
        ? `Downloading PDF from Google Drive… ${size(received)} of ${size(total)} (${Math.round(state.progress!)}%)`
        : received ? `Downloading PDF from Google Drive… ${size(received)} received` : 'Downloading PDF from Google Drive… Waiting for data';
      renderProgress();
    });
    state.progress = null;
    state.message = 'Opening PDF for scanning…';
    renderProgress();
    state.pages = await scanPdf(sourceBytes, (completed, total) => {
      state.message = `Scanned ${completed} of ${total} pages for QR markers…`;
      state.progress = completed / total * 100;
      renderProgress();
    }, controller.signal, state.scanThreads);
    state.frontPages = state.pages.map(page => page.hasQr);
    state.expanded = { setup: false, review: true, save: false };
    state.message = `Scan complete. Found ${state.frontPages.filter(Boolean).length} QR-marked front pages in ${state.pages.length} pages.`;
    try { groupPages(state.frontPages); } catch (error) { state.error = errorMessage(error); }
  } catch (error) {
    if (controller.signal.aborted) state.message = 'Scan cancelled. You can start again.';
    else { state.error = errorMessage(error); state.message = ''; }
    sourceBytes = undefined;
  } finally { state.busy = ''; controller = undefined; render(); focusSection(state.pages.length ? 'toggle-review' : 'toggle-setup'); }
}

async function prepare(): Promise<void> {
  if (!sourceBytes || state.busy || state.uploadStarted) return;
  state.error = '';
  state.busy = 'split';
  state.message = 'Preparing individual PDFs…';
  state.progress = null;
  render();
  try {
    focusSection('task-progress');
    const { splitPdf } = await import('./pdf');
    clearFiles();
    state.files = await splitPdf(sourceBytes, state.localFile?.name || state.source!.name, state.pages, state.frontPages);
    state.expanded = { setup: false, review: false, save: true };
    state.message = `${state.files.length} individual PDFs prepared. Preview them below, then save to Drive.`;
  } catch (error) { state.error = errorMessage(error); state.message = ''; }
  finally { state.busy = ''; render(); focusSection(state.files.length ? 'toggle-save' : 'toggle-review'); }
}

async function upload(): Promise<void> {
  if (!state.folder || state.busy || !state.files.length) return;
  state.busy = 'upload';
  state.error = '';
  state.message = 'Checking destination folder…';
  state.progress = null;
  render();
  try {
    focusSection('task-progress');
    await drive.verifyFolder(state.folder);
    // Once uploads begin, preserve names, ranges, destination and IDs until a new batch.
    state.uploadStarted = true;
    for (const [index, file] of state.files.entries()) {
      if (file.uploaded) continue;
      file.error = undefined;
      state.message = `Saving exam ${index + 1} of ${state.files.length} to Google Drive…`;
      state.progress = state.files.filter(item => item.uploaded).length / state.files.length * 100;
      render();
      try {
        file.driveId ??= await drive.generateFileId();
        await drive.uploadPdf(file.driveId, file.name, state.folder.id, file.blob);
        file.uploaded = true;
      } catch (error) {
        file.error = errorMessage(error);
        throw error;
      }
    }
    state.message = `Done! All ${state.files.length} PDFs were saved to “${state.folder.name}”.`;
    state.progress = 100;
    state.expanded.save = false;
  } catch (error) {
    state.error = errorMessage(error);
    const count = state.files.filter(file => file.uploaded).length;
    state.message = `${count} of ${state.files.length} PDFs saved. Fix the issue, then retry the remaining uploads. Keep this tab open.`;
  } finally { state.busy = ''; render(); focusSection('toggle-save'); }
}

async function newFolder(): Promise<void> {
  if (state.busy || state.uploadStarted || !drive.connected) return;
  state.busy = 'folder';
  state.error = '';
  render();
  try {
    const folder = await openNewFolderDialog(drive, state.folder);
    if (folder) { sliceOutputOverride = folder; state.folder = folder; state.message = `Created “${folder.name}” and selected it as the output folder.`; }
  } catch (error) { state.error = errorMessage(error); }
  finally { state.busy = ''; render(); document.getElementById('new-folder')?.focus(); }
}

function closeTestMenu(focus = false): void {
  testMenuOpen = false;
  document.getElementById('workflow-test-menu')?.setAttribute('hidden', '');
  document.getElementById('workflow-test')?.setAttribute('aria-expanded', 'false');
  if (focus) document.getElementById('workflow-test')?.focus();
}
document.addEventListener('pointerdown', event => {
  if (!(event.target as HTMLElement).closest('.topbar-test')) closeTestMenu();
});
document.addEventListener('focusin', event => {
  if (!(event.target as HTMLElement).closest('.topbar-test')) closeTestMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && testMenuOpen) { event.preventDefault(); closeTestMenu(true); }
});

app.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!target || target.disabled) return;
  try {
    if (target.dataset.testId !== undefined) {
      if (pathsLocked()) return;
      paths.test = tests.find(test => test.id === target.dataset.testId);
      folders = {}; correctedPdfs = []; applyPaths();
      clearScan(); state.source = state.localFile = undefined;
      closeTestMenu();
      void refreshPaths().then(() => document.getElementById('workflow-test')?.focus());
      return;
    }
    if (target.id === 'test-new') { if (!pathsLocked()) void createTest(); return; }
    if (target.id.startsWith('workflow-')) {
      if (pathsLocked()) return;
      if (target.id === 'workflow-test') {
        testMenuOpen = !testMenuOpen; render();
        if (testMenuOpen) document.querySelector<HTMLElement>('#workflow-test-menu [aria-pressed="true"], #workflow-test-menu button:not(:disabled)')?.focus();
        return;
      }
      if (target.id === 'workflow-refresh') { void refreshPaths(); return; }
      globalPicker = target.id.slice(9) as typeof globalPicker;
      state.busy = 'picker'; render(); drive.openPicker(globalPicker === 'csv' ? 'csv' : 'folder'); return;
    }
    if (target.dataset.task) {
      if (!state.connected) return;
      state.task = target.dataset.task as AppState['task'];
      if (state.task === 'documentation') documentation.setPaths(paths.course, paths.test, matching.folder || folders.split, paths.csv);
      if (state.task !== 'preparation' && paths.course && drive.matchingAccess && !pathsLocked()) void refreshPaths();
      if (state.task === 'match' && !paths.course) matching.prefill(state.folder);
      if (state.task === 'drafts' && !paths.course) drafts.prefill(matching.folder || state.folder, matching.csv);
      state.error = '';
      render();
      document.getElementById(`task-${state.task}`)?.focus();
      return;
    }
    if (target.id === 'draft-folder' || target.id === 'draft-csv' || target.id === 'draft-extra-drive') {
      globalPicker = undefined; pickerTask = 'drafts'; state.busy = 'picker'; state.error = ''; render();
      drafts.pick(target.id === 'draft-extra-drive' ? 'attachment' : target.id === 'draft-folder' ? 'folder' : 'csv');
      return;
    }
    if (target.id === 'prep-input') {
      globalPicker = undefined; pickerTask = 'preparation'; state.busy = 'picker'; state.error = ''; render();
      preparation.pick();
      return;
    }
    if (state.task === 'preparation' && preparation.handle(target.id)) return;
    if (state.task === 'send' && batchSend.handle(target.id)) return;
    if (state.task === 'documentation' && documentation.handle(target.id)) return;
    if (state.task === 'drafts' && drafts.handle(target.id)) return;
    if (target.id === 'match-folder' || target.id === 'match-csv' || target.id === 'match-output') {
      if (state.busy || matching.hasIncompletePreviewExport) return;
      globalPicker = undefined; pickerTask = 'match'; state.busy = 'picker'; state.error = ''; render();
      matching.pick(target.id === 'match-output' ? 'output' : target.id === 'match-folder' ? 'folder' : 'csv');
      return;
    }
    if (state.task === 'match' && matching.handle(target.id)) return;
    if (target.dataset.subtask) {
      const key = target.dataset.subtask as keyof AppState['expanded'];
      state.expanded[key] = !state.expanded[key];
      render();
      return;
    }
    if (target.dataset.rotate !== undefined && !state.busy && !state.uploadStarted) {
      const page = state.pages[Number(target.dataset.rotate)];
      page.rotation = ((page.rotation || 0) + Number(target.dataset.angle) + 360) % 360;
      editsChanged();
      return;
    }
    if (target.dataset.move !== undefined && !state.busy && !state.uploadStarted) {
      const from = Number(target.dataset.move);
      const to = from + Number(target.dataset.direction);
      if (movePage(state.pages, state.frontPages, from, to)) {
        editsChanged();
        document.getElementById(`move-${target.dataset.direction === '-1' ? 'left' : 'right'}-${to}`)?.focus({ preventScroll: true });
      }
      return;
    }
    if (target.dataset.preview !== undefined && sourceBytes) {
      const page = state.pages[Number(target.dataset.preview)];
      openPagePreview(sourceBytes, page.pageNumber, target.id, page.rotation || 0);
      return;
    }
    switch (target.id) {
      case 'connect':
        if (drive.workflowAccess) {
          if (documentation.hasUnsavedChanges && !window.confirm('Disconnect and discard unsaved documentation entries?')) return;
          state.hasConnected = false;
          sliceInputOverride = sliceOutputOverride = undefined; state.inputFolder = undefined; correctedPdfs = [];
          drive.disconnect(); examCache.clear(); batchSend.reset(); drafts.reset(); matching.reset(); documentation.reset(); preparation.reset(); clearScan(); state.source = state.folder = state.localFile = undefined; render();
        } else { state.busy = 'connect'; state.error = ''; render(); drive.connect(); }
        break;
      case 'choose-slice-input':
        globalPicker = undefined; pickerTask = 'slice'; slicePickerTarget = 'input';
        state.busy = 'picker'; state.error = ''; render();
        drive.openPicker('folder', state.inputFolder?.id);
        break;
      case 'choose-pdf': case 'choose-folder':
        globalPicker = undefined; pickerTask = 'slice'; slicePickerTarget = 'output';
        state.busy = 'picker'; state.error = ''; render();
        drive.openPicker(target.id === 'choose-pdf' ? 'pdf' : 'folder', target.id === 'choose-pdf' ? state.inputFolder?.id : state.folder?.id);
        break;
      case 'scan': void scan(); break;
      case 'new-folder': void newFolder(); break;
      case 'cancel': controller?.abort(); break;
      case 'prepare': void prepare(); break;
      case 'upload': void upload(); break;
      case 'reset': clearScan(); state.source = state.localFile = undefined; render(); break;
    }
  } catch (error) { state.busy = ''; reportError(error); }
});

function editsChanged(): void {
  clearFiles();
  state.expanded.save = false;
  state.error = '';
  state.message = 'Page edits updated. Prepare the PDFs to apply your changes.';
  try { groupPages(state.frontPages); } catch (error) { state.error = errorMessage(error); }
  render();
}

let draggedPage: number | undefined;
app.addEventListener('dragstart', event => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('[data-page-index]');
  if (state.busy || state.uploadStarted || !card || card.draggable !== true) { event.preventDefault(); return; }
  draggedPage = Number(card.dataset.pageIndex);
  event.dataTransfer!.effectAllowed = 'move';
  event.dataTransfer!.setData('text/plain', String(draggedPage));
});
app.addEventListener('dragover', event => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('[data-page-index]');
  if (draggedPage !== undefined && card && !state.busy && !state.uploadStarted) {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
  }
});
app.addEventListener('drop', event => {
  event.preventDefault();
  const card = (event.target as HTMLElement).closest<HTMLElement>('[data-page-index]');
  if (draggedPage !== undefined && card && !state.busy && !state.uploadStarted && movePage(state.pages, state.frontPages, draggedPage, Number(card.dataset.pageIndex))) editsChanged();
  draggedPage = undefined;
});
app.addEventListener('dragend', () => { draggedPage = undefined; });

app.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (state.task === 'preparation' && !state.busy && input.id.startsWith('prep-')) preparation.change(input.id, input.value);
  if (input.id === 'student-search') matching.input(input.value);
  if (state.task === 'documentation') documentation.input(input.id, input.value);
  if (state.task === 'drafts' && ['draft-subject', 'draft-body', 'draft-labels'].includes(input.id)) drafts.input(input.id, input.value);
});

app.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (state.task === 'documentation' && documentation.highlightKeydown(event)) return;
  if (state.task === 'documentation' && (target.id === 'doc-points' || target.id === 'doc-mark')) {
    if (event.key === 'Enter' && !event.isComposing && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      document.getElementById('doc-save-next')?.click();
    }
    return;
  }
  if (target.id === 'student-search') { matching.keydown(event); return; }
  if (!target.dataset.task || state.busy) return;
  const tabs = ['preparation', 'slice', 'match', 'documentation', 'drafts', 'send'];
  const index = tabs.indexOf(state.task);
  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  document.getElementById(`task-${tabs[next]}`)?.click();
});

for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) {
  app.addEventListener(type, event => { if (state.task === 'documentation') documentation.highlightPointer(event); });
}

app.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (state.task === 'preparation' && input.id.startsWith('prep-') && (!state.busy || (input.id === 'prep-subject' && state.busy === 'folder'))) { preparation.change(input.id, input.value); return; }
  if (input.id === 'slice-file') {
    if (state.busy || state.uploadStarted || state.pages.length) return;
    clearScan(); state.localFile = undefined; state.source = correctedPdfs.find(file => file.id === input.value); render(); return;
  }
  if (input.name === 'draft-mode' && input.checked && !state.busy) { drafts.changeMode(input.value); return; }
  if (input.id === 'draft-extra') { if (!state.busy && input.files?.[0]) drafts.attachments(Array.from(input.files)); return; }
  if (input.dataset.sendRow !== undefined) {
    if (!state.busy) batchSend.select(Number(input.dataset.sendRow), input.checked);
    return;
  }
  if (input.dataset.draftFile !== undefined) {
    if (!state.busy) drafts.select(Number(input.dataset.draftFile), input.checked);
    return;
  }
  if (input.dataset.matchFile !== undefined) {
    if (!state.busy) matching.selectFile(input.dataset.matchFile, input.checked);
    return;
  }
  if (state.busy || state.uploadStarted) return;
  if (input.id === 'scan-threads') {
    const value = input.valueAsNumber;
    state.scanThreads = Number.isFinite(value) ? Math.max(1, Math.min(8, Math.round(value))) : 2;
    render();
  } else if (input.id === 'local-pdf' && input.files?.[0]) {
    const file = input.files[0];
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { reportError(new Error('Please choose a PDF file.')); return; }
    clearScan(); state.source = undefined; state.localFile = file; render();
  } else if (input.dataset.skip !== undefined) {
    const index = Number(input.dataset.skip);
    if (state.frontPages[index]) return;
    state.pages[index].skipped = input.checked;
    editsChanged();
  } else if (input.dataset.page !== undefined) {
    state.frontPages[Number(input.dataset.page)] = input.checked;
    if (input.checked) state.pages[Number(input.dataset.page)].skipped = false;
    clearFiles(); state.expanded.save = false; state.error = ''; state.message = 'Split points updated. Prepare the PDFs when the page groups look right.';
    try { groupPages(state.frontPages); } catch (error) { state.error = errorMessage(error); }
    render();
  }
});

window.addEventListener('beforeunload', event => {
  if (state.busy || preparation.hasIncompleteJob || matching.hasIncompletePreviewExport || drafts.hasIncompleteBatch || documentation.hasUnsavedChanges || (state.uploadStarted && state.files.some(file => !file.uploaded))) event.preventDefault();
});

let googleInitialization: Promise<void> | undefined;
function initializeGoogle(): void {
  if (!hasGoogleConfig() || googleInitialization) return;
  googleInitialization = drive.initialize({
    onConnection: connected => {
      const connecting = state.busy === 'connect';
      if (connecting) state.busy = '';
      state.connected = drive.workflowAccess;
      if (state.connected) state.hasConnected = true;
      if (!state.connected) testMenuOpen = false;
      if (connecting && connected && !state.connected) state.error = 'Grant Drive and Gmail permissions through Connect Google to enable all tasks.';
      render();
      if (state.connected && !globalPicker && !pathsLocked()) void refreshPaths();
    },
    onError: message => { globalPicker = undefined; state.busy = ''; reportError(new Error(message)); },
    onPickerClosed: selected => { if (!selected) globalPicker = undefined; state.busy = ''; render(); },
    onPick: (kind, item, items) => {
      if (globalPicker) {
        const key = globalPicker; globalPicker = undefined; paths[key] = item;
        if (key === 'course') { checkedCourse = undefined; courseSubjects.delete(item.id); paths.test = undefined; tests = []; folders = {}; correctedPdfs = []; clearScan(); state.source = state.localFile = undefined; }
        applyPaths(); render();
        if (key === 'course' && state.connected) void refreshPaths();
        return;
      }
      if (pickerTask === 'preparation') { preparation.accept(item); render(); return; }
      if (pickerTask === 'drafts') { drafts.accept(item, items); render(); return; }
      if (pickerTask === 'match') { matching.accept(item); render(); return; }
      if (kind === 'pdf') { clearScan(); state.localFile = undefined; state.source = item; }
      else if (slicePickerTarget === 'input') { void loadSliceInput(item); return; }
      else { sliceOutputOverride = item; state.folder = item; state.error = ''; }
      render();
    },
  }).then(() => { state.ready = true; render(); }).catch(error => { googleInitialization = undefined; reportError(error); });
}
render();
mountPrivacy((allowed, previous) => {
  if (allowed) { saveWorkflow(paths); initializeGoogle(); }
  else if (previous) {
    // Disable app API calls immediately, even if a beforeunload prompt is cancelled.
    drive.forgetSession(); examCache.clear(); state.ready = state.connected = false; googleInitialization = undefined; render();
    window.location.reload();
  } else render();
}, () => Boolean(state.busy));
if (googleAllowed()) initializeGoogle();
