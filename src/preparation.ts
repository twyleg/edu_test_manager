import { pdfMimeType } from './config';
import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';
import { escapeHtml as html } from './view';
import { FolderJob } from './testStructure';
import { scanFilename, type TestType, type Subject } from './testNames';
import { subjectFromFolderName } from './courseSubject';
export { scanFilename, topicSlug, nextTestFolderName } from './testNames';
export type ImportDestination = '01_Scans' | '02_Korrigiert';
export interface ImportInput {
  destination: ImportDestination;
  inputFolder: DriveItem;
  scan: DriveItem;
  test: DriveItem;
  course: string;
  subject: Subject;
  type: TestType;
  topic: string;
  date: string;
}
export class ImportJob {
  private folders = new FolderJob();
  private copyId?: string;
  private filename: string;
  readonly input: ImportInput;

  constructor(input: ImportInput) {
    if (!['01_Scans', '02_Korrigiert'].includes(input.destination)) {
      throw new Error('Choose an import destination.');
    }
    this.filename = scanFilename(input);
    this.input = {
      ...input,
      inputFolder: { ...input.inputFolder },
      test: { ...input.test },
      scan: { ...input.scan },
    };
    if (input.scan.mimeType !== pdfMimeType) {
      throw new Error('Choose a PDF scan.');
    }
  }

  async run(drive: GoogleDrive): Promise<DriveItem> {
    const { input } = this;
    await drive.verifyFolder(input.test);
    if (
      !this.copyId &&
      !(await drive.listFolderPdfs(input.inputFolder.id)).some((file) => file.id === input.scan.id)
    ) {
      throw new Error('The scan is no longer in the input folder. Refresh the file list.');
    }
    const destination = await this.folders.ensure(drive, input.test, input.destination);
    this.copyId ??= await drive.generateFileId();
    return drive.copyScan(
      input.scan,
      input.inputFolder.id,
      destination.id,
      this.filename,
      this.copyId,
    );
  }
}

function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}

export class ImportTask {
  private inputFolder?: DriveItem;
  private courseFolder?: DriveItem;
  private test?: DriveItem;
  private scan?: DriveItem;
  private sourceFolder?: DriveItem;
  private course = '';
  private topic = '';
  private subject: Subject = 'Informatik';
  private subjectCourseId?: string;
  private derivedSubject?: Subject;
  private subjectOverridden = false;
  private type: TestType = 'LZK';
  private date = today();
  private destination: ImportDestination = '01_Scans';

  private busy = false;
  private error = '';
  private message = '';
  private job?: ImportJob;
  private result?: DriveItem;

  setPaths(input?: DriveItem, course?: DriveItem, test?: DriveItem): void {
    if (this.hasIncompleteJob) {
      return;
    }
    if (this.subjectCourseId !== course?.id) {
      this.subjectCourseId = course?.id;
      this.derivedSubject = course ? subjectFromFolderName(course.name) : undefined;
      this.subjectOverridden = false;
      this.subject = this.derivedSubject || 'Informatik';
    }
    if (!this.subjectOverridden && this.derivedSubject) {
      this.subject = this.derivedSubject;
    }
    if (
      this.inputFolder?.id === input?.id &&
      this.courseFolder?.id === course?.id &&
      this.test?.id === test?.id
    ) {
      return;
    }
    this.reset();
    this.inputFolder = input;
    this.courseFolder = course;
    this.test = test;
    this.course = course?.name || '';
    this.type = test?.name.startsWith('Klausuren / ') ? 'Klausur' : 'LZK';
    this.topic = test?.name.split(' / ').at(-1)?.replace(/^\d+_/, '') || '';
  }

  setDerivedSubject(courseId: string, subject?: Subject): void {
    if (this.subjectCourseId !== courseId || !subject) {
      return;
    }
    this.derivedSubject = subject;
    if (!this.subjectOverridden && !this.busy && !this.job && this.subject !== subject) {
      this.subject = subject;
      this.refresh();
    }
  }

  constructor(
    private drive: GoogleDrive,
    private refresh: () => void,
    private setBusy: (busy: boolean) => void,
    private rememberInput: (item: DriveItem) => void,
  ) {}

  get hasIncompleteJob(): boolean {
    return Boolean(this.job && !this.result);
  }

  reset(): void {
    this.test = undefined;
    this.courseFolder = undefined;
    this.inputFolder = undefined;
    this.sourceFolder = undefined;
    this.scan = undefined;
    this.topic = '';
    this.course = '';
    this.result = undefined;
    this.job = undefined;
    this.message = '';
    this.error = '';
    this.date = today();
    this.destination = '01_Scans';
  }

  pick(): void {
    this.drive.openPicker('pdf', this.inputFolder?.id);
  }

  accept(item: DriveItem): void {
    if (this.job || this.busy) {
      return;
    }
    this.scan = item;
    this.sourceFolder = undefined;
    void this.perform(async () => {
      // Capture the selected PDF's actual parent even when it came from search
      // or a different folder than the remembered starting location.
      await this.resolveSourceFolder();
    });
  }

  private async resolveSourceFolder(): Promise<void> {
    this.sourceFolder = await this.drive.getParentFolder(this.scan!, false);
    this.inputFolder = this.sourceFolder;
    this.rememberInput(this.inputFolder);
  }

  private async perform(action: () => Promise<void>): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.error = '';
    this.setBusy(true);
    this.refresh();
    try {
      await action();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.setBusy(false);
      this.refresh();
      document
        .getElementById(this.result ? 'prep-progress' : 'prep-input')
        ?.focus({ preventScroll: true });
    }
  }

  private input(): ImportInput {
    const scan = this.scan;
    if (!this.sourceFolder || !this.courseFolder || !this.test || !scan) {
      throw new Error('Choose a PDF from Drive and the current test.');
    }
    return {
      destination: this.destination,
      inputFolder: this.sourceFolder,
      scan,
      test: this.test,
      course: this.course,
      topic: this.topic,
      subject: this.subject,
      type: this.type,
      date: this.date,
    };
  }

  async start(): Promise<void> {
    if (!this.drive.matchingAccess || this.result) {
      return;
    }
    await this.perform(async () => {
      if (!this.sourceFolder && this.scan) {
        await this.resolveSourceFolder();
      }
      this.job ??= new ImportJob(this.input());
      this.message = `Importing scan into ${this.job.input.destination}…`;
      this.refresh();
      this.result = await this.job.run(this.drive);
      this.message = `Import complete. Scan copied to ${this.job.input.destination} as ${this.result.name}.`;
    });
  }

  change(id: string, value: string): void {
    if (this.busy) {
      return;
    }
    if (this.job) {
      return;
    }
    if (id === 'prep-subject' && ['Physik', 'Informatik'].includes(value)) {
      this.subject = value as Subject;
      this.subjectOverridden = true;
    }
    if (id === 'prep-course') {
      this.course = value;
    }
    if (id === 'prep-date') {
      this.date = value;
    }
    if (id === 'prep-destination' && ['01_Scans', '02_Korrigiert'].includes(value)) {
      this.destination = value as ImportDestination;
    }
    const destination = document.getElementById('prep-destination-hint');
    if (destination) {
      destination.textContent = this.destinationHint();
    }
    // Update the preview without replacing a text input or its caret while typing.
    const preview = document.getElementById('prep-filename');
    if (preview) {
      preview.textContent = this.previewFilename();
    }
    const start = document.getElementById('prep-start') as HTMLButtonElement | null;
    if (start) {
      start.disabled = !this.drive.matchingAccess || !this.test || !this.scan;
    }
  }

  private destinationHint(): string {
    return this.test
      ? `Copy to ${this.test.name} / ${this.destination}`
      : 'Select or create a current test in the topbar.';
  }

  private previewFilename(): string {
    try {
      return scanFilename({
        course: this.course,
        topic: this.topic,
        subject: this.subject,
        type: this.type,
        date: this.date,
      });
    } catch {
      return 'Select a test and complete the class code and date to preview the filename.';
    }
  }

  handle(id: string): boolean {
    switch (id) {
      case 'prep-start':
        void this.start();
        break;
      case 'prep-new':
        if (this.result) {
          const input = this.inputFolder;
          const course = this.courseFolder;
          const test = this.test;
          this.reset();
          this.setPaths(input, course, test);
          this.refresh();
        }
        break;
      default:
        return false;
    }
    return true;
  }

  render(ready: boolean): string {
    const locked = this.busy || Boolean(this.job);
    const disabled = (condition: boolean) => (condition ? 'disabled' : '');
    return `<section id="panel-preparation" role="tabpanel" aria-labelledby="task-preparation">
      <h1 class="visually-hidden">Import scans</h1>
      <div role="alert" class="alert alert-danger" ${this.error ? '' : 'hidden'}>${html(this.error)}${this.error && this.job ? ' Keep this tab open and retry to resume the same import.' : ''}</div>
      <section class="workspace-panel" aria-label="Import scan" aria-busy="${this.busy}">
        <div class="preparation-details import-details">
          <div class="row g-3 align-items-start">
            <div class="col-xl-3 col-sm-6"><label for="prep-input" class="form-label">Scan PDF</label><button id="prep-input" class="btn btn-outline-primary w-100 import-file" title="${html(this.scan?.name || 'Choose PDF from Drive')}" ${disabled(!ready || locked)}>${html(this.scan?.name || 'Choose PDF from Drive')}</button></div>
            <div class="col-xl-3 col-sm-6"><label for="prep-destination" class="form-label">Document status</label><select id="prep-destination" class="form-select" ${disabled(locked)}><option value="01_Scans" ${this.destination === '01_Scans' ? 'selected' : ''}>Original scan → 01_Scans</option><option value="02_Korrigiert" ${this.destination === '02_Korrigiert' ? 'selected' : ''}>Corrected → 02_Korrigiert</option></select></div>
            <div class="col-xl-2 col-sm-4"><label for="prep-subject" class="form-label">Subject</label><select id="prep-subject" class="form-select" ${disabled(locked)}>${(['Informatik', 'Physik'] as const).map((subject) => `<option ${this.subject === subject ? 'selected' : ''}>${subject}</option>`).join('')}</select></div>
            <div class="col-xl-1 col-sm-4"><label for="prep-course" class="form-label">Class code</label><input id="prep-course" class="form-control" value="${html(this.course)}" placeholder="8a" ${disabled(locked)} /></div>
            <div class="col-xl-3 col-sm-4"><label for="prep-date" class="form-label">Test date</label><input id="prep-date" type="date" class="form-control" value="${html(this.date)}" ${disabled(locked)} /></div>
          </div>
          <div class="import-footer"><div class="preparation-filename"><strong id="prep-filename">${html(this.previewFilename())}</strong><span id="prep-destination-hint" class="form-text">${html(this.destinationHint())}</span></div>
            <div class="d-flex gap-2">${this.result ? `<button id="prep-new" class="btn btn-outline-secondary" ${disabled(this.busy)}>Import another scan</button>` : `<button id="prep-start" class="btn btn-primary" ${disabled(this.busy || !this.drive.matchingAccess || !this.test || !this.scan)}>${this.busy ? 'Working…' : this.job ? 'Retry import' : 'Import scan'}</button>`}</div>
          </div>
        </div>
      </section>
      <div id="prep-progress" tabindex="-1" class="progress-area" ${this.message ? '' : 'hidden'}><span role="status" aria-live="polite">${html(this.message)}</span></div>
    </section>`;
  }
}
