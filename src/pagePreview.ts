/** Render the selected original page on demand, rather than enlarging its thumbnail. */
export function openPagePreview(bytes: Uint8Array, pageNumber: number, triggerId: string): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'page-preview-dialog';
  dialog.setAttribute('aria-labelledby', 'page-preview-title');
  dialog.innerHTML = `<header class="page-preview-heading"><h2 id="page-preview-title">Page ${pageNumber}</h2><button class="btn btn-outline-secondary" autofocus>Close</button></header>
    <div class="page-preview-body"><p role="status">Loading page…</p><canvas hidden role="img" aria-label="Full view of page ${pageNumber}"></canvas></div>`;
  const controller = new AbortController();
  const previousOverflow = document.body.style.overflow;
  document.body.append(dialog);
  document.body.style.overflow = 'hidden';
  dialog.addEventListener('close', () => {
    controller.abort();
    dialog.remove();
    document.body.style.overflow = previousOverflow;
    document.getElementById(triggerId)?.focus({ preventScroll: true });
  }, { once: true });
  dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  dialog.showModal();
  const canvas = dialog.querySelector('canvas')!;
  const status = dialog.querySelector('p')!;
  void (async () => {
    try {
      const { renderPagePreview } = await import('./pdf');
      await renderPagePreview(bytes, pageNumber, canvas, controller.signal);
      if (controller.signal.aborted) return;
      status.hidden = true;
      canvas.hidden = false;
    } catch (error) {
      if (!controller.signal.aborted) {
        status.setAttribute('role', 'alert');
        status.textContent = `Could not display this page. ${error instanceof Error ? error.message : ''}`;
      }
    }
  })();
}
