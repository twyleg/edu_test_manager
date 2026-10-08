import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';

/** Download only the requested scan; closing the dialog cancels all pending work. */
export function openScanPreview(drive: GoogleDrive, item: DriveItem, triggerId: string): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'page-preview-dialog scan-preview-dialog';
  dialog.setAttribute('aria-labelledby', 'scan-preview-title');
  dialog.innerHTML = `<header class="page-preview-heading"><h2 id="scan-preview-title"></h2><button data-close class="btn btn-outline-secondary" autofocus>Close</button></header>
    <div class="scan-preview-navigation"><button data-previous class="btn btn-outline-secondary" disabled>Previous page</button><span data-page></span><button data-next class="btn btn-outline-secondary" disabled>Next page</button></div>
    <div class="page-preview-body"><p role="status" aria-live="polite">Loading scan…</p><button data-retry class="btn btn-outline-primary" hidden>Retry preview</button><canvas hidden role="img"></canvas></div>`;
  dialog.querySelector('h2')!.textContent = item.name;
  const controller = new AbortController();
  const canvas = dialog.querySelector('canvas')!;
  const status = dialog.querySelector('p')!;
  const previous = dialog.querySelector<HTMLButtonElement>('[data-previous]')!;
  const next = dialog.querySelector<HTMLButtonElement>('[data-next]')!;
  const retry = dialog.querySelector<HTMLButtonElement>('[data-retry]')!;
  const pageLabel = dialog.querySelector<HTMLElement>('[data-page]')!;
  let bytes: Uint8Array | undefined;
  let pageNumber = 1;
  let pageCount = 0;
  let rendering = false;
  const previousOverflow = document.body.style.overflow;
  document.body.append(dialog);
  document.body.style.overflow = 'hidden';
  dialog.addEventListener('close', () => {
    controller.abort(); bytes = undefined;
    canvas.width = canvas.height = 0;
    dialog.remove(); document.body.style.overflow = previousOverflow;
    document.getElementById(triggerId)?.focus({ preventScroll: true });
  }, { once: true });
  dialog.querySelector('[data-close]')!.addEventListener('click', () => dialog.close());
  async function render(): Promise<void> {
    if (rendering || controller.signal.aborted) return;
    rendering = true; previous.disabled = next.disabled = true;
    retry.hidden = true; canvas.hidden = true; status.hidden = false;
    status.setAttribute('role', 'status');
    status.textContent = bytes ? `Loading page ${pageNumber}…` : 'Downloading scan…';
    try {
      bytes ??= await drive.downloadPdf(item, controller.signal, (received, total) => {
        if (!controller.signal.aborted) status.textContent = total ? `Downloading scan… ${Math.round(received / total * 100)}%` : 'Downloading scan…';
      });
      controller.signal.throwIfAborted();
      const { renderPagePreview } = await import('./pdf');
      pageCount = await renderPagePreview(bytes, pageNumber, canvas, controller.signal);
      controller.signal.throwIfAborted();
      canvas.setAttribute('aria-label', `Page ${pageNumber} of ${pageCount} of ${item.name}`);
      canvas.hidden = false; status.hidden = true;
      pageLabel.textContent = `Page ${pageNumber} of ${pageCount}`;
      previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= pageCount;
    } catch (error) {
      if (!controller.signal.aborted) {
        bytes = undefined;
        status.setAttribute('role', 'alert');
        status.textContent = `Could not preview this scan. ${error instanceof Error ? error.message : ''}`;
        retry.hidden = false;
      }
    } finally { rendering = false; }
  }
  previous.addEventListener('click', () => { if (!rendering && pageNumber > 1) { pageNumber--; void render(); } });
  next.addEventListener('click', () => { if (!rendering && pageNumber < pageCount) { pageNumber++; void render(); } });
  retry.addEventListener('click', () => { void render(); });
  dialog.showModal();
  void render();
}
