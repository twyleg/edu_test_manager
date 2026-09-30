import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/main.css';
import { GoogleDrive } from './googleDrive';
import { openPagePreview } from './pagePreview';
import { openNewFolderDialog } from './folderDialog';
import { hasGoogleConfig } from './config';
import { groupPages } from './grouping';
import { renderApp, type AppState } from './view';

const app = document.querySelector<HTMLDivElement>('#app')!;
const drive = new GoogleDrive();
const state: AppState = { ready: false, connected: false, busy: '', pages: [], frontPages: [], files: [],
  uploadStarted: false, message: '', error: '', progress: 0, scanThreads: 2 };
let sourceBytes: Uint8Array | undefined;
let controller: AbortController | undefined;

function render(): void {
  const focused = document.activeElement?.id;
  app.innerHTML = renderApp(state);
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
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
  state.message = state.localFile ? 'Reading PDF…' : 'Downloading PDF from Google Drive…';
  controller = new AbortController();
  render();
  try {
    const { scanPdf } = await import('./pdf');
    sourceBytes = state.localFile ? new Uint8Array(await state.localFile.arrayBuffer()) : await drive.downloadPdf(state.source!, controller.signal);
    state.pages = await scanPdf(sourceBytes, (completed, total) => {
      state.message = `Scanned ${completed} of ${total} pages for QR markers…`;
      state.progress = completed / total * 100;
      render();
    }, controller.signal, state.scanThreads);
    state.frontPages = state.pages.map(page => page.hasQr);
    state.message = `Scan complete. Found ${state.frontPages.filter(Boolean).length} QR-marked front pages in ${state.pages.length} pages.`;
    try { groupPages(state.frontPages); } catch (error) { state.error = errorMessage(error); }
  } catch (error) {
    if (controller.signal.aborted) state.message = 'Scan cancelled. You can start again.';
    else { state.error = errorMessage(error); state.message = ''; }
    sourceBytes = undefined;
  } finally { state.busy = ''; controller = undefined; render(); }
}

async function prepare(): Promise<void> {
  if (!sourceBytes || state.busy || state.uploadStarted) return;
  state.error = '';
  state.busy = 'split';
  state.message = 'Preparing individual PDFs…';
  state.progress = 0;
  render();
  try {
    const { splitPdf } = await import('./pdf');
    clearFiles();
    state.files = await splitPdf(sourceBytes, state.localFile?.name || state.source!.name, state.pages, state.frontPages);
    state.message = `${state.files.length} individual PDFs prepared. Preview them below, then save to Drive.`;
  } catch (error) { state.error = errorMessage(error); state.message = ''; }
  finally { state.busy = ''; render(); }
}

async function upload(): Promise<void> {
  if (!state.folder || state.busy || !state.files.length) return;
  state.busy = 'upload';
  state.error = '';
  state.message = 'Checking destination folder…';
  state.progress = 0;
  render();
  try {
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
  } catch (error) {
    state.error = errorMessage(error);
    const count = state.files.filter(file => file.uploaded).length;
    state.message = `${count} of ${state.files.length} PDFs saved. Fix the issue, then retry the remaining uploads. Keep this tab open.`;
  } finally { state.busy = ''; render(); }
}

async function newFolder(): Promise<void> {
  if (state.busy || state.uploadStarted || !drive.connected) return;
  state.busy = 'folder';
  state.error = '';
  render();
  try {
    const folder = await openNewFolderDialog(drive, state.folder);
    if (folder) { state.folder = folder; state.message = `Created “${folder.name}” and selected it as the output folder.`; }
  } catch (error) { state.error = errorMessage(error); }
  finally { state.busy = ''; render(); document.getElementById('new-folder')?.focus(); }
}

app.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!target || target.disabled) return;
  try {
    if (target.dataset.preview !== undefined && sourceBytes) {
      openPagePreview(sourceBytes, Number(target.dataset.preview) + 1, target.id);
      return;
    }
    switch (target.id) {
      case 'connect':
        if (drive.connected) {
          drive.disconnect(); clearScan(); state.source = state.folder = state.localFile = undefined; render();
        } else drive.connect();
        break;
      case 'choose-pdf': case 'choose-folder':
        state.busy = 'picker'; state.error = ''; render();
        drive.openPicker(target.id === 'choose-pdf' ? 'pdf' : 'folder');
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

app.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (state.busy || state.uploadStarted) return;
  if (input.id === 'scan-threads') {
    const value = input.valueAsNumber;
    state.scanThreads = Number.isFinite(value) ? Math.max(1, Math.min(8, Math.round(value))) : 2;
    render();
  } else if (input.id === 'local-pdf' && input.files?.[0]) {
    const file = input.files[0];
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { reportError(new Error('Please choose a PDF file.')); return; }
    clearScan(); state.source = undefined; state.localFile = file; render();
  } else if (input.dataset.page !== undefined) {
    state.frontPages[Number(input.dataset.page)] = input.checked;
    clearFiles(); state.error = ''; state.message = 'Split points updated. Prepare the PDFs when the page groups look right.';
    try { groupPages(state.frontPages); } catch (error) { state.error = errorMessage(error); }
    render();
  }
});

window.addEventListener('beforeunload', event => {
  if (state.busy || (state.uploadStarted && state.files.some(file => !file.uploaded))) event.preventDefault();
});

render();
if (hasGoogleConfig()) {
  void drive.initialize({
    onConnection: connected => { state.connected = connected; render(); },
    onError: message => { state.busy = ''; reportError(new Error(message)); },
    onPickerClosed: () => { state.busy = ''; render(); },
    onPick: (kind, item) => {
      if (kind === 'pdf') { clearScan(); state.localFile = undefined; state.source = item; }
      else { state.folder = item; state.error = ''; }
      render();
    },
  }).then(() => { state.ready = true; render(); }).catch(reportError);
}
