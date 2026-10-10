import { renderTaskInputs } from './workflowInputs';
import { GoogleDrive, GoogleHttpError } from './googleDrive';
import { Gmail } from './gmail';
import type { DriveItem } from './types';
import { parseStudents, type Student } from './students';
import { buildDraftMime, encodeDraft, type Attachment } from './email';
import { planDrafts, prepareDraftRows, type DraftRow } from './draftPlan';

const html = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
export class DraftTask {
  folder?: DriveItem;
  csv?: DriveItem;
  private workflowFolders?: { split?: DriveItem; previews?: DriveItem };
  private mode: 'preview' | 'final' = 'final';
  setPaths(folders: { split?: DriveItem; previews?: DriveItem }, csv?: DriveItem): void {
    const folder = this.mode === 'preview' ? folders.previews : folders.split;
    this.workflowFolders = folders;
    if (this.folder?.id === folder?.id && this.csv?.id === csv?.id) return;
    if (this.hasIncompleteBatch) return;
    this.reset(); this.folder = folder; this.csv = csv;
  }
  changeMode(mode: string): void {
    if (this.started || this.busy || !['preview', 'final'].includes(mode)) return;
    this.mode = mode as 'preview' | 'final';
    if (this.workflowFolders) this.setPaths(this.workflowFolders, this.csv);
    this.refresh();
  }
  private picker?: 'folder' | 'csv' | 'attachment';
  private students: Student[] = [];
  private rows: DraftRow[] = [];
  private account = '';
  private subject = 'Deine Klassenarbeit';
  private body = 'Hallo {{Vorname}},\n\nim Anhang findest du deine korrigierte Klassenarbeit.\n\nViele Grüße';
  private labels = 'bulk-send';
  private labelNames: string[] = [];
  private extraFiles: File[] = [];
  private expanded = { setup: true, compose: false, review: false };
  private prepared = false;
  private started = false;
  private busy = false;
  private saving = false;
  private stopRequested = false;
  private error = '';
  private message = '';
  private progress: number | null = null;
  private controller?: AbortController;
  private gmail: Gmail;
  constructor(private google: GoogleDrive, private refresh: () => void, private setBusy: (busy: boolean) => void) { this.gmail = new Gmail(google); }
  prefill(folder?: DriveItem, csv?: DriveItem): void { this.folder ??= folder; this.csv ??= csv; }
  private complete(row: DraftRow): boolean { return Boolean(row.draftId && (!this.labelNames.length || row.labelsApplied)); }
  get hasIncompleteBatch(): boolean { return this.started && this.rows.some(row => row.included && !this.complete(row)); }
  reset(): void {
    this.extraFiles = []; this.labelNames = []; this.labels = 'bulk-send';
    this.folder = this.csv = undefined; this.students = []; this.rows = []; this.account = '';
    this.prepared = this.started = false; this.expanded = { setup: true, compose: false, review: false }; this.message = this.error = '';
  }
  pick(kind: 'folder' | 'csv' | 'attachment'): void { this.picker = kind; this.google.openPicker(kind); }
  accept(item: DriveItem, items: DriveItem[] = [item]): void {
    if (this.picker === 'attachment') { this.picker = undefined; void this.loadAttachments(items); return; }
    if (this.picker === 'folder') this.folder = item; else this.csv = item;
    this.picker = undefined; this.rows = []; this.students = []; this.prepared = false; this.error = this.message = ''; this.expanded = { setup: true, compose: false, review: false };
  }
  private begin(message: string, saving = false): void {
    this.busy = true; this.saving = saving; this.stopRequested = false; this.message = message; this.error = ''; this.progress = null;
    this.controller = new AbortController(); this.setBusy(true); this.refresh();
    document.getElementById('draft-progress')?.focus({ preventScroll: true });
  }
  private end(): void {
    this.busy = this.saving = false; this.controller = undefined; this.setBusy(false); this.refresh();
    document.getElementById(this.started ? 'draft-progress' : this.expanded.review ? 'draft-toggle-review' : this.expanded.compose ? 'draft-toggle-compose' : 'draft-toggle-setup')?.focus({ preventScroll: true });
  }
  private progressUpdate(): void {
    const panel = document.getElementById('draft-progress');
    if (!panel) return;
    panel.querySelector('[role="status"]')!.textContent = this.message;
    const bar = panel.querySelector<HTMLElement>('[role="progressbar"]')!;
    bar.classList.toggle('progress-indeterminate', this.progress === null);
    if (this.progress === null) bar.removeAttribute('aria-valuenow'); else bar.setAttribute('aria-valuenow', String(Math.round(this.progress)));
    bar.setAttribute('aria-valuetext', this.message);
    bar.querySelector<HTMLElement>('.progress-bar')!.style.width = `${this.progress === null ? 35 : this.progress}%`;
  }
  async load(): Promise<void> {
    if (this.busy || this.started || !this.folder || !this.csv || !this.google.draftsAccess || !this.google.matchingAccess) return;
    this.rows = []; this.prepared = false;
    this.begin('Reading student list, exam filenames and Gmail account…');
    try {
      this.account = await this.gmail.account(this.controller!.signal);
      this.students = parseStudents(await this.google.downloadCsv(this.csv, this.controller!.signal));
      const files = await this.google.listFolderPdfs(this.folder.id, this.controller!.signal);
      if (!files.length) throw new Error('This folder contains no PDFs.');
      this.rows = planDrafts(files, this.students);
      this.expanded = { setup: false, compose: true, review: false };
      this.message = `Found ${files.length} PDFs; ${this.rows.filter(row => row.included).length} have a matching student and valid email.`;
    } catch (error) { this.error = this.controller?.signal.aborted ? '' : String(error instanceof Error ? error.message : error); this.message = this.controller?.signal.aborted ? 'Loading cancelled.' : ''; }
    finally { this.end(); }
  }
  input(id: string, value: string): void {
    if (this.busy || this.started) return;
    if (id === 'draft-subject') this.subject = value;
    if (id === 'draft-body') this.body = value;
    if (id === 'draft-labels') this.labels = value;
    this.prepared = false; this.expanded.review = false;
    // Keep the editor mounted while typing; remove the stale review immediately.
    const review = document.getElementById('draft-review-body'); if (review) review.hidden = true;
    const toggle = document.getElementById('draft-toggle-review') as HTMLButtonElement | null;
    if (toggle) { toggle.disabled = true; toggle.setAttribute('aria-expanded', 'false'); }
  }
  private validateAttachments(files: File[]): void {
    if (files.some(file => !file.size)) throw new Error('Cannot attach an empty file.');
    if (files.reduce((total, file) => total + file.size, 0) >= 25_000_000) throw new Error('Shared attachments must total less than 25 MB, leaving space for each exam PDF.');
  }
  private async loadAttachments(items: DriveItem[]): Promise<void> {
    if (this.busy || this.started) return;
    this.begin('Downloading shared attachments…');
    const downloaded: File[] = [];
    try {
      for (const [index, item] of items.entries()) {
        const file = await this.google.downloadAttachment(item, this.controller!.signal, (received, total) => {
          this.progress = total ? (index + Math.min(1, received / total)) / items.length * 100 : null;
          this.message = `Downloading shared attachment ${index + 1} of ${items.length}: ${item.name}… ${(received / 1048576).toFixed(1)} MB${total ? ` of ${(total / 1048576).toFixed(1)} MB` : ''}`;
          this.progressUpdate();
        });
        downloaded.push(file);
        this.validateAttachments([...this.extraFiles, ...downloaded]);
      }
      this.extraFiles.push(...downloaded); this.prepared = false; this.expanded.review = false;
      this.message = `${downloaded.length} shared attachments added.`;
    } catch (error) {
      this.error = this.controller?.signal.aborted ? '' : (error as Error).message;
      this.message = 'No files from this selection were added. Existing attachments were kept.';
    } finally { this.end(); }
  }
  attachments(files: File[]): void {
    if (this.busy || this.started) return;
    this.error = '';
    try {
      this.validateAttachments([...this.extraFiles, ...files]);
      this.extraFiles.push(...files); this.prepared = false; this.expanded.review = false;
    } catch (error) { this.error = (error as Error).message; }
    this.refresh();
  }
  private removeAttachment(index: number): void {
    if (this.busy || this.started || !Number.isInteger(index) || !this.extraFiles[index]) return;
    this.extraFiles.splice(index, 1); this.prepared = false; this.expanded.review = false; this.error = ''; this.refresh();
  }
  select(index: number, included: boolean): void {
    if (this.busy || this.started || !this.rows[index] || this.rows[index].issue) return;
    this.rows[index].included = included; this.prepared = false; this.expanded.review = false; this.refresh();
  }
  prepare(): void {
    if (this.busy || this.started) return;
    try {
      this.labelNames = [...new Set(this.labels.split(',').map(name => name.trim()).filter(Boolean))];
      if (this.labelNames.some(name => /[\r\n\u0000]/.test(name))) throw new Error('Enter label names separated by commas without line breaks.');
      if (this.labelNames.length > 100) throw new Error('Use at most 100 labels.');
      if (this.labelNames.length && !this.google.gmailLabelsAccess) throw new Error('Connect Google in the header to grant Gmail label access, then preview again.');
      prepareDraftRows(this.rows, this.subject, this.body);
      this.prepared = true; this.error = ''; this.expanded = { setup: false, compose: false, review: true };
      this.message = 'Review each recipient, expanded message and PDF attachment before creating drafts.';
    } catch (error) { this.error = (error as Error).message; }
    this.refresh(); document.getElementById(this.prepared ? 'draft-toggle-review' : 'draft-subject')?.focus({ preventScroll: true });
  }
  async create(): Promise<void> {
    if (this.busy || !this.prepared || !this.folder || !this.google.draftsAccess) return;
    this.begin('Checking Gmail account…', true);
    try {
      const account = await this.gmail.account();
      if (account !== this.account) throw new Error('The Gmail account changed. Reconnect the account shown in the preview before continuing.');
      if (this.labelNames.length && !this.google.gmailLabelsAccess) throw new Error('Connect Google in the header to grant Gmail label access, then retry.');
      this.started = true;
      const labelIds = await this.gmail.ensureLabels(this.labelNames);
      const extraAttachments: Attachment[] = await Promise.all(this.extraFiles.map(async file => ({ filename: file.name, mimeType: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) })));
      const selected = this.rows.filter(row => row.included);
      for (const [index, row] of selected.entries()) {
        if (this.complete(row)) continue;
        if (this.stopRequested) break;
        row.error = undefined;
        row.messageId ??= `${crypto.randomUUID()}@edu-test-manager.invalid`;
        this.message = `Preparing draft ${index + 1} of ${selected.length}…`; this.progress = index / selected.length * 100; this.progressUpdate();
        try {
          // A previous ambiguous response is only reconciled, never blindly repeated.
          if (row.uncertain) {
            const existing = await this.gmail.findDraft(row.messageId);
            if (!existing) throw new Error('Gmail has not confirmed the previous attempt. Check Gmail Drafts, then retry the status check. No duplicate will be created automatically.');
            row.draftId = existing.id; row.uncertain = false;
          }
          if (!row.draftId) {
            const bytes = await this.google.downloadPdf(row.file, this.controller!.signal, (received, total) => {
              this.progress = (index + (total ? Math.min(1, received / total) * .7 : 0)) / selected.length * 100;
              this.message = `Downloading attachment ${index + 1} of ${selected.length}… ${(received / 1048576).toFixed(1)} MB${total ? ` of ${(total / 1048576).toFixed(1)} MB` : ''}`;
              this.progressUpdate();
            });
            if (this.stopRequested) break;
            const raw = encodeDraft(buildDraftMime({ from: this.account, to: row.student!.email, subject: row.subject!, body: row.body!, filename: row.file.name, bytes, messageId: row.messageId, extraAttachments }));
            this.message = `Saving draft ${index + 1} of ${selected.length} in Gmail…`; this.progress = (index + .8) / selected.length * 100; this.progressUpdate();
            row.uncertain = true;
            try {
              const draft = await this.gmail.create(raw);
              row.draftId = draft.id; row.uncertain = false;
            } catch (error) {
              if (error instanceof GoogleHttpError && error.status >= 400 && error.status < 500 && error.status !== 408) row.uncertain = false;
              throw error;
            }
          }
          this.message = `Applying labels to draft ${index + 1} of ${selected.length}…`; this.progressUpdate();
          await this.gmail.labelDraft(row.draftId!, labelIds);
          row.labelsApplied = true;
        } catch (error) { row.error = (error as Error).message; throw error; }
      }
      const done = selected.filter(row => this.complete(row)).length;
      this.progress = done / selected.length * 100;
      this.message = `${done} of ${selected.length} drafts saved in Gmail. Nothing was sent.${this.stopRequested ? ' Resume when ready.' : ''}`;
      if (done === selected.length) this.expanded.review = false;
    } catch (error) {
      this.error = (error as Error).message;
      this.message = `${this.rows.filter(row => row.draftId).length} drafts saved. Retry resumes missing drafts or labels without recreating saved drafts.`;
    } finally { this.end(); }
  }
  handle(id: string): boolean {
    if (id.startsWith('draft-extra-remove-')) { this.removeAttachment(Number(id.slice('draft-extra-remove-'.length))); return true; }
    switch (id) {
      case 'draft-load': void this.load(); break;
      case 'draft-prepare': this.prepare(); break;
      case 'draft-create': void this.create(); break;
      case 'draft-stop': if (this.saving) { this.stopRequested = true; this.message = 'Stopping after the current operation…'; this.progressUpdate(); } else this.controller?.abort(); break;
      case 'draft-toggle-setup': this.expanded.setup = !this.expanded.setup; this.refresh(); break;
      case 'draft-toggle-compose': this.expanded.compose = !this.expanded.compose; this.refresh(); break;
      case 'draft-toggle-review': this.expanded.review = !this.expanded.review; this.refresh(); break;
      case 'draft-new':
        if (!this.hasIncompleteBatch || window.confirm('Some drafts may already exist in Gmail. Starting a new batch discards retry tracking. Check Gmail before including these files again. Start a new batch?')) { const folder = this.folder; const csv = this.csv; this.reset(); this.prefill(folder, csv); this.refresh(); }
        break;
      default: return false;
    }
    return true;
  }
  render(ready: boolean, automatic = false): string {
    const disabled = (value: boolean) => value ? 'disabled' : '';
    const locked = this.busy || this.started;
    const selected = this.rows.filter(row => row.included);
    const done = selected.filter(row => this.complete(row)).length;
    const section = (key: 'setup' | 'compose' | 'review', number: number, title: string, summary: string, available: boolean) => `<section class="subtask workspace-panel ${this.busy ? 'subtask-busy' : ''}"><h2 class="subtask-heading"><button id="draft-toggle-${key}" aria-controls="draft-${key}-body" aria-expanded="${this.expanded[key]}" ${disabled(this.busy || !available)}><span class="step-number">${number}</span><span class="subtask-title">${title}<small>${html(summary)}</small></span><span aria-hidden="true">${this.expanded[key] ? '⌃' : '⌄'}</span></button></h2><div id="draft-${key}-body" class="subtask-body" ${this.expanded[key] ? '' : 'hidden'}>`;
    return `<section id="panel-drafts" role="tabpanel" aria-labelledby="task-drafts">
      <div class="intro"><div><p class="eyebrow">PREPARE EMAILS</p><h1>Ready for your final check.</h1><p class="lead-copy">Create a Gmail draft for each student with their exam attached. Review and send later in Gmail.</p></div></div>
      <div role="alert" class="alert alert-danger" ${this.error ? '' : 'hidden'}>${html(this.error)}</div>
      ${this.started ? `<div class="batch-actions"><button id="draft-new" class="btn btn-sm btn-outline-secondary" ${disabled(this.busy)}>Start a new draft batch</button></div>` : ''}
      ${section('setup', 1, automatic ? 'Choose draft type' : 'Choose exams & student list', `${this.folder?.name || 'Choose a folder'} · ${this.csv?.name || 'Choose a CSV'}`, true)}
        <fieldset id="draft-mode" class="draft-mode-switch" aria-describedby="draft-mode-hint" ${disabled(locked)}><legend>What should students receive?</legend><div class="draft-mode-options">
          ${(['preview', 'final'] as const).map(mode => `<label class="draft-mode-option"><input id="draft-mode-${mode}" type="radio" name="draft-mode" value="${mode}" ${this.mode === mode ? 'checked' : ''} /><span>${mode === 'preview' ? 'Preview drafts' : 'Final drafts'}</span></label>`).join('')}
        </div><p id="draft-mode-hint" class="form-text">${this.mode === 'preview' ? 'Front-page previews for students to check' : 'Complete corrected exams'}</p></fieldset>
        ${automatic ? renderTaskInputs(this.folder, this.csv, this.mode === 'preview' ? '04_Previews' : '03_Split') : `        <div class="selection-grid"><div class="selection-step"><h3>Renamed exam folder</h3><div class="file-selection"><strong>${html(this.folder?.name || 'No folder selected')}</strong></div><div class="selection-actions"><button id="draft-folder" class="btn btn-outline-primary" ${disabled(locked || !ready)}>Choose exam folder</button></div></div>
        <div class="selection-step"><h3>Student CSV</h3><div class="file-selection"><strong>${html(this.csv?.name || 'No CSV selected')}</strong></div><div class="selection-actions"><button id="draft-csv" class="btn btn-outline-primary" ${disabled(locked || !ready)}>Choose student CSV</button></div></div></div>
`}
        <div class="panel-footer"><span>Matches files by their exact NR_NACHNAME_VORNAME.pdf filename.</span><button id="draft-load" class="btn btn-primary" ${disabled(locked || !this.folder || !this.csv || !this.google.draftsAccess || !this.google.matchingAccess)}>Load recipients & exams</button></div>
      </div></section>
      ${section('compose', 2, 'Choose files & write template', this.rows.length ? `${selected.length} of ${this.rows.length} PDFs selected` : 'Available after loading', this.rows.length > 0)}
        <div class="draft-editor"><p>Gmail account: <strong>${html(this.account)}</strong></p><div class="draft-file-list">${this.rows.map((row, index) => `<label class="matching-file-row"><input id="draft-file-${index}" data-draft-file="${index}" type="checkbox" ${row.included ? 'checked' : ''} ${disabled(locked || Boolean(row.issue))} /><span><strong>${html(row.file.name)}</strong><small>${html(row.issue || row.student!.email)}</small></span></label>`).join('')}</div>
        <label for="draft-subject" class="form-label">Subject template</label><input id="draft-subject" class="form-control" value="${html(this.subject)}" ${disabled(locked)} />
        <label for="draft-labels" class="form-label">Gmail labels (comma-separated)</label><input id="draft-labels" class="form-control" placeholder="bulk-send, 8A, Informatik" value="${html(this.labels)}" ${disabled(locked)} /><p class="form-text">Applied to every draft. Missing labels are created. Use bulk-send to find these drafts in Batch send; Gmail may take time to display labels.</p>
        <label for="draft-body" class="form-label">Message template</label><textarea id="draft-body" class="form-control" rows="8" ${disabled(locked)}>${html(this.body)}</textarea><p class="form-text">Use CSV column names in double braces: {{Vorname}}, {{Nachname}}, {{Nr.}}, {{E-Mail-Adresse}}. Plain text only. Unknown placeholders are reported before creation.</p>
        <label for="draft-extra" class="form-label">Shared attachments for all students</label><input id="draft-extra" type="file" multiple class="form-control" ${disabled(locked)} /><button id="draft-extra-drive" class="btn btn-outline-primary" ${disabled(locked || !ready)}>Add attachments from Drive</button><p class="form-text">Add files from your computer or Google Drive. Google documents are attached as PDFs. Each draft includes its exam PDF and all shared files, up to 25 MB combined.</p>
        ${this.extraFiles.map((file, index) => `<p class="shared-attachment">${html(file.name)} · ${(file.size / 1048576).toFixed(2)} MB <button id="draft-extra-remove-${index}" class="btn btn-sm btn-outline-secondary" aria-label="Remove ${html(file.name)}" ${disabled(locked)}>Remove</button></p>`).join('')}

        <button id="draft-prepare" class="btn btn-primary" ${disabled(locked || !selected.length)}>Preview drafts</button></div>
      </div></section>
      ${section('review', 3, 'Review & create drafts', this.prepared ? `${done} of ${selected.length} saved` : 'Available after previewing the template', this.prepared)}
        <div class="draft-editor"><p>Sender: <strong>${html(this.account)}</strong>. Each PDF is attached directly to its student’s draft.</p>
        ${this.prepared ? selected.map(row => `<article class="draft-preview"><h3>${html(row.file.name)}</h3><p><strong>To:</strong> ${html(row.student!.email)}</p><p><strong>Subject:</strong> ${html(row.subject!)}</p><pre>${html(row.body!)}</pre><p>Attachment: ${html(row.file.name)} · application/pdf</p>${this.extraFiles.map(file => `<p>Shared attachment: ${html(file.name)}</p>`).join('')}<p>Gmail labels: ${html(this.labelNames.join(', ') || 'None')}</p><p>${row.draftId ? this.complete(row) ? 'Saved in Gmail Drafts' : 'Draft saved; labels pending' : row.uncertain ? 'Checking whether Gmail saved this draft' : 'Not created yet'}</p>${row.error ? `<p class="text-danger">${html(row.error)}</p>` : ''}</article>`).join('') : ''}
        <button id="draft-create" class="btn btn-primary" ${disabled(this.busy || !this.prepared || !this.google.draftsAccess || done === selected.length)}>${this.started ? 'Retry / resume remaining drafts' : `Create ${selected.length} drafts in Gmail`}</button></div>
      </div></section>
      <div id="draft-progress" tabindex="-1" class="progress-area ${this.busy ? 'progress-active progress-island' : this.started && done === selected.length ? 'matching-complete' : ''}" ${this.message ? '' : 'hidden'}><div class="progress-caption"><span role="status" aria-live="polite">${html(this.message)}</span>${this.busy ? `<button id="draft-stop" class="btn btn-sm btn-outline-secondary">${this.saving ? 'Stop after this draft' : 'Cancel loading'}</button>` : ''}</div>${this.busy ? `<div class="progress ${this.progress === null ? 'progress-indeterminate' : ''}" role="progressbar" aria-label="Draft progress" ${this.progress === null ? '' : `aria-valuenow="${Math.round(this.progress)}"`} aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:${this.progress === null ? 35 : this.progress}%"></div></div>` : ''}</div>
      ${this.started ? '<p><a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noopener">Open Gmail Drafts</a> — select the account shown above if you use multiple accounts. Keep this tab open until the batch finishes; reloading loses retry tracking.</p>' : ''}
    </section>`;
  }
}
