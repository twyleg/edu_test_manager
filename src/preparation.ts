import { openScanPreview } from './scanPreview';
import { folderMimeType, pdfMimeType } from './config';
import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';
import { escapeHtml as html } from './view';

export type TestType = 'LZK' | 'Klausur';
export type Subject = 'Physik' | 'Informatik';
export interface PreparationInput {
  inputFolder: DriveItem;
  scan: DriveItem;
  courseFolder: DriveItem;
  course: string;
  subject: Subject;
  type: TestType;
  topic: string;
  date: string;
}
export interface PreparationResult {
  test: DriveItem;
  scans: DriveItem;
  corrected: DriveItem;
  split: DriveItem;
  previews: DriveItem;
  scan: DriveItem;
}

export function topicSlug(topic: string): string {
  const slug = topic.normalize('NFC').trim().replace(/\s+/gu, '-');
  if (!slug || /[/\\\u0000-\u001f\u007f]/u.test(slug) || /^\.+$/.test(slug)) throw new Error('Enter a test topic without slashes or control characters.');
  return slug;
}

export function scanFilename(input: Pick<PreparationInput, 'type' | 'subject' | 'course' | 'topic' | 'date'>): string {
  if (!['LZK', 'Klausur'].includes(input.type) || !['Physik', 'Informatik'].includes(input.subject)) throw new Error('Choose a subject and test type.');
  const course = input.course.trim();
  if (!course || /[\s/\\\u0000-\u001f\u007f]/u.test(course)) throw new Error('Enter a class code without spaces or slashes, for example 8a.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date) throw new Error('Choose a valid test date.');
  return `${input.date.replace(/-/g, '')}_${input.type === 'Klausur' ? 'KA' : 'LZK'}-${input.subject === 'Physik' ? 'PH' : 'IF'}${course}-${topicSlug(input.topic)}.pdf`;
}

export function nextTestFolderName(items: DriveItem[], topic: string): string {
  const numbers = items.filter(item => item.mimeType === folderMimeType).map(item => Number(/^(\d+)_/.exec(item.name)?.[1] || 0));
  const next = numbers.reduce((highest, number) => Math.max(highest, number), 0) + 1;
  if (!Number.isSafeInteger(next)) throw new Error('Existing test numbering is too large.');
  return `${String(next).padStart(2, '0')}_${topicSlug(topic)}`;
}

/** Keep the same job in memory to resume partially completed Drive operations. */
export class PreparationJob {
  private folders = new Map<string, DriveItem>();
  private testName?: string;
  private copyId?: string;
  private filename: string;
  readonly input: PreparationInput;
  constructor(input: PreparationInput) {
    this.filename = scanFilename(input);
    this.input = { ...input, inputFolder: { ...input.inputFolder }, courseFolder: { ...input.courseFolder }, scan: { ...input.scan } };
    if (input.scan.mimeType !== pdfMimeType) throw new Error('Choose a PDF scan.');
    if (input.inputFolder.id === input.courseFolder.id) throw new Error('Choose a Course folder separate from the scanner input folder.');
  }
  private async ensureFolder(drive: GoogleDrive, parent: DriveItem, name: string): Promise<DriveItem> {
    const key = `${parent.id}/${name}`;
    let folder = this.folders.get(key);
    if (!folder) {
      const items = await drive.listFolderItems(parent.id);
      const matches = items.filter(item => item.name === name);
      if (matches.length > 1 || matches.some(item => item.mimeType !== folderMimeType)) throw new Error(`Resolve duplicate folders or a non-folder named “${name}” in “${parent.name}”, then retry.`);
      folder = matches[0];
      if (!folder) folder = { id: await drive.generateFileId(), name, mimeType: folderMimeType };
      // Save the ID before creation so a lost response cannot create a second folder.
      this.folders.set(key, folder);
    }
    folder = await drive.createFolder(folder.id, name, parent.id);
    await drive.verifyFolder(folder);
    return folder;
  }
  async run(drive: GoogleDrive, progress: (message: string) => void = () => {}): Promise<PreparationResult> {
    const { input } = this;
    progress('Checking the Course folder…');
    await drive.verifyFolder(input.courseFolder);
    // Check source before making any folders, except when resuming a possible completed copy.
    if (!this.testName) {
      const scans = await drive.listFolderPdfs(input.inputFolder.id);
      if (!scans.some(scan => scan.id === input.scan.id)) throw new Error('The scan is no longer in the input folder. Refresh the file list.');
    }
    progress('Preparing LZKs and Klausuren…');
    const lzks = await this.ensureFolder(drive, input.courseFolder, 'LZKs');
    const klausuren = await this.ensureFolder(drive, input.courseFolder, 'Klausuren');
    const parent = input.type === 'LZK' ? lzks : klausuren;
    this.testName ??= nextTestFolderName(await drive.listFolderItems(parent.id), input.topic);
    progress(`Preparing ${this.testName}…`);
    const test = await this.ensureFolder(drive, parent, this.testName);
    const scans = await this.ensureFolder(drive, test, '01_Scans');
    const corrected = await this.ensureFolder(drive, test, '02_Korrigiert');
    const split = await this.ensureFolder(drive, test, '03_Split');
    const previews = await this.ensureFolder(drive, test, '04_Previews');
    progress('Copying the scan to 01_Scans…');
    this.copyId ??= await drive.generateFileId();
    const scan = await drive.copyScan(input.scan, input.inputFolder.id, scans.id, this.filename, this.copyId);
    return { test, scans, corrected, split, previews, scan };
  }
}

function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export class PreparationTask {
  private inputFolder?: DriveItem;
  private courseFolder?: DriveItem;
  private files: DriveItem[] = [];
  private scanId = '';
  private course = '';
  private topic = '';
  private subject: Subject = 'Informatik';
  private type: TestType = 'LZK';
  private date = today();
  private picker?: 'input' | 'course';
  private busy = false;
  private error = '';
  private message = '';
  private job?: PreparationJob;
  private result?: PreparationResult;
  private setupOpen = true;
  constructor(private drive: GoogleDrive, private refresh: () => void, private setBusy: (busy: boolean) => void) {}
  get hasIncompleteJob(): boolean { return Boolean(this.job && !this.result); }
  reset(): void {
    this.inputFolder = this.courseFolder = undefined; this.files = []; this.scanId = this.course = this.topic = '';
    this.job = this.result = undefined; this.error = this.message = ''; this.date = today();
    this.setupOpen = true;
  }
  pick(kind: 'input' | 'course'): void { this.picker = kind; this.drive.openPicker('folder'); }
  accept(item: DriveItem): void {
    if (this.picker === 'input') { this.inputFolder = item; this.files = []; this.scanId = ''; this.picker = undefined; void this.load(); }
    else { this.courseFolder = item; this.course = item.name; this.picker = undefined; this.refresh(); }
  }
  private async perform(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.setBusy(true); this.refresh();
    try { await action(); } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    finally {
      this.busy = false; this.setBusy(false); this.refresh();
      document.getElementById(this.result ? 'prep-progress' : 'prep-toggle-setup')?.focus({ preventScroll: true });
    }
  }
  async load(): Promise<void> {
    if (!this.inputFolder || !this.drive.matchingAccess || this.job) return;
    await this.perform(async () => {
      this.message = 'Loading scanner PDFs…'; this.refresh();
      this.files = await this.drive.listFolderPdfs(this.inputFolder!.id);
      if (!this.files.some(file => file.id === this.scanId)) this.scanId = '';
      this.message = this.files.length ? `${this.files.length} PDF${this.files.length === 1 ? '' : 's'} available in the input folder.` : 'No PDFs found in this input folder.';
    });
  }
  private input(): PreparationInput {
    const scan = this.files.find(file => file.id === this.scanId);
    if (!this.inputFolder || !this.courseFolder || !scan) throw new Error('Choose the scanner input folder, a PDF and the Course folder.');
    return { inputFolder: this.inputFolder, scan, courseFolder: this.courseFolder, course: this.course, topic: this.topic, subject: this.subject, type: this.type, date: this.date };
  }
  async start(): Promise<void> {
    if (!this.drive.matchingAccess || this.result) return;
    await this.perform(async () => {
      this.job ??= new PreparationJob(this.input());
      this.result = await this.job.run(this.drive, message => { this.message = message; this.refresh(); });
      this.message = `Preparation complete. Scan copied as ${this.result.scan.name}.`;
      this.setupOpen = false;
    });
  }
  change(id: string, value: string): void {
    if (this.busy) return;
    if (this.job) return;
    if (id === 'prep-file') this.scanId = value;
    if (id === 'prep-subject' && ['Physik', 'Informatik'].includes(value)) this.subject = value as Subject;
    if (id === 'prep-type' && ['LZK', 'Klausur'].includes(value)) this.type = value as TestType;
    if (id === 'prep-course') this.course = value;
    if (id === 'prep-topic') this.topic = value;
    if (id === 'prep-date') this.date = value;
    // Update the preview without replacing a text input or its caret while typing.
    const preview = document.getElementById('prep-filename');
    if (preview) preview.textContent = this.previewFilename();
    const previewButton = document.getElementById('prep-preview') as HTMLButtonElement | null;
    if (previewButton) previewButton.disabled = !this.drive.connected || !this.scanId;
    const start = document.getElementById('prep-start') as HTMLButtonElement | null;
    if (start) start.disabled = !this.drive.matchingAccess || !this.inputFolder || !this.courseFolder || !this.scanId;
  }
  private previewFilename(): string {
    try { return scanFilename({ course: this.course, topic: this.topic, subject: this.subject, type: this.type, date: this.date }); }
    catch { return 'Complete the class code, test topic and date to preview the filename.'; }
  }
  handle(id: string): boolean {
    switch (id) {
      case 'prep-toggle-setup': this.setupOpen = !this.setupOpen; this.refresh(); break;
      case 'prep-access': this.drive.connectMatching(); break;
      case 'prep-refresh': void this.load(); break;
      case 'prep-preview': {
        const scan = this.files.find(file => file.id === this.scanId);
        if (scan && this.drive.connected) openScanPreview(this.drive, scan, id);
        break;
      }
      case 'prep-start': void this.start(); break;
      case 'prep-new': if (this.result) { this.reset(); this.refresh(); } break;
      default: return false;
    }
    return true;
  }
  render(ready: boolean): string {
    const locked = this.busy || Boolean(this.job);
    const disabled = (condition: boolean) => condition ? 'disabled' : '';
    const folder = (item?: DriveItem) => item ? html(item.name) : 'No folder selected';
    const options = (files: DriveItem[], selected: string) => files.map(file => `<option value="${html(file.id)}" ${file.id === selected ? 'selected' : ''}>${html(file.name)}</option>`).join('');
    const link = (item: DriveItem) => `<a href="https://drive.google.com/drive/folders/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">${html(item.name)} ↗</a>`;
    return `<section id="panel-preparation" role="tabpanel" aria-labelledby="task-preparation">
      <div class="intro"><div><p class="eyebrow">PREPARATION</p><h1>Organize a new test.</h1><p class="lead-copy">Choose a scanner PDF and its Course folder, then prepare the test folders. <br>A copy of your scan gets a consistent name and a place of its own.</p></div></div>
      <div role="alert" class="alert alert-danger" ${this.error ? '' : 'hidden'}>${html(this.error)}${this.error && this.job ? ' Keep this tab open and retry to resume the same test.' : ''}</div>
      ${this.result ? `<div class="batch-actions"><button id="prep-new" class="btn btn-sm btn-outline-secondary" ${disabled(this.busy)}>Prepare another test</button></div>` : ''}
      <section class="subtask workspace-panel ${this.busy ? 'subtask-busy' : ''}" aria-busy="${this.busy}">
        <h2 class="subtask-heading"><button id="prep-toggle-setup" aria-expanded="${this.setupOpen}" aria-controls="prep-setup-body" ${disabled(this.busy)}><span class="step-number">1</span><span class="subtask-title">Choose scan & prepare test<small>${html(this.result ? this.result.test.name : `${this.inputFolder?.name || 'Choose a scanner folder'} · ${this.courseFolder?.name || 'Choose a Course folder'}`)}</small></span><span class="fold-chevron" aria-hidden="true">${this.setupOpen ? '⌃' : '⌄'}</span></button></h2>
        <div id="prep-setup-body" class="subtask-body" ${this.setupOpen ? '' : 'hidden'}>
        <div class="selection-grid">
          <div class="selection-step"><div class="step-heading"><h3>Scanner input folder</h3></div><p>The folder where your scanner saves the original PDFs.</p>
            <div class="file-selection ${this.inputFolder ? 'has-selection' : ''}"><div><strong>${folder(this.inputFolder)}</strong><span>Google Drive scan source</span></div></div>
            <div class="selection-actions"><button id="prep-input" class="btn btn-outline-primary" ${disabled(!ready || locked)}>Choose input folder</button><button id="prep-refresh" class="btn btn-outline-secondary" ${disabled(locked || !this.inputFolder || !this.drive.matchingAccess)}>Refresh files</button></div>
            <label for="prep-file" class="form-label preparation-field-label">Original scan PDF</label><select id="prep-file" class="form-select" ${disabled(locked || !this.files.length)}><option value="">Choose a PDF</option>${options(this.files, this.scanId)}</select>
            <div class="selection-actions"><button id="prep-preview" class="btn btn-outline-secondary" ${disabled(this.busy || !this.scanId || !this.drive.connected)}>Preview scan</button></div><p class="folder-hint">Select a file and preview its pages to identify the test.</p>
          </div>
          <div class="selection-step"><div class="step-heading"><h3>Course folder</h3></div><p>The class folder inside your subject, school year and calendar year folders.</p>
            <div class="file-selection ${this.courseFolder ? 'has-selection' : ''}"><div><strong>${folder(this.courseFolder)}</strong><span>Google Drive test destination</span></div></div>
            <div class="selection-actions"><button id="prep-folder" class="btn btn-outline-primary" ${disabled(!ready || locked)}>Choose Course folder</button></div>
            <label for="prep-course" class="form-label preparation-field-label">Class code</label><input id="prep-course" class="form-control" value="${html(this.course)}" placeholder="8a" ${disabled(locked)} />
          </div>
        </div>
        ${!this.drive.matchingAccess ? `<div class="matching-access"><p>Enable folder access to list existing scans and test folders.</p><button id="prep-access" class="btn btn-outline-primary" ${disabled(!ready || this.busy)}>Enable folder access</button></div>` : ''}
        <div class="preparation-details">
          <div class="row g-3">
            <div class="col-sm-4"><label for="prep-subject" class="form-label">Subject</label><select id="prep-subject" class="form-select" ${disabled(locked)}>${(['Informatik', 'Physik'] as const).map(subject => `<option ${this.subject === subject ? 'selected' : ''}>${subject}</option>`).join('')}</select></div>
            <div class="col-sm-4"><label for="prep-type" class="form-label">Test type</label><select id="prep-type" class="form-select" ${disabled(locked)}>${(['LZK', 'Klausur'] as const).map(type => `<option ${this.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>
            <div class="col-sm-4"><label for="prep-date" class="form-label">Test date</label><input id="prep-date" type="date" class="form-control" value="${html(this.date)}" ${disabled(locked)} /></div>
            <div class="col-12"><label for="prep-topic" class="form-label">Test topic</label><input id="prep-topic" class="form-control" value="${html(this.topic)}" placeholder="Zahlen Konvertieren Dezimal Dual" ${disabled(locked)} /></div>
          </div>
          <p class="form-text preparation-folder-hint">Creates LZKs and Klausuren as needed, then a numbered test folder containing 01_Scans, 02_Korrigiert, 03_Split and 04_Previews.</p>
        </div>
        <div class="panel-footer"><div class="preparation-filename"><span>Scan filename</span><strong id="prep-filename">${html(this.previewFilename())}</strong><span>A renamed copy will be saved in 01_Scans. The scanner original stays unchanged.</span></div>
          <button id="prep-start" class="btn btn-primary" ${disabled(this.busy || Boolean(this.result) || !this.drive.matchingAccess || !this.inputFolder || !this.courseFolder || !this.scanId)}>${this.busy ? 'Working…' : this.result ? 'Test prepared' : this.job ? 'Retry preparation' : 'Start preparation'}</button></div>
      </div></section>
      ${this.result ? `<section class="workspace-panel subtask" aria-labelledby="prep-result-heading"><div class="selection-step">
        <div class="step-heading"><h3 id="prep-result-heading">Test folders ready</h3></div><p>${link(this.result.test)}</p>
        <div class="preparation-folder-list">${[this.result.scans, this.result.corrected, this.result.split, this.result.previews].map(item => `<div class="file-selection has-selection"><strong>${link(item)}</strong></div>`).join('')}</div>
      </div></section>` : ''}
      <div id="prep-progress" tabindex="-1" class="progress-area ${this.busy ? 'progress-active progress-island' : this.result ? 'matching-complete' : ''}" ${this.message ? '' : 'hidden'}><div class="progress-caption"><span role="status" aria-live="polite">${html(this.message)}</span></div>${this.busy ? '<div class="progress progress-indeterminate" role="progressbar" aria-label="Preparation progress" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:35%"></div></div>' : ''}</div>
    </section>`;
  }
}
