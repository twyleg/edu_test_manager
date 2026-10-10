import { GoogleDrive, GoogleHttpError } from './googleDrive';
import { Gmail, draftHeader, draftAttachments, type DraftDetails } from './gmail';

const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
interface Row {
  draft: DraftDetails;
  selected: boolean;
  status: string;
  blocked: boolean;
}
export class BatchSendTask {
  private gmail: Gmail;
  private rows: Row[] = [];
  private account = '';
  private loaded = false;
  private busy = false;
  private sending = false;
  private stop = false;
  private error = '';
  private message = '';
  private progress = 0;
  private expanded = { load: true, review: false };
  private controller?: AbortController;
  // Keep successful and uncertain attempts locked even after refreshing the list.
  private outcomes = new Map<string, string>();

  constructor(
    private google: GoogleDrive,
    private refresh: () => void,
    private setBusy: (busy: boolean) => void,
  ) {
    this.gmail = new Gmail(google);
  }

  reset(): void {
    this.rows = [];
    this.account = '';
    this.loaded = false;
    this.message = '';
    this.error = '';
    this.expanded = { load: true, review: false };
  }

  private key(id: string): string {
    return `${this.account}:${id}`;
  }

  private begin(message: string, sending = false): void {
    this.busy = true;
    this.sending = sending;
    this.stop = false;
    this.error = '';
    this.message = message;
    this.progress = 0;
    this.controller = new AbortController();
    this.setBusy(true);
    this.refresh();
    document.getElementById('send-progress')?.focus({ preventScroll: true });
  }

  private end(): void {
    this.sending = false;
    this.busy = false;
    this.controller = undefined;
    this.setBusy(false);
    this.refresh();
    document.getElementById('send-progress')?.focus({ preventScroll: true });
  }

  async load(): Promise<void> {
    if (this.busy || !this.google.draftsAccess) {
      return;
    }
    this.rows = [];
    this.loaded = false;
    this.begin('Loading drafts with the Gmail label bulk-send…');
    try {
      this.account = await this.gmail.account(this.controller!.signal);
      const drafts = await this.gmail.listBatchDrafts(this.controller!.signal);
      this.rows = drafts.map((draft) => ({
        draft,
        selected: false,
        status: this.outcomes.get(this.key(draft.id)) || '',
        blocked: this.outcomes.has(this.key(draft.id)),
      }));
      this.loaded = true;
      this.expanded = { load: false, review: true };
      this.message = drafts.length
        ? `Found ${drafts.length} drafts. Select the messages to send.`
        : 'No drafts found for Gmail label bulk-send. Apply bulk-send in Gmail or Prepare emails, then reload. Newly applied labels may take time to appear.';
    } catch (error) {
      this.error = this.controller?.signal.aborted ? '' : (error as Error).message;
      this.message = this.controller?.signal.aborted ? 'Loading cancelled.' : '';
    } finally {
      this.end();
    }
  }

  select(index: number, selected: boolean): void {
    const row = this.rows[index];
    if (!this.busy && row && !row.blocked) {
      row.selected = selected;
      this.refresh();
      document.getElementById(`send-row-${index}`)?.focus();
    }
  }

  async send(): Promise<void> {
    const selected = this.rows.filter((row) => row.selected && !row.blocked);
    if (this.busy || !selected.length || !this.google.draftsAccess) {
      return;
    }
    this.begin('Checking Gmail account…', true);
    let sent = 0;
    try {
      if ((await this.gmail.account()) !== this.account) {
        throw new Error('The Gmail account changed. Reload the list and review the recipients.');
      }
      // Recheck membership once before sending so removed labels are respected.
      const eligible = new Set((await this.gmail.listBatchDrafts()).map((draft) => draft.id));
      for (const row of selected) {
        if (this.stop) {
          break;
        }
        row.status = '';
        try {
          if (!eligible.has(row.draft.id)) {
            throw new Error('This draft no longer matches the label. Reload the list.');
          }
          const current = await this.gmail.get(row.draft.id);
          // Gmail replaces the immutable message (and its ID) whenever a draft is edited.
          // JSON property order and attachment metadata are not content revision identifiers.
          if (current.message.id !== row.draft.message.id) {
            throw new Error(
              'This draft changed in Gmail. Reload the list and review it before sending.',
            );
          }
          if (this.stop) {
            break;
          }
          this.message = `Sending ${sent + 1} of ${selected.length}…`;
          this.refresh();
          try {
            await this.gmail.send(row.draft.id);
          } catch (error) {
            if (!(
              error instanceof GoogleHttpError &&
              error.status >= 400 &&
              error.status < 500 &&
              error.status !== 408
            )) {
              row.blocked = true;
              row.selected = false;
              this.outcomes.set(
                this.key(row.draft.id),
                'Send result unknown. Check Gmail Sent; automatic retry is disabled.',
              );
            }
            throw error;
          }
          row.status = 'Sent';
          row.blocked = true;
          row.selected = false;
          this.outcomes.set(this.key(row.draft.id), row.status);
          sent++;
          this.progress = (sent / selected.length) * 100;
        } catch (error) {
          row.status = this.outcomes.get(this.key(row.draft.id)) || (error as Error).message;
          throw error;
        }
      }
      this.message = `${sent} of ${selected.length} selected emails sent.${this.stop ? ' Stopped; remaining drafts were kept.' : ''}`;
      if (sent === selected.length) {
        this.expanded.review = false;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.expanded.review = true;
      this.message = `${sent} emails sent. Batch stopped: ${this.error}`;
    } finally {
      this.end();
    }
  }

  handle(id: string): boolean {
    switch (id) {
      case 'send-load':
        void this.load();
        break;
      case 'send-submit':
        void this.send();
        break;
      case 'send-all':
        if (!this.busy) {
          this.rows.forEach((row) => {
            if (!row.blocked) {
              row.selected = true;
            }
          });
          this.refresh();
        }
        break;
      case 'send-none':
        if (!this.busy) {
          this.rows.forEach((row) => (row.selected = false));
          this.refresh();
        }
        break;
      case 'send-stop':
        if (this.sending) {
          this.stop = true;
          this.message = 'Stopping after the current operation…';
          this.refresh();
        } else {
          this.controller?.abort();
        }
        break;
      case 'send-toggle-load':
        this.expanded.load = !this.expanded.load;
        this.refresh();
        break;
      case 'send-toggle-review':
        this.expanded.review = !this.expanded.review;
        this.refresh();
        break;
      default:
        return false;
    }
    return true;
  }

  render(ready: boolean): string {
    const disabled = (value: boolean) => (value ? 'disabled' : '');
    const count = this.rows.filter((row) => row.selected && !row.blocked).length;
    const section = (key: 'load' | 'review', number: number, title: string, summary: string) =>
      `<section class="subtask workspace-panel ${this.busy ? 'subtask-busy' : ''}"><h2 class="subtask-heading"><button id="send-toggle-${key}" aria-controls="send-${key}-body" aria-expanded="${this.expanded[key]}" ${disabled(this.busy || (key === 'review' && !this.loaded))}><span class="step-number">${number}</span><span class="subtask-title">${title}<small>${html(summary)}</small></span><span aria-hidden="true">${this.expanded[key] ? '⌃' : '⌄'}</span></button></h2><div id="send-${key}-body" class="subtask-body" ${this.expanded[key] ? '' : 'hidden'}>`;
    return `<section id="panel-send" role="tabpanel" aria-labelledby="task-send">
      <div class="intro"><div><p class="eyebrow">BATCH SEND</p><h1>Send the drafts you select.</h1><p class="lead-copy">Find drafts using the Gmail label <strong>bulk-send</strong>, then review the recipients before sending.</p></div></div>
      <div role="alert" class="alert alert-danger" ${this.error ? '' : 'hidden'}>${html(this.error)}</div>
      ${section('load', 1, 'Load labeled drafts', this.account || 'Connect your Gmail account')}
      <div class="draft-editor"><p>Uses Gmail’s label search <code>label:bulk-send</code>. Subject tags are not used. Apply bulk-send in Prepare emails or Gmail. Newly applied labels may take time to appear.</p>
      <button id="send-load" class="btn btn-primary" ${disabled(this.busy || !this.google.draftsAccess)}>Load drafts</button></div></div></section>
      ${section('review', 2, 'Select & send', this.loaded ? `${count} of ${this.rows.length} drafts selected` : 'Available after loading')}
      <div class="draft-editor"><p>Gmail account: <strong>${html(this.account)}</strong></p><p>Batch send immediately sends each selected draft with its existing recipients, message and attachments.</p>
      <div class="selection-actions"><button id="send-all" class="btn btn-sm btn-outline-secondary" ${disabled(this.busy || !this.rows.length)}>Select all</button><button id="send-none" class="btn btn-sm btn-outline-secondary" ${disabled(this.busy || !count)}>Clear selection</button></div>
      ${this.rows.map((row, index) => `<article class="draft-preview"><label class="matching-file-row"><input id="send-row-${index}" data-send-row="${index}" type="checkbox" ${row.selected ? 'checked' : ''} ${disabled(this.busy || row.blocked)} /><span><strong>${html(draftHeader(row.draft, 'Subject') || '(No subject)')}</strong><small>${html(row.status)}</small></span></label>${['From', 'To', 'Cc', 'Bcc'].map((name) => `<p><strong>${name}:</strong> ${html(draftHeader(row.draft, name) || '—')}</p>`).join('')}<p>${html(row.draft.message.snippet || '')}</p><p><strong>Attachments:</strong> ${html(draftAttachments(row.draft.message.payload).join(', ') || 'None')}</p></article>`).join('')}
      <button id="send-submit" class="btn btn-primary" ${disabled(this.busy || !count || !this.google.draftsAccess)}>Batch send (${count})</button></div></div></section>
      <div id="send-progress" tabindex="-1" class="progress-area ${this.busy ? 'progress-active progress-island' : this.error ? 'alert alert-danger' : 'matching-complete'}" ${this.message ? '' : 'hidden'}><div class="progress-caption"><span role="status" aria-live="polite">${html(this.message)}</span>${this.busy ? `<button id="send-stop" class="btn btn-sm btn-outline-secondary">${this.sending ? 'Stop after this email' : 'Cancel loading'}</button>` : ''}</div>${this.busy ? `<div class="progress ${this.sending ? '' : 'progress-indeterminate'}" role="progressbar" aria-label="Batch send progress" ${this.sending ? `aria-valuenow="${Math.round(this.progress)}"` : ''} aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:${this.sending ? this.progress : 35}%"></div></div>` : ''}</div>
    </section>`;
  }
}
