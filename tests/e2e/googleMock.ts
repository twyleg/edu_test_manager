import type { Page } from '@playwright/test';

export async function mockGoogleUi(page: Page, manualSelection = false): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://apis.google.com/js/api.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.gapi = { load: (name, options) => options.callback() };
    window.google = window.google || {};
    class DocsView {
      constructor(id) { this.id = id; }
      setIncludeFolders() { return this; } setSelectFolderEnabled(enabled) { this.selectFolders = enabled; return this; }
      setMimeTypes(mime) { this.mime = mime; return this; } setMode() { return this; }
      setParent() { return this; } setEnableDrives() { return this; }
    }
    class PickerBuilder {
      setTitle(title) { this.title = title; return this; }
      setDeveloperKey() { return this; } setAppId() { return this; } setOAuthToken() { return this; }
      setOrigin() { return this; } addView(view) { (this.views ||= []).push(view); return this; }
      setRelayUrl(url) { this.relayUrl = url; return this; }
      setSelectableMimeTypes(types) { this.selectableMimeTypes = types; return this; }
      setCallback(callback) { this.callback = callback; return this; }
      build() { return { setVisible: () => {
        if (!this.relayUrl || new URL(this.relayUrl).origin !== location.origin) throw new Error('Picker needs a same-origin relay URL.');
        window.__mockPickerRelayUrl = this.relayUrl;
        const folder = this.title.includes('folder');
        const csv = this.title.includes('CSV');
        const item = { id: folder ? 'destination-folder' : csv ? 'students-csv' : 'source-pdf',
          name: folder ? 'Physics class' : csv ? 'students.csv' : 'Drive exam.pdf',
          mimeType: folder ? 'application/vnd.google-apps.folder' : csv ? 'text/csv' : 'application/pdf' };
        if (!this.selectableMimeTypes.split(',').includes(item.mimeType)) throw new Error('Picker must explicitly allow the selected MIME type.');
        if (folder && !this.views.every(view => view.selectFolders)) throw new Error('Folder selection must be enabled in every view.');
        if (!${manualSelection}) {
          setTimeout(() => this.callback({ action: 'picked', docs: [item] }), 0);
          return;
        }
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-label', this.title);
        dialog.style.cssText = 'position:fixed;inset:20%;background:white;padding:30px;z-index:10000;border:1px solid black';
        const row = document.createElement('button');
        row.textContent = item.name;
        const select = document.createElement('button');
        select.textContent = 'Select'; select.disabled = true;
        row.onclick = () => { select.disabled = false; };
        select.onclick = () => { dialog.remove(); this.callback({ action: 'picked', docs: [item] }); };
        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        cancel.onclick = () => { dialog.remove(); this.callback({ action: 'cancel' }); };
        const empty = document.createElement('button');
        empty.textContent = 'Simulate empty selection';
        empty.onclick = () => { dialog.remove(); this.callback({ action: 'picked', docs: [] }); };
        dialog.append(row, select, cancel, empty);
        document.body.append(dialog);
        this.callback({ action: 'loaded' });
      } }; }
    }
    window.google.picker = { DocsView, PickerBuilder, ViewId: { DOCS: 'docs', PDFS: 'pdfs', FOLDERS: 'folders' },
      DocsViewMode: { LIST: 'list' }, Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' }, Document: { ID: 'id', NAME: 'name', MIME_TYPE: 'mimeType' } };
  ` }));
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.google = window.google || {};
    window.google.accounts = { oauth2: {
      initTokenClient: options => ({ requestAccessToken: overrides => options.callback({ access_token: 'browser-test-token', expires_in: 3600, scope: overrides?.scope || options.scope }) }),
      revoke: (token, done) => done(),
    } };
  ` }));
}
