import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';
import { FolderJob, TestCreationJob, missingCourseFolders } from './testStructure';
import type { TestType } from './testNames';
import { escapeHtml as html } from './view';

// Keep a partially completed job in its dialog until it can be retried safely.
function jobDialog<T>(title: string, content: string, action: string, makeJob: (form: HTMLFormElement) => () => Promise<T>): Promise<T | undefined> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'new-folder-dialog';
    dialog.setAttribute('aria-labelledby', 'test-dialog-heading');
    dialog.innerHTML = `<form><h2 id="test-dialog-heading">${html(title)}</h2>${content}<p role="alert" class="text-danger" hidden></p><div class="folder-dialog-actions"><button type="button" class="btn btn-outline-secondary">Cancel</button><button type="submit" class="btn btn-primary">${html(action)}</button></div></form>`;
    const form = dialog.querySelector('form')!;
    const cancel = form.querySelector<HTMLButtonElement>('[type=button]')!;
    const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    const error = form.querySelector<HTMLElement>('[role=alert]')!;
    let run: (() => Promise<T>) | undefined;
    let busy = false;
    let result: T | undefined;
    cancel.onclick = () => dialog.close();
    dialog.addEventListener('cancel', event => { if (busy || run) event.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, { once: true });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      try {
        run ??= makeJob(form);
        busy = true; cancel.disabled = submit.disabled = true;
        form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(input => { input.disabled = true; });
        error.hidden = true; submit.textContent = 'Creating…';
        result = await run(); dialog.close();
      } catch (cause) {
        error.textContent = `${cause instanceof Error ? cause.message : String(cause)}${run ? ' Keep this dialog open and retry to finish the same folders.' : ''}`;
        error.hidden = false;
      } finally { busy = false; submit.disabled = false; cancel.disabled = Boolean(run); submit.textContent = run ? 'Retry creation' : action; }
    });
    document.body.append(dialog); dialog.showModal();
  });
}
export async function confirmCourseSetup(drive: GoogleDrive, course: DriveItem): Promise<boolean> {
  const missing = await missingCourseFolders(drive, course);
  if (!missing.length) return true;
  return Boolean(await jobDialog('Set up course folders', `<p>Missing in <strong>${html(course.name)}</strong>:</p><ul>${missing.map(name => `<li>${html(name)}</li>`).join('')}</ul><p>Create these folders?</p>`, 'Create folders', () => {
    const job = new FolderJob();
    return async () => {
      await drive.verifyFolder(course);
      for (const name of missing) await job.ensure(drive, course, name);
      return true;
    };
  }));
}
export function openNewTestDialog(drive: GoogleDrive, course: DriveItem): Promise<DriveItem | undefined> {
  return jobDialog('Create a new test', `<p>Course: <strong>${html(course.name)}</strong></p><label for="new-test-topic" class="form-label">Test topic</label><input id="new-test-topic" name="topic" class="form-control" required autofocus autocomplete="off" /><label for="new-test-type" class="form-label mt-3">Test type</label><select id="new-test-type" name="type" class="form-select"><option value="LZK">LZK</option><option value="Klausur">Klausur</option></select><p class="form-text mt-3">Creates a numbered test folder with 01_Scans, 02_Korrigiert, 03_Split and 04_Previews.</p>`, 'Create test', form => {
    const data = new FormData(form);
    const job = new TestCreationJob(course, data.get('type') as TestType, String(data.get('topic') || ''));
    return () => job.run(drive);
  });
}
