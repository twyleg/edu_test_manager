import { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';
import { escapeHtml } from './view';

export function openNewFolderDialog(
  drive: GoogleDrive,
  parent?: DriveItem,
): Promise<DriveItem | undefined> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'new-folder-dialog';
    dialog.setAttribute('aria-labelledby', 'new-folder-heading');
    dialog.innerHTML = `<form>
      <h2 id="new-folder-heading">Create a new folder</h2>
      <p>Inside <strong>${escapeHtml(parent?.name ?? 'My Drive')}</strong></p>
      <label for="new-folder-name" class="form-label">Folder name</label>
      <input id="new-folder-name" class="form-control" name="folderName" required autocomplete="off" autofocus />
      <p class="folder-dialog-error text-danger" role="alert" hidden></p>
      <div class="folder-dialog-actions"><button type="button" class="btn btn-outline-secondary">Cancel</button>
      <button type="submit" class="btn btn-primary">Create folder</button></div>
    </form>`;
    const form = dialog.querySelector('form')!;
    const input = dialog.querySelector('input')!;
    const cancel = dialog.querySelector<HTMLButtonElement>('button[type=button]')!;
    const submit = dialog.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const error = dialog.querySelector<HTMLElement>('[role=alert]')!;
    let creating = false;
    let attempt: { id: string; name: string } | undefined;
    let result: DriveItem | undefined;
    cancel.onclick = () => dialog.close();
    dialog.addEventListener('cancel', (event) => {
      if (creating) {
        event.preventDefault();
      }
    });
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        resolve(result);
      },
      { once: true },
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (creating) {
        return;
      }
      const name = input.value.trim();
      if (!name) {
        input.setCustomValidity('Enter a folder name.');
        input.reportValidity();
        return;
      }
      creating = true;
      submit.disabled = true;
      cancel.disabled = true;
      input.disabled = true;
      submit.textContent = 'Creating…';
      error.hidden = true;
      try {
        if (parent) {
          await drive.verifyFolder(parent);
        }
        if (!attempt || attempt.name !== name) {
          attempt = { id: await drive.generateFileId(), name };
        }
        result = await drive.createFolder(attempt.id, name, parent?.id);
        dialog.close();
      } catch (cause) {
        error.textContent =
          cause instanceof Error ? cause.message : 'Could not create the folder. Please retry.';
        error.hidden = false;
      } finally {
        creating = false;
        submit.disabled = false;
        cancel.disabled = false;
        input.disabled = false;
        submit.textContent = 'Create folder';
      }
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    document.body.append(dialog);
    dialog.showModal();
  });
}
