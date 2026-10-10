import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';
import { parseStudents } from './students';
import { escapeHtml as html } from './view';
import { openPagePreview } from './pagePreview';
import { ExamCache } from './examCache';
import { ExamHighlights, defaultHighlight, highlightRectangle, moveHighlight, type HighlightArea } from './examHighlights';
import { ResultsStore, collectResults, documentationRows, normalizeResultKeys, parseResults, prettyResults, resultKey, type DocumentationRow, type Results } from './results';

export class DocumentationTask {
  private course?: DriveItem;
  private test?: DriveItem;
  private folder?: DriveItem;
  private csv?: DriveItem;
  private rows: DocumentationRow[] = [];
  private unmatched: DriveItem[] = [];
  private base: Results = Object.create(null);
  private jsonDraft?: string;
  private replaceResults = false;
  private store?: ResultsStore;
  private index = 0;
  private field: 'points' | 'mark' = 'points';
  private crop?: string;
  private bytes?: Uint8Array;
  private busy = false;
  private saving = false;
  private dirty = false;
  private expanded = { setup: true, points: false, mark: false, results: false };
  private indices = { points: 0, mark: 0 };
  private busyStage: 'setup' | 'points' | 'mark' | 'results' = 'setup';
  private highlights = new ExamHighlights();
  private highlightDraft?: HighlightArea;
  private highlightStart?: { x: number; y: number };
  private error = '';
  private message = '';
  private controller?: AbortController;
  private prefetchController?: AbortController;

  constructor(private drive: GoogleDrive, private refresh: () => void, private setBusy: (busy: boolean) => void, private cache = new ExamCache(drive)) {}
  get hasUnsavedChanges(): boolean { return this.dirty; }
  setPaths(course?: DriveItem, test?: DriveItem, folder?: DriveItem, csv?: DriveItem): void {
    if (this.busy || this.dirty || (this.course?.id === course?.id && this.test?.id === test?.id && this.folder?.id === folder?.id && this.csv?.id === csv?.id)) return;
    this.reset(); this.course = course; this.test = test; this.folder = folder; this.csv = csv;
  }
  private clearPreview(): void {
    if (this.crop) URL.revokeObjectURL(this.crop);
    this.crop = undefined; this.bytes = undefined;
  }
  reset(): void {
    this.prefetchController?.abort(); this.prefetchController = undefined;
    this.clearPreview(); this.rows = []; this.unmatched = []; this.base = Object.create(null); this.store = undefined;
    this.jsonDraft = undefined; this.replaceResults = false;
    this.course = this.test = this.folder = this.csv = undefined;
    this.index = 0; this.indices = { points: 0, mark: 0 }; this.field = 'points'; this.dirty = false;
    this.expanded = { setup: true, points: false, mark: false, results: false };
    this.highlightDraft = this.highlightStart = undefined; this.error = this.message = '';
  }
  private begin(message: string, saving = false, stage: typeof this.busyStage = this.field): void {
    this.busyStage = stage;
    this.busy = true; this.saving = saving; this.error = ''; this.message = message;
    this.controller = new AbortController(); this.setBusy(true); this.refresh();
  }
  private end(): void {
    this.busy = this.saving = false; this.controller = undefined; this.setBusy(false); this.refresh();
    this.focus();
  }
  private focus(): void {
    document.getElementById(this.crop && this.expanded[this.field] ? `doc-${this.field}` : this.expanded.results ? 'doc-json' : 'doc-load')?.focus({ preventScroll: true });
  }
  private failure(error: unknown): void {
    if (this.controller?.signal.aborted) this.message = 'Loading cancelled. Entered results are retained.';
    else { this.error = error instanceof Error ? error.message : String(error); this.message = ''; }
  }
  private async preview(): Promise<void> {
    this.clearPreview();
    const row = this.rows[this.index];
    this.message = `Loading exam ${this.index + 1} of ${this.rows.length}: ${resultKey(row.student)}…`;
    this.refresh();
    const { bytes, corner } = await this.cache.get(row.file, this.controller!.signal);
    this.controller!.signal.throwIfAborted();
    this.crop = URL.createObjectURL(corner);
    this.bytes = bytes;
    this.message = `Exam ${this.index + 1} of ${this.rows.length}. Record the ${this.field === 'points' ? 'points' : 'mark'} shown in the top-right corner.`;
    this.prefetchNext();
  }
  private prefetchNext(): void {
    this.prefetchController?.abort();
    const next = this.rows[this.index + 1] || (this.field === 'points' ? this.rows[0] : undefined);
    this.prefetchController = next ? new AbortController() : undefined;
    if (next) void this.cache.get(next.file, this.prefetchController!.signal).catch(() => { /* Foreground loading can retry a failed prefetch. */ });
  }
  async load(): Promise<void> {
    if (this.busy || !this.course || !this.test || !this.folder || !this.csv || !this.drive.workflowAccess) return;
    if (this.dirty && !window.confirm('Reload results and discard the unsaved entries?')) return;
    this.prefetchController?.abort(); this.prefetchController = undefined;
    this.begin('Loading matched exams and course results…', false, 'setup');
    try {
      const students = parseStudents(await this.drive.downloadCsv(this.csv, this.controller!.signal));
      const files = await this.drive.listFolderPdfs(this.folder.id, this.controller!.signal);
      const { rows, unmatched } = documentationRows(files, students);
      const store = new ResultsStore(this.course, students);
      const base = await store.read(this.drive, this.controller!.signal);
      for (const row of rows) Object.assign(row, base[resultKey(row.student)] || {});
      this.rows = rows; this.unmatched = unmatched; this.store = store; this.base = base;
      this.jsonDraft = undefined; this.replaceResults = false;
      this.field = rows.every(row => row.points.trim()) && rows.some(row => !row.mark.trim()) ? 'mark' : 'points';
      this.index = Math.max(0, rows.findIndex(row => !row[this.field].trim())); this.indices = { points: 0, mark: 0 }; this.indices[this.field] = this.index;
      this.dirty = false; this.expanded = { setup: false, points: this.field === 'points', mark: this.field === 'mark', results: false };
      this.highlightDraft = this.highlightStart = undefined;
      await this.preview();
    } catch (error) { this.failure(error); }
    finally { this.end(); }
  }
  async navigate(index: number): Promise<void> {
    if (this.busy || index < 0 || index >= this.rows.length) return;
    this.index = index; this.indices[this.field] = index;
    this.highlightDraft = this.highlightStart = undefined;
    this.begin(`Loading exam ${index + 1} of ${this.rows.length}…`);
    try { await this.preview(); } catch (error) { this.failure(error); }
    finally { this.end(); }
  }
  private results(): Results {
    return this.jsonDraft === undefined ? collectResults(this.rows, this.base) : normalizeResultKeys(parseResults(this.jsonDraft), this.rows.map(row => row.student));
  }
  private content(): string { return this.jsonDraft ?? prettyResults(this.results()); }
  private fieldCount(field: 'points' | 'mark'): number { return this.rows.filter(row => row[field].trim()).length; }
  private progressText(): string { return `Points: ${this.fieldCount('points')}/${this.rows.length} · Marks: ${this.fieldCount('mark')}/${this.rows.length}${this.dirty ? ' · Unsaved changes' : ''}`; }
  private hasEntries(): boolean { return this.rows.some(row => row.points.trim() || row.mark.trim()); }
  input(id: string, value: string): void {
    if (this.busy || !this.rows.length) return;
    const row = this.rows[this.index];
    if (id === 'doc-json') {
      this.jsonDraft = value; this.replaceResults = true;
      try {
        this.base = this.results();
        for (const entry of this.rows) Object.assign(entry, this.base[resultKey(entry.student)] || { points: '', mark: '' });
      } catch { /* Keep incomplete editor text until the user repairs it. */ }
    }
    else if (id === 'doc-points' || id === 'doc-mark') {
      try { this.results(); } catch { return; }
      row[id === 'doc-points' ? 'points' : 'mark'] = value;
      this.jsonDraft = undefined;
    }
    else return;
    this.dirty = true;
    const progress = document.getElementById('doc-count');
    if (progress) progress.textContent = this.progressText();
    for (const field of ['points', 'mark'] as const) {
      const count = document.querySelector(`#doc-pass-${field} small`);
      if (count) count.textContent = `${this.fieldCount(field)} of ${this.rows.length} exams recorded`;
    }
    this.updateContent();
    // Lock shared selections without rerendering the focused text field.
    document.querySelectorAll<HTMLButtonElement>('.topbar-input').forEach(button => { button.disabled = true; });
  }
  private updateContent(): void {
    const output = document.getElementById('doc-json') as HTMLTextAreaElement | null;
    const validation = document.getElementById('doc-validation');
    let valid = true;
    try {
      this.results();
      if (output && output.value !== this.content()) output.value = this.content();
      if (validation) validation.textContent = '';
    }
    catch (error) { valid = false; if (validation) validation.textContent = error instanceof Error ? error.message : String(error); }
    output?.setAttribute('aria-invalid', String(!valid));
    const input = document.getElementById(`doc-${this.field}`) as HTMLInputElement | null;
    if (input) { if (input.value !== this.rows[this.index][this.field]) input.value = this.rows[this.index][this.field]; input.disabled = !valid; }
    const other = document.querySelector('.documentation-other-value strong');
    if (other) other.textContent = (this.field === 'points' ? this.rows[this.index].mark : this.rows[this.index].points) || 'Not entered yet';
    for (const id of ['doc-save', 'doc-copy', 'doc-save-next']) {
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (button) button.disabled = !valid || (id === 'doc-save' && (!this.drive.workflowAccess || (!this.replaceResults && !this.hasEntries()))) || (id === 'doc-save-next' && (!this.drive.workflowAccess || Boolean(this.highlightDraft) || !this.rows[this.index][this.field].trim()));
    }
  }
  async confirm(): Promise<void> {
    if (this.busy || !this.rows[this.index]?.[this.field].trim()) return;
    try { this.results(); } catch { return; }
    if (this.index < this.rows.length - 1) { await this.navigate(this.index + 1); return; }
    const missing = this.rows.findIndex(row => !row[this.field].trim());
    if (missing >= 0) { await this.navigate(missing); return; }
    if (await this.save(this.field)) {
      this.expanded[this.field] = false;
      if (this.field === 'points') {
        this.field = 'mark'; this.expanded.mark = true; await this.navigate(0);
      } else { this.expanded.results = true; this.refresh(); document.getElementById('doc-json')?.focus({ preventScroll: true }); }
    }
  }
  async save(stage: typeof this.busyStage = 'results'): Promise<boolean> {
    if (this.busy || !this.store || !this.rows.length || !this.drive.workflowAccess) return false;
    this.begin('Saving results.json in the course directory…', true, stage);
    try {
      const changes = this.replaceResults ? this.results() : collectResults(this.rows, Object.create(null));
      if (!this.replaceResults && !Object.keys(changes).length) throw new Error('Enter points or a mark for at least one exam before saving.');
      this.base = await this.store.save(this.drive, changes, this.replaceResults);
      for (const entry of this.rows) Object.assign(entry, this.base[resultKey(entry.student)] || { points: '', mark: '' });
      this.jsonDraft = undefined; this.replaceResults = false;
      this.dirty = false;
      this.message = `Saved results.json in ${this.course!.name}. ${this.progressText()}`;
    } catch (error) { this.failure(error); }
    finally { this.end(); }
    return !this.error;
  }
  async copy(): Promise<void> {
    if (this.busy || !this.rows.length) return;
    try {
      const content = prettyResults(this.results());
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable. Select and copy the JSON below.');
      await navigator.clipboard.writeText(content);
      this.error = ''; this.message = 'results.json content copied to clipboard.';
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    this.refresh();
  }
  handle(id: string): boolean {
    switch (id) {
      case 'doc-setup': this.expanded.setup = !this.expanded.setup; this.refresh(); break;
      case 'doc-results': this.expanded.results = !this.expanded.results; this.refresh(); break;
      case 'doc-load': void this.load(); break;
      case 'doc-prev': void this.navigate(this.index - 1); break;
      case 'doc-next': void this.navigate(this.index + 1); break;
      case 'doc-retry': void this.navigate(this.index); break;
      case 'doc-pass-points': case 'doc-pass-mark':
        if (!this.busy && this.rows.length) {
          const field = id === 'doc-pass-points' ? 'points' : 'mark';
          if (this.field === field) { this.expanded[field] = !this.expanded[field]; this.highlightDraft = this.highlightStart = undefined; this.refresh(); }
          else { this.expanded[this.field] = false; this.field = field; this.expanded[field] = true; void this.navigate(this.indices[field]); }
        }
        break;
      case 'doc-highlight-set':
        if (!this.busy && this.crop) {
          this.highlightStart = undefined;
          this.highlightDraft = { ...(this.highlights.get(this.course!.id, this.field) || defaultHighlight) };
          this.refresh();
          const area = document.getElementById('doc-highlight-area');
          area?.scrollIntoView({ block: 'center' }); area?.focus({ preventScroll: true });
        }
        break;
      case 'doc-highlight-cancel': this.highlightDraft = this.highlightStart = undefined; this.refresh(); this.focus(); break;
      case 'doc-highlight-clear': this.highlights.set(this.course!.id, this.field); this.highlightDraft = undefined; this.refresh(); this.focus(); break;
      case 'doc-save-next': void this.confirm(); break;
      case 'doc-save': void this.save(); break;
      case 'doc-copy': void this.copy(); break;
      case 'doc-cancel': if (!this.saving) this.controller?.abort(); break;
      case 'doc-full': if (this.bytes) openPagePreview(this.bytes, 1, id); break;
      default: return false;
    }
    return true;
  }
  private renderCrop(): string {
    const area = this.highlightDraft || (this.course && this.highlights.get(this.course.id, this.field));
    return `<div class="name-crop documentation-crop">${this.crop ? `<div id="doc-highlight-area" class="documentation-crop-image ${this.highlightDraft ? 'highlight-editing' : ''}" role="group" aria-label="${this.field === 'points' ? 'Points' : 'Grade'} highlight area" ${this.highlightDraft ? 'tabindex="0" aria-describedby="doc-highlight-help"' : ''}><img src="${this.crop}" alt="Top right corner of the exam front page" draggable="false" />${area ? `<div id="doc-highlight-box" class="documentation-highlight" aria-hidden="true" style="left:${area.x * 100}%;top:${area.y * 100}%;width:${area.width * 100}%;height:${area.height * 100}%"></div>` : ''}</div>` : `<p>${this.busy ? 'Loading exam preview…' : 'Exam preview unavailable.'}</p>`}</div>
      <div class="documentation-highlight-controls">${this.highlightDraft ? `<p id="doc-highlight-help" class="form-text">Drag over the ${this.field === 'points' ? 'points' : 'grade'} field to highlight it for this course. Or use arrow keys to move, Shift + arrows to resize, Enter to apply and Escape to cancel.</p><button id="doc-highlight-cancel" class="btn btn-sm btn-outline-secondary">Cancel highlight</button>` : `<span class="form-text">${area ? `${this.field === 'points' ? 'Points' : 'Grade'} area highlighted for this course.` : 'Set the field area once to highlight it on each exam.'}</span><button id="doc-highlight-set" class="btn btn-sm btn-outline-secondary" ${this.busy || !this.crop ? 'disabled' : ''}>${area ? 'Adjust' : 'Set'} ${this.field === 'points' ? 'points' : 'grade'} highlight</button>${area ? `<button id="doc-highlight-clear" class="btn btn-sm btn-outline-secondary" ${this.busy ? 'disabled' : ''}>Remove highlight</button>` : ''}`}</div>`;
  }
  private applyHighlight(): void {
    if (!this.highlightDraft || this.highlightDraft.width < .02 || this.highlightDraft.height < .02) return;
    this.highlights.set(this.course!.id, this.field, this.highlightDraft);
    this.highlightDraft = this.highlightStart = undefined; this.refresh(); this.focus();
  }
  private paintHighlight(): void {
    const box = document.getElementById('doc-highlight-box');
    if (box && this.highlightDraft) {
      const area = this.highlightDraft;
      Object.assign(box.style, { left: `${area.x * 100}%`, top: `${area.y * 100}%`, width: `${area.width * 100}%`, height: `${area.height * 100}%` });
    }
  }
  highlightKeydown(event: KeyboardEvent): boolean {
    if ((event.target as HTMLElement).id !== 'doc-highlight-area' || !this.highlightDraft || event.isComposing || this.busy) return false;
    if (event.key === 'Enter') { event.preventDefault(); this.applyHighlight(); }
    else if (event.key === 'Escape') { event.preventDefault(); this.handle('doc-highlight-cancel'); }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); this.highlightDraft = moveHighlight(this.highlightDraft, event.key, event.shiftKey); this.paintHighlight();
    }
    return true;
  }
  highlightPointer(event: PointerEvent): void {
    if (!this.highlightDraft || this.busy || !event.isPrimary) return;
    const host = (event.target as HTMLElement).closest<HTMLElement>('#doc-highlight-area');
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const point = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    if (event.type === 'pointerdown' && event.button === 0 && event.isPrimary) {
      event.preventDefault(); this.highlightStart = point; host.setPointerCapture(event.pointerId); host.focus();
    } else if (this.highlightStart && (event.type === 'pointermove' || event.type === 'pointerup')) {
      this.highlightDraft = highlightRectangle(this.highlightStart, point); this.paintHighlight();
      if (event.type === 'pointerup') {
        if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
        this.highlightStart = undefined; this.applyHighlight();
      }
    } else if (event.type === 'pointercancel') { this.highlightStart = undefined; this.handle('doc-highlight-cancel'); }
  }
  render(ready: boolean): string {
    const disabled = (value: boolean) => value ? 'disabled' : '';
    const row = this.rows[this.index];
    let content = this.jsonDraft ?? prettyResults(this.base), validation = '';
    try { content = this.content(); this.results(); } catch (error) { validation = error instanceof Error ? error.message : String(error); }
    const subtask = (key: keyof typeof this.expanded, id: string, number: number, title: string, summary: string, enabled: boolean, body: string) => {
      const busy = this.busy && this.busyStage === key;
      return `<section class="subtask workspace-panel ${busy ? 'subtask-busy' : ''}" aria-busy="${busy}"><h2 class="subtask-heading"><button id="${id}" aria-expanded="${this.expanded[key]}" aria-controls="${id}-body" ${disabled(this.busy || !enabled)}><span class="step-number">${number}</span><span class="subtask-title">${title}<small id="${key === 'results' ? 'doc-count' : `doc-count-${key}`}">${html(summary)}</small></span><span class="fold-chevron" aria-hidden="true">${this.expanded[key] ? '⌃' : '⌄'}</span></button></h2><div id="${id}-body" class="subtask-body" ${this.expanded[key] ? '' : 'hidden'}>${body}</div></section>`;
    };
    const review = row ? `<div class="documentation-review">            <div class="section-heading"><h3>${html(row.student.lastName)}, ${html(row.student.firstName)}</h3><span class="count-badge">Exam ${this.index + 1} of ${this.rows.length}</span></div>
            <p class="matching-filename">${html(row.file.name)}</p>
${this.renderCrop()}
            <div class="documentation-fields"><div><label for="doc-${this.field}" class="form-label">${this.field === 'points' ? 'Points' : 'Mark'}</label><input id="doc-${this.field}" type="text" ${this.field === 'points' ? 'inputmode="decimal"' : ''} class="form-control" value="${html(row[this.field])}" placeholder="${this.field === 'points' ? 'e.g. 17,5' : 'e.g. 2+'}" ${disabled(this.busy || Boolean(validation))} /></div><div class="documentation-other-value"><span class="form-label">${this.field === 'points' ? 'Mark' : 'Points'}</span><strong>${html((this.field === 'points' ? row.mark : row.points) || 'Not entered yet')}</strong></div></div>
            <p class="form-text">Press Enter to confirm and continue. Results are saved at the end of each pass; you can also save below at any time.</p>
            <div class="documentation-navigation"><button id="doc-prev" class="btn btn-outline-secondary" ${disabled(this.busy || this.index === 0)}>Previous</button><button id="doc-full" class="btn btn-outline-secondary" ${disabled(this.busy || !this.bytes)}>View full front page</button>${!this.crop ? `<button id="doc-retry" class="btn btn-outline-secondary" ${disabled(this.busy)}>Retry preview</button>` : ''}<button id="doc-next" class="btn btn-outline-secondary" ${disabled(this.busy || this.index === this.rows.length - 1)}>Next</button><button id="doc-save-next" class="btn btn-primary" ${disabled(this.busy || !this.drive.workflowAccess || Boolean(validation) || Boolean(this.highlightDraft) || !row[this.field].trim())}>${this.index === this.rows.length - 1 ? this.field === 'points' ? 'Save points & start marks' : 'Save marks' : 'Confirm & next'}</button></div>
</div>` : '';
    const results = row ? `          <div class="documentation-export"><div class="section-heading"><h3>results.json</h3>${this.store?.file ? `<a class="saved-link" href="https://drive.google.com/file/d/${encodeURIComponent(this.store.file.id)}/view" target="_blank" rel="noopener">View saved file ↗</a>` : ''}</div><p class="form-text">Student keys use “Surname, Firstname”. Points and marks are stored as text; fields not yet entered are empty. Edit the JSON directly to update results, add entries or remove entries.</p><label for="doc-json" class="visually-hidden">Results JSON</label><textarea id="doc-json" class="form-control documentation-json" rows="12" aria-describedby="doc-validation" aria-invalid="${Boolean(validation)}" spellcheck="false" ${disabled(this.busy)}>${html(content)}</textarea><p id="doc-validation" class="form-text text-danger" aria-live="polite">${html(validation)}</p><div class="documentation-navigation"><button id="doc-copy" class="btn btn-outline-primary" ${disabled(this.busy || Boolean(validation))}>Copy JSON</button><button id="doc-save" class="btn btn-primary" ${disabled(this.busy || !this.drive.workflowAccess || Boolean(validation) || (!this.replaceResults && !this.hasEntries()))}>Save results.json</button></div></div>` : '';
    const setup = `<div class="derived-inputs"><div><span>Exam PDFs</span><strong>${html(this.folder?.name || 'Select a current test with a 03_Split folder')}</strong><small>${html(this.test?.name || 'Choose a current test in the topbar')}</small></div><div><span>Student list</span><strong>${html(this.csv?.name || 'Choose a student list in the topbar')}</strong><small>Shared across tasks</small></div></div><div class="panel-footer"><span>Results: ${html(this.course?.name || 'Choose a course directory')} / results.json</span><button id="doc-load" class="btn btn-outline-primary" ${disabled(!ready || this.busy || !this.course || !this.test || !this.folder || !this.csv)}>${row ? 'Reload exams & results' : 'Load exams & results'}</button></div>`;
    return `<section id="panel-documentation" role="tabpanel" aria-labelledby="task-documentation">
      <div class="intro"><div><p class="eyebrow">CREATE DOCUMENTATION</p><h1>Record every result.</h1><p class="lead-copy">Review the exams in two subtasks: first record every student’s points, then their marks.</p></div></div>
      <div role="alert" class="alert alert-danger" ${this.error ? '' : 'hidden'}>${html(this.error)}</div>
      ${subtask('setup', 'doc-setup', 1, 'Load exams & results', `${this.folder?.name || 'Choose a current test'} · ${this.csv?.name || 'Choose a student list'}`, true, setup)}
      ${this.unmatched.length ? `<div class="alert alert-warning documentation-warning">${this.unmatched.length} PDF${this.unmatched.length === 1 ? '' : 's'} could not be matched to the student list: ${html(this.unmatched.map(file => file.name).join(', '))}. Return to Match students to rename them.</div>` : ''}
      ${subtask('points', 'doc-pass-points', 2, 'Record points', row ? `${this.fieldCount('points')} of ${this.rows.length} exams recorded` : 'Available after loading exams', Boolean(row), this.field === 'points' ? review : '')}
      ${subtask('mark', 'doc-pass-mark', 3, 'Record marks', row ? `${this.fieldCount('mark')} of ${this.rows.length} exams recorded` : 'Available after loading exams', Boolean(row), this.field === 'mark' ? review : '')}
      ${subtask('results', 'doc-results', 4, 'Review & save results.json', row ? this.progressText() : 'Available after loading exams', Boolean(row), results)}
      <div id="doc-progress" class="progress-area ${this.busy ? 'progress-active' : ''}" ${this.message ? '' : 'hidden'}><div class="progress-caption"><span role="status" aria-live="polite">${html(this.message)}</span>${this.busy && !this.saving ? '<button id="doc-cancel" class="btn btn-sm btn-outline-secondary">Cancel loading</button>' : ''}</div></div>
    </section>`;
  }
}
