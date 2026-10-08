import { renderTaskInputs } from './workflowInputs';
import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';
import { parseStudents, studentLabel, matchingStudents, type Student } from './students';
import { openPagePreview } from './pagePreview';
import { ExamPreviewExport, examPreviewFilename } from './examPreviews';

const html = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
export class MatchingTask {
  folder?: DriveItem;
  csv?: DriveItem;
  private students: Student[] = [];
  private exams: DriveItem[] = [];
  private available: DriveItem[] = [];
  private included = new Set<string>();
  private filesOpen = false;
  private reviewOpen = false;
  private completed = false;
  private busyStage: 'setup' | 'files' | 'review' | 'previews' = 'setup';
  private previewExport?: ExamPreviewExport;
  private previewExportOpen = false;
  private index = 0;
  private previews = new Map<string, { bytes: Uint8Array; crop: string }>();
  private crop?: string;
  private bytes?: Uint8Array;
  private query = '';
  private error = '';
  private message = '';
  private progress: number | null = null;
  private setupOpen = true;
  private controller?: AbortController;
  private busy = false;
  private saving = false;
  private picker?: 'folder' | 'csv';

  constructor(private drive: GoogleDrive, private refresh: () => void, private setBusy: (busy: boolean) => void) {}
  get hasIncompletePreviewExport(): boolean { return Boolean(this.previewExport && !this.previewExport.complete); }
  prefill(folder?: DriveItem): void { this.folder ??= folder; }
  setPaths(folder?: DriveItem, csv?: DriveItem): void {
    if (this.folder?.id === folder?.id && this.csv?.id === csv?.id) return;
    this.reset(); this.folder = folder; this.csv = csv;
  }
  private clearPreviewExport(): void { this.previewExport = undefined; this.previewExportOpen = false; }
  private clearPreview(): void {
    for (const preview of this.previews.values()) URL.revokeObjectURL(preview.crop);
    this.previews.clear(); this.crop = undefined; this.bytes = undefined;
  }
  private clearSelection(): void {
    this.clearPreviewExport();
    this.available = []; this.included.clear(); this.filesOpen = this.reviewOpen = this.completed = false;
  }
  reset(): void { this.clearSelection(); this.clearPreview(); this.folder = this.csv = undefined; this.students = []; this.exams = []; this.query = this.error = this.message = ''; this.setupOpen = true; }
  pick(kind: 'folder' | 'csv'): void { this.picker = kind; this.drive.openPicker(kind); }
  accept(item: DriveItem): void {
    if (this.picker === 'folder') this.folder = item; else this.csv = item;
    this.picker = undefined;
    this.clearSelection(); this.clearPreview(); this.exams = []; this.students = []; this.error = this.message = ''; this.setupOpen = true;
  }
  private selected(): Student | undefined { return this.students.find(student => studentLabel(student) === this.query); }
  private recognized(exam: DriveItem): boolean { return this.students.some(student => student.filename === exam.name); }
  private begin(message: string, saving = false, stage: 'setup' | 'files' | 'review' | 'previews' = 'setup'): void {
    this.busyStage = stage;
    this.busy = true; this.saving = saving; this.error = ''; this.message = message; this.progress = null;
    this.controller = new AbortController(); this.setBusy(true); this.refresh();
    document.getElementById('match-progress')?.focus({ preventScroll: true });
  }
  private end(): void {
    this.busy = this.saving = false; this.controller = undefined; this.setBusy(false); this.refresh();
    document.getElementById(this.completed ? 'match-progress' : this.crop && this.reviewOpen ? 'student-search' : this.available.length ? 'match-files' : 'match-load')?.focus({ preventScroll: true });
  }
  private failure(error: unknown): void {
    if (this.controller?.signal.aborted) this.message = 'Loading cancelled. You can retry.';
    else { this.error = error instanceof Error ? error.message : String(error); this.message = ''; }
  }
  private updateProgress(): void {
    const panel = document.getElementById('match-progress');
    if (!panel) return;
    panel.querySelector('[role="status"]')!.textContent = this.message;
    const bar = panel.querySelector<HTMLElement>('[role="progressbar"]')!;
    bar.setAttribute('aria-valuetext', this.message);
    bar.classList.toggle('progress-indeterminate', this.progress === null);
    if (this.progress === null) bar.removeAttribute('aria-valuenow'); else bar.setAttribute('aria-valuenow', String(Math.round(this.progress)));
    bar.querySelector<HTMLElement>('.progress-bar')!.style.width = `${this.progress === null ? 35 : this.progress}%`;
  }
  async load(): Promise<void> {
    if (this.busy || !this.folder || !this.csv || !this.drive.matchingAccess) return;
    this.clearSelection(); this.clearPreview(); this.exams = []; this.students = [];
    this.begin('Loading student list and exam folder…');
    try {
      const text = await this.drive.downloadCsv(this.csv, this.controller!.signal);
      this.students = parseStudents(text);
      this.available = await this.drive.listFolderPdfs(this.folder.id, this.controller!.signal);
      if (!this.available.length) throw new Error('This folder contains no PDF files. Choose the folder containing the individual exams.');
      this.included = new Set(this.available.map(file => file.id));
      this.setupOpen = false; this.filesOpen = true;
      this.message = `Found ${this.available.length} PDFs. Choose which files to download and match.`;
    } catch (error) { this.setupOpen = true; this.failure(error); }
    finally { this.end(); }
  }
  async preload(): Promise<void> {
    if (this.busy || !this.included.size || !this.drive.matchingAccess) return;
    this.clearPreview(); this.clearPreviewExport(); this.completed = false; this.reviewOpen = false;
    this.exams = this.available.filter(file => this.included.has(file.id));
    this.begin('Preloading selected exams…', false, 'files');
    try {
      const { renderNameCrop } = await import('./pdf');
      for (const [index, exam] of this.exams.entries()) {
        this.controller!.signal.throwIfAborted();
        const bytes = await this.drive.downloadPdf(exam, this.controller!.signal, (received, total) => {
          const fraction = total ? Math.min(1, received / total) : 0;
          this.progress = (index + fraction * .9) / this.exams.length * 100;
          this.message = `Preloading exam ${index + 1} of ${this.exams.length}… ${(received / 1048576).toFixed(1)} MB${total ? ` of ${(total / 1048576).toFixed(1)} MB` : ' received'}`;
          this.updateProgress();
        });
        this.message = `Preparing name preview ${index + 1} of ${this.exams.length}…`; this.updateProgress();
        const crop = await renderNameCrop(bytes, this.controller!.signal);
        this.previews.set(exam.id, { bytes, crop });
        this.progress = (index + 1) / this.exams.length * 100; this.updateProgress();
      }
      this.index = Math.max(0, this.exams.findIndex(exam => !this.recognized(exam)));
      this.setupOpen = false; this.filesOpen = false; this.reviewOpen = true;
      this.readCurrent();
      if (this.exams.every(exam => this.recognized(exam))) this.finishMatching();
    } catch (error) { this.clearPreview(); this.exams = []; this.filesOpen = true; this.failure(error); }
    finally { this.end(); }
  }
  private readCurrent(): void {
    const exam = this.exams[this.index];
    const preview = this.previews.get(exam.id)!;
    this.bytes = preview.bytes; this.crop = preview.crop;
    const known = this.students.find(student => student.filename === exam.name);
    this.query = known ? studentLabel(known) : '';
    this.message = known ? 'This filename already matches a student. Review it or continue to the next exam.' : 'Select the student whose name appears above, then rename the file.';
  }
  async navigate(index: number): Promise<void> {
    if (this.busy || index < 0 || index >= this.exams.length) return;
    this.index = index; this.error = ''; this.readCurrent(); this.refresh();
    document.getElementById('student-search')?.focus({ preventScroll: true });
  }
  async save(): Promise<void> {
    const student = this.selected();
    if (this.busy || !student || !this.crop || !this.folder || !this.drive.connected) return;
    const exam = this.exams[this.index];
    this.completed = false;
    this.begin(`Renaming to ${student.filename}…`, true, 'review');
    try {
      await this.drive.renameExam(exam, this.folder.id, student.filename);
      if (exam.name !== student.filename) this.clearPreviewExport();
      exam.name = student.filename;
      const next = this.exams.findIndex((candidate, i) => i > this.index && !this.recognized(candidate));
      const remaining = next >= 0 ? next : this.exams.findIndex(candidate => !this.recognized(candidate));
      if (remaining >= 0) {
        this.index = remaining; this.readCurrent();
      } else this.finishMatching();
    } catch (error) { this.failure(error); }
    finally { this.end(); }
  }
  private finishMatching(): void {
    this.completed = true; this.reviewOpen = false; this.previewExportOpen = !this.previewExport?.complete;
    this.message = `All ${this.exams.length} selected exam filenames now match students. Matching complete. You can now create their preview PDFs.`;
  }
  async createPreviews(): Promise<void> {
    if (this.busy || !this.completed || !this.folder || !this.drive.matchingAccess || this.previewExport?.complete) return;
    this.previewExportOpen = true;
    this.begin('Preparing exam previews…', true, 'previews');
    try {
      this.previewExport ??= new ExamPreviewExport(this.folder, this.exams);
      const { createExamPreviewPdf } = await import('./pdf');
      await this.previewExport.run(this.drive, async exam => {
        const source = this.previews.get(exam.id);
        if (!source) throw new Error('The exam is no longer loaded. Download the selected exams again.');
        return createExamPreviewPdf(source.bytes, this.controller!.signal);
      }, (message, saved, total) => {
        this.message = message; this.progress = saved / total * 100; this.updateProgress();
      });
      this.previewExportOpen = false;
    } catch (error) {
      this.failure(error);
      this.message = `${this.previewExport?.savedCount || 0} of ${this.exams.length} previews saved. Keep this tab open and retry to resume.`;
    } finally { this.end(); }
  }
  selectFile(id: string, included: boolean): void {
    if (this.busy || !this.available.some(file => file.id === id)) return;
    if (included) this.included.add(id); else this.included.delete(id);
    this.selectionChanged();
  }
  private selectionChanged(): void {
    this.clearPreviewExport();
    this.clearPreview(); this.exams = []; this.reviewOpen = this.completed = false;
    this.error = ''; this.message = `${this.included.size} of ${this.available.length} PDFs selected.`;
    const scrollTop = document.querySelector('.matching-file-list')?.scrollTop || 0;
    this.refresh();
    const list = document.querySelector('.matching-file-list');
    if (list) list.scrollTop = scrollTop;
  }
  input(value: string): void {
    this.query = value;
    const student = this.selected();
    const target = document.getElementById('match-target');
    if (target) target.textContent = student ? student.filename : 'Choose a student from the suggestions.';
    const save = document.getElementById('match-save') as HTMLButtonElement | null;
    if (save) save.disabled = !student || !this.crop || !this.drive.connected || this.busy;
  }
  keydown(event: KeyboardEvent): void {
    if (this.busy || !this.crop || event.isComposing || event.repeat) return;
    const input = event.target as HTMLInputElement;
    if (event.key === 'Tab' && !event.shiftKey && this.query.trim() && !this.selected()) {
      const candidates = matchingStudents(this.students, this.query);
      if (candidates.length === 1) {
        event.preventDefault();
        input.value = studentLabel(candidates[0]);
        this.input(input.value);
      }
    } else if (event.key === 'Enter' && this.selected()) {
      event.preventDefault();
      void this.save();
    }
  }
  handle(id: string): boolean {
    switch (id) {
      case 'match-access': this.drive.connectMatching(); break;
      case 'match-load': void this.load(); break;
      case 'match-preload': void this.preload(); break;
      case 'match-files': this.filesOpen = !this.filesOpen; this.refresh(); break;
      case 'match-review': this.reviewOpen = !this.reviewOpen; this.refresh(); break;
      case 'match-previews': if (this.completed) { this.previewExportOpen = !this.previewExportOpen; this.refresh(); } break;
      case 'match-create-previews': void this.createPreviews(); break;
      case 'match-select-all': this.included = new Set(this.available.map(file => file.id)); this.selectionChanged(); break;
      case 'match-select-none': this.included.clear(); this.selectionChanged(); break;
      case 'match-setup': this.setupOpen = !this.setupOpen; this.refresh(); break;
      case 'match-prev': void this.navigate(this.index - 1); break;
      case 'match-next': void this.navigate(this.index + 1); break;
      case 'match-retry': void this.navigate(this.index); break;
      case 'match-save': void this.save(); break;
      case 'match-cancel': if (!this.saving) this.controller?.abort(); break;
      case 'match-full': if (this.bytes) openPagePreview(this.bytes, 1, id); break;
      default: return false;
    }
    return true;
  }
  render(ready: boolean, automatic = false): string {
    const disable = (value: boolean) => value ? 'disabled' : '';
    const exam = this.crop ? this.exams[this.index] : undefined, student = this.selected();
    const done = this.exams.filter(exam => this.recognized(exam)).length;
    const savedPreviews = this.previewExport?.savedCount || 0;
    return `<section id="panel-match" role="tabpanel" aria-labelledby="task-match">
      <div class="intro"><div><p class="eyebrow">MATCH STUDENTS</p><h1>A name for every exam.</h1><p class="lead-copy">Start with a folder of already-sliced exams and a student CSV list. <br>Read the handwritten name, choose a student, and rename the PDF.</p></div></div>
      <div role="alert" class="alert alert-danger" ${this.error ? '' : 'hidden'}>${html(this.error)}</div>
      <section class="subtask workspace-panel ${this.busy && this.busyStage === 'setup' ? 'subtask-busy' : ''}">
        <h2 class="subtask-heading"><button id="match-setup" aria-expanded="${this.setupOpen}" aria-controls="match-setup-body" ${disable(this.busy)}><span class="step-number">1</span><span class="subtask-title">${automatic ? 'Load exams & students' : 'Choose exams & student list'}<small>${html(this.folder?.name || 'Choose a Drive folder')} · ${html(this.csv?.name || 'Choose a CSV')}</small></span><span aria-hidden="true">${this.setupOpen ? '⌃' : '⌄'}</span></button></h2>
        <div id="match-setup-body" class="subtask-body" ${this.setupOpen ? '' : 'hidden'}>
          ${automatic ? renderTaskInputs(this.folder, this.csv, '03_Split') : `          <div class="selection-grid"><div class="selection-step"><h3>Exam folder</h3><div class="file-selection"><strong>${html(this.folder?.name || 'No folder selected')}</strong></div><div class="selection-actions"><button id="match-folder" class="btn btn-outline-primary" ${disable(!ready || this.busy)}>Choose exam folder</button></div></div>
          <div class="selection-step"><h3>Student CSV</h3><div class="file-selection"><strong>${html(this.csv?.name || 'No CSV selected')}</strong></div><div class="selection-actions"><button id="match-csv" class="btn btn-outline-primary" ${disable(!ready || this.busy)}>Choose student CSV</button></div><p>Columns: Nr., Nachname, Vorname, E-Mail-Adresse. Semicolon or comma separated.</p></div></div>
`}
          ${!this.drive.matchingAccess ? `<div class="matching-access"><p>To find and rename existing exams inside a folder, allow access to your Drive files. Google will ask for broader Drive permission than Slice exams uses.</p><button id="match-access" class="btn btn-outline-primary" ${disable(!ready || this.busy)}>Enable folder access</button></div>` : ''}
          <div class="panel-footer"><span>List PDFs in this folder and load the student list. Subfolders are not included.</span><button id="match-load" class="btn btn-primary" ${disable(this.busy || !this.folder || !this.csv || !this.drive.matchingAccess)}>Find exams & students</button></div>
        </div>
      </section>
      <section class="subtask workspace-panel ${this.busy && this.busyStage === 'files' ? 'subtask-busy' : ''}">
        <h2 class="subtask-heading"><button id="match-files" aria-expanded="${this.filesOpen}" aria-controls="match-files-body" ${disable(this.busy || !this.available.length)}><span class="step-number">2</span><span class="subtask-title">Select exam files<small>${this.available.length ? `${this.included.size} of ${this.available.length} PDFs selected` : 'Available after choosing the folder and student list'}</small></span><span aria-hidden="true">${this.filesOpen ? '⌃' : '⌄'}</span></button></h2>
        <div id="match-files-body" class="subtask-body" ${this.filesOpen ? '' : 'hidden'}>
          <div class="matching-file-actions"><button id="match-select-all" class="btn btn-sm btn-outline-secondary" ${disable(this.busy)}>Select all</button><button id="match-select-none" class="btn btn-sm btn-outline-secondary" ${disable(this.busy)}>Select none</button></div>
          <div class="matching-file-list">${this.available.map((file, index) => `<label class="matching-file-row"><input id="match-file-${index}" type="checkbox" data-match-file="${html(file.id)}" ${this.included.has(file.id) ? 'checked' : ''} ${disable(this.busy)} /><span>${html(file.name)}</span></label>`).join('')}</div>
          <div class="panel-footer"><span>Only selected PDFs will be downloaded and matched.</span><button id="match-preload" class="btn btn-primary" ${disable(this.busy || !this.included.size || !this.drive.matchingAccess)}>Download & start matching</button></div>
        </div>
      </section>
      <section class="subtask workspace-panel ${this.busy && this.busyStage === 'review' ? 'subtask-busy' : ''}" aria-label="Match an exam">
        <h2 class="subtask-heading"><button id="match-review" aria-expanded="${this.reviewOpen}" aria-controls="match-review-body" ${disable(this.busy || !exam)}><span class="step-number">3</span><span class="subtask-title">Match students & rename<small>${exam ? `${done} of ${this.exams.length} selected exams matched` : 'Available after downloading the selected PDFs'}</small></span><span aria-hidden="true">${this.reviewOpen ? '⌃' : '⌄'}</span></button></h2>
        <div id="match-review-body" class="matching-review subtask-body" ${this.reviewOpen ? '' : 'hidden'}>
        ${exam ? `
        <div class="section-heading"><h2>Exam ${this.index + 1} of ${this.exams.length}</h2><span class="count-badge">${done} / ${this.exams.length} filenames matched</span></div>
        <p class="matching-filename">${html(exam.name)}</p>
        <div class="name-crop">${this.crop ? `<img src="${this.crop}" alt="Top right name area of the exam front page" />` : '<p>Load the page to see the handwritten name.</p>'}</div>
        <div class="matching-navigation"><button id="match-prev" class="btn btn-outline-secondary" ${disable(this.busy || this.index === 0)}>Previous</button><button id="match-full" class="btn btn-outline-secondary" ${disable(this.busy || !this.bytes)}>View full front page</button><button id="match-next" class="btn btn-outline-secondary" ${disable(this.busy || this.index === this.exams.length - 1)}>Next / skip for now</button>${!this.crop ? `<button id="match-retry" class="btn btn-outline-secondary" ${disable(this.busy)}>Retry page</button>` : ''}</div>
        <label for="student-search" class="form-label fw-semibold">Student</label><input id="student-search" type="text" class="form-control" list="student-suggestions" autocomplete="off" placeholder="Type a first or last name…" value="${html(this.query)}" ${disable(this.busy || !this.crop)} aria-describedby="match-target match-keys" />
        <p id="match-keys" class="form-text">Tab completes a unique match. Once selected, Enter renames the PDF and advances.</p>
        <datalist id="student-suggestions">${this.students.map(student => `<option value="${html(studentLabel(student))}"></option>`).join('')}</datalist>
        <div class="matching-save"><div><span>New filename</span><strong id="match-target">${html(student?.filename || 'Choose a student from the suggestions.')}</strong><small>Renames the existing file in Drive. PDF contents stay unchanged.</small></div><button id="match-save" class="btn btn-primary" ${disable(this.busy || !student || !this.crop || !this.drive.connected)}>Rename & next</button></div>
        ` : ''}
      </div></section>
      <section class="subtask workspace-panel ${this.busy && this.busyStage === 'previews' ? 'subtask-busy' : ''}">
        <h2 class="subtask-heading"><button id="match-previews" aria-expanded="${this.previewExportOpen}" aria-controls="match-previews-body" ${disable(this.busy || !this.completed)}><span class="step-number">4</span><span class="subtask-title">Create exam previews<small>${this.completed ? `${savedPreviews} of ${this.exams.length} previews saved` : 'Available after all selected exams have student filenames'}</small></span><span aria-hidden="true">${this.previewExportOpen ? '⌃' : '⌄'}</span></button></h2>
        <div id="match-previews-body" class="subtask-body" ${this.previewExportOpen ? '' : 'hidden'}>
          <div class="selection-step"><div class="step-heading"><h3>Front-page previews</h3></div><p>Create one PDF per selected exam containing the full-width upper 20% of its first page. Previews keep the exam filenames, so you can select 04_Previews in Prepare drafts to send them to students.</p>
            <div class="file-selection ${this.previewExport?.folder ? 'has-selection' : ''}"><div><strong>${this.previewExport?.folder ? `<a href="https://drive.google.com/drive/folders/${encodeURIComponent(this.previewExport.folder.id)}" target="_blank" rel="noopener">04_Previews ↗</a>` : '04_Previews'}</strong><span>Beside ${html(this.folder?.name || 'the selected exam folder')}, inside the Test folder. Created if needed.</span></div></div>
            <p class="folder-hint">Existing preview filenames are kept. A retry resumes the remaining files.</p>
          </div>
          ${this.completed ? `<div class="result-list">${this.exams.map(exam => {
            const row = this.previewExport?.rows.find(row => row.source.id === exam.id);
            return `<article class="result-row"><div class="result-info"><strong>${html(examPreviewFilename(exam.name))}</strong><span>Front page · upper 20%</span></div><div class="result-actions">${row?.saved ? `<a class="saved-link" href="https://drive.google.com/file/d/${encodeURIComponent(row.id!)}/view" target="_blank" rel="noopener">${row.existing ? 'Already saved' : 'Saved'} ↗</a>` : '<span class="pending-label">Pending</span>'}</div></article>`;
          }).join('')}</div>` : ''}
          <div class="panel-footer"><span>${savedPreviews} / ${this.exams.length} previews saved to Drive.</span><button id="match-create-previews" class="btn btn-primary" ${disable(this.busy || !this.completed || !this.drive.matchingAccess || Boolean(this.previewExport?.complete))}>${this.busy && this.busyStage === 'previews' ? 'Creating previews…' : this.previewExport?.complete ? 'All previews saved' : this.previewExport ? 'Retry remaining previews' : 'Create previews'}</button></div>
        </div>
      </section>
      <div id="match-progress" tabindex="-1" class="progress-area ${this.busy ? 'progress-active progress-island' : this.completed ? 'matching-complete' : ''}" ${this.message ? '' : 'hidden'}><div class="progress-caption"><span role="status" aria-live="polite">${html(this.message)}</span>${this.busy && !this.saving ? '<button id="match-cancel" class="btn btn-sm btn-outline-secondary">Cancel loading</button>' : ''}</div>${this.busy ? `<div class="progress ${this.progress === null ? 'progress-indeterminate' : ''}" role="progressbar" aria-label="Matching progress" ${this.progress === null ? '' : `aria-valuenow="${Math.round(this.progress)}"`} aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:${this.progress === null ? 35 : this.progress}%"></div></div>` : ''}</div>
    </section>`;
  }
}
