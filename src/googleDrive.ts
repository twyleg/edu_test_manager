import { driveScope, folderMimeType, googleConfig, getGoogleConfigError, hasGoogleConfig, pdfMimeType } from './config';
import type { DriveItem } from './types';

const tokenStorageKey = 'edu-test-manager-token';
interface CachedToken { accessToken: string; expiresAt: number }
type PickerKind = 'pdf' | 'folder';
interface Callbacks {
  onConnection: (connected: boolean) => void;
  onError: (message: string) => void;
  onPick: (kind: PickerKind, item: DriveItem) => void;
  onPickerClosed: () => void;
}

export class GoogleDrive {
  private token: CachedToken | null = null;
  private client: TokenClient | null = null;
  private pendingPicker?: PickerKind;
  private callbacks?: Callbacks;

  get connected(): boolean { return Boolean(this.token && this.token.expiresAt > Date.now()); }

  async initialize(callbacks: Callbacks): Promise<void> {
    this.callbacks = callbacks;
    if (!hasGoogleConfig()) return;
    await Promise.all([
      loadScript('https://apis.google.com/js/api.js'),
      loadScript('https://accounts.google.com/gsi/client'),
    ]);
    await new Promise<void>((resolve, reject) => window.gapi.load('picker', {
      callback: resolve, onerror: () => reject(new Error('Could not load Google Picker. Reload to retry.')),
      timeout: 15000, ontimeout: () => reject(new Error('Google Picker timed out. Reload to retry.')),
    }));
    this.client = window.google.accounts.oauth2.initTokenClient({
      client_id: googleConfig.clientId!, scope: driveScope,
      callback: response => {
        if (response.error || !response.access_token) {
          this.pendingPicker = undefined;
          callbacks.onPickerClosed();
          callbacks.onError(response.error_description || response.error || 'Google authorization failed.');
          return;
        }
        this.token = { accessToken: response.access_token,
          expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000 - 60000 };
        try { sessionStorage.setItem(tokenStorageKey, JSON.stringify(this.token)); } catch { /* Memory-only fallback. */ }
        callbacks.onConnection(true);
        if (this.pendingPicker) {
          const kind = this.pendingPicker;
          this.pendingPicker = undefined;
          this.openPicker(kind);
        }
      },
      error_callback: () => {
        this.pendingPicker = undefined;
        callbacks.onPickerClosed();
        callbacks.onError('Google sign-in was closed or blocked. Allow pop-ups and try connecting again.');
      },
    });
    try {
      const cached = JSON.parse(sessionStorage.getItem(tokenStorageKey) || 'null') as CachedToken | null;
      if (cached && typeof cached.accessToken === 'string' && cached.expiresAt > Date.now()) this.token = cached;
    } catch { /* Ignore invalid or unavailable storage. */ }
    callbacks.onConnection(this.connected);
  }

  connect(): void {
    if (!this.client) throw new Error('Google sign-in is not ready. Check configuration and reload.');
    this.client.requestAccessToken({ prompt: this.connected ? '' : 'consent' });
  }

  disconnect(): void {
    const token = this.token?.accessToken;
    this.clearToken();
    if (token) window.google.accounts.oauth2.revoke(token, () => {});
  }

  openPicker(kind: PickerKind): void {
    const configError = getGoogleConfigError();
    if (configError) throw new Error(configError);
    if (!this.connected) { this.pendingPicker = kind; this.connect(); return; }
    const picker = window.google.picker;
    // Picker defaults to /favicon.ico for its parent-side RPC relay. Serve a
    // real same-origin HTML document instead of relying on a missing favicon.
    const relayUrl = new URL(`${import.meta.env.BASE_URL}google-picker-relay.html`, window.location.origin).href;
    // Deliberately log only lifecycle events, never tokens, document IDs or names.
    console.info('[Drive Picker] Opening', { kind, origin: window.location.origin, embedded: window.self !== window.top });
    const makeView = () => new picker.DocsView(kind === 'pdf' ? picker.ViewId.DOCS : picker.ViewId.FOLDERS)
      .setIncludeFolders(true).setSelectFolderEnabled(kind === 'folder')
      .setMimeTypes(kind === 'pdf' ? pdfMimeType : folderMimeType).setMode(picker.DocsViewMode.LIST);
    const builder = new picker.PickerBuilder()
      .setTitle(kind === 'pdf' ? 'Choose an exam PDF' : 'Choose an output folder')
      .setDeveloperKey(googleConfig.apiKey!).setAppId(googleConfig.appId!)
      .setOAuthToken(this.token!.accessToken).setOrigin(window.location.origin)
      .setRelayUrl(relayUrl)
      .setSelectableMimeTypes(kind === 'pdf' ? pdfMimeType : folderMimeType);
    if (kind === 'pdf') {
      // No parent restriction: expose Google's PDF listing across folders.
      // RECENTLY_PICKED is deprecated; listing order is controlled by Picker.
      builder.addView(new picker.DocsView(picker.ViewId.PDFS)
        .setMimeTypes(pdfMimeType).setIncludeFolders(false)
        .setSelectFolderEnabled(false).setMode(picker.DocsViewMode.LIST));
    }
    builder
      .addView(makeView().setParent('root')).addView(makeView().setEnableDrives(true))
      .setCallback(data => {
        try {
          const action = data[picker.Response.ACTION];
          const documents = data[picker.Response.DOCUMENTS];
          const event = action === picker.Action.PICKED ? 'picked' : action === picker.Action.CANCEL ? 'cancel'
            : action === 'loaded' ? 'loaded' : action === 'error' ? 'error' : 'other';
          console.info('[Drive Picker] Callback', { event, documentCount: Array.isArray(documents) ? documents.length : 0 });
          if (action === 'error') {
            this.callbacks?.onPickerClosed();
            this.callbacks?.onError('Google Picker could not complete the selection. Check that the API key, OAuth client and numeric app ID belong to the same Google Cloud project, then reconnect.');
            return;
          }
          if (action === picker.Action.CANCEL) this.callbacks?.onPickerClosed();
          if (action !== picker.Action.PICKED) return;
          this.callbacks?.onPickerClosed();
          const doc = Array.isArray(documents) ? documents[0] as PickerDocument | undefined : undefined;
          if (!doc || typeof doc !== 'object') {
            this.callbacks?.onError('Google Picker returned no selected item. Open the picker again, click the file or folder row, then click Select.');
            return;
          }
          const item = { id: String(doc[picker.Document.ID] || ''), name: String(doc[picker.Document.NAME] || ''),
            mimeType: String(doc[picker.Document.MIME_TYPE] || '') };
          if (!item.id || item.mimeType !== (kind === 'pdf' ? pdfMimeType : folderMimeType)) {
            this.callbacks?.onError(kind === 'pdf' ? 'Please select a PDF file.' : 'Please select a folder.');
            return;
          }
          this.callbacks?.onPick(kind, item);
          console.info('[Drive Picker] Selection accepted', { kind });
        } catch {
          console.error('[Drive Picker] The app failed while handling a Picker callback.');
          this.callbacks?.onError('The app could not handle the Google Picker response. Reload the page and retry; check the browser console for [Drive Picker] events.');
        }
      }).build().setVisible(true);
  }

  async downloadPdf(item: DriveItem, signal: AbortSignal): Promise<Uint8Array> {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?alt=media&supportsAllDrives=true`, { signal });
    return new Uint8Array(await response.arrayBuffer());
  }

  async verifyFolder(item: DriveItem): Promise<void> {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?fields=mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`);
    const info = await response.json() as { mimeType: string; trashed?: boolean; capabilities?: { canAddChildren?: boolean } };
    if (info.mimeType !== folderMimeType || info.trashed || !info.capabilities?.canAddChildren) {
      throw new Error('You cannot add files to this folder. Choose a writable output folder.');
    }
  }

  async generateFileId(): Promise<string> {
    const response = await this.request('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files');
    const result = await response.json() as { ids?: string[] };
    if (!result.ids?.[0]) throw new Error('Google Drive did not provide an upload ID. Please retry.');
    return result.ids[0];
  }

  async createFolder(id: string, name: string, parentId?: string): Promise<DriveItem> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Enter a folder name.');
    const existing = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`, {}, [404]);
    if (existing.ok) return await existing.json() as DriveItem;
    const response = await this.request('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: trimmedName, mimeType: folderMimeType, ...(parentId ? { parents: [parentId] } : {}) }),
    });
    return await response.json() as DriveItem;
  }

  async uploadPdf(id: string, name: string, folderId: string, blob: Blob): Promise<void> {
    // Stable, pre-generated IDs make retries safe even if a successful response was lost.
    const existing = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id&supportsAllDrives=true`, {}, [404]);
    if (existing.ok) return;
    const session = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': pdfMimeType },
      body: JSON.stringify({ id, name, mimeType: pdfMimeType, parents: [folderId] }),
    });
    const location = session.headers.get('Location');
    if (!location) throw new Error('Google Drive did not return an upload URL. Please retry.');
    await this.request(location, { method: 'PUT', headers: { 'Content-Type': pdfMimeType }, body: blob });
  }

  private clearToken(): void {
    this.token = null;
    try { sessionStorage.removeItem(tokenStorageKey); } catch { /* Storage may be disabled. */ }
    this.callbacks?.onConnection(false);
  }

  private async request(url: string, init: RequestInit = {}, allowedStatuses: number[] = []): Promise<Response> {
    if (!this.connected) {
      this.clearToken();
      throw new Error('Your Google session expired. Connect Google Drive again, then retry.');
    }
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token!.accessToken}`);
    let response: Response;
    try { response = await fetch(url, { ...init, headers }); }
    catch (error) {
      if (init.signal?.aborted) throw error;
      throw new Error('Could not reach Google Drive. Check your connection and retry.');
    }
    if (response.ok || allowedStatuses.includes(response.status)) return response;
    if (response.status === 401) {
      this.clearToken();
      throw new Error('Your Google session expired. Connect Google Drive again, then retry.');
    }
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(`Google Drive (${response.status}): ${detail?.error?.message || response.statusText || 'Request failed. Please retry.'}`);
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => finish(new Error('Google services timed out. Check your connection and reload.')), 15000);
    function finish(error?: Error) {
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    }
    script.src = src;
    script.async = true;
    script.onload = () => finish();
    script.onerror = () => finish(new Error('Could not load Google services. Check your connection and reload.'));
    document.head.append(script);
  });
}
