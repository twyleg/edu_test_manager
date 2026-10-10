import { rememberStudentFolder, studentFolderStorageKey } from './privacy';
import { gmailModifyScope, draftsScope, matchingScope, driveScope, folderMimeType, googleConfig, getGoogleConfigError, hasGoogleConfig, pdfMimeType } from './config';
import type { DriveItem } from './types';

export class GoogleHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const validFolderId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);
const tokenStorageKey = 'edu-test-manager-token';
interface CachedToken { accessToken: string; expiresAt: number; scope?: string }
type PickerKind = 'pdf' | 'folder' | 'csv' | 'attachment';
interface Callbacks {
  onConnection: (connected: boolean) => void;
  onError: (message: string) => void;
  onPick: (kind: PickerKind, item: DriveItem, items?: DriveItem[]) => void;
  onPickerClosed: (selected?: boolean) => void;
}

export class GoogleDrive {
  private token: CachedToken | null = null;
  private client: TokenClient | null = null;
  private pendingPicker?: PickerKind;
  private studentFolderSelection = 0;
  private pendingPickerParent?: string;
  private callbacks?: Callbacks;

  get connected(): boolean { return Boolean(this.token && this.token.expiresAt > Date.now()); }

  get matchingAccess(): boolean { return this.connected && Boolean(this.token?.scope?.split(' ').includes(matchingScope)); }

  get draftsAccess(): boolean { return this.connected && Boolean(this.token?.scope?.split(' ').includes(draftsScope)); }

  get gmailLabelsAccess(): boolean { return this.connected && Boolean(this.token?.scope?.split(' ').includes(gmailModifyScope)); }
  get workflowAccess(): boolean { return this.matchingAccess && this.draftsAccess && this.gmailLabelsAccess; }

  async gmailLabelRequest(path: 'labels' | `messages/${string}/modify` | `threads/${string}/modify`, init: RequestInit = {}): Promise<Response> {
    if (!this.gmailLabelsAccess) throw new GoogleHttpError('Connect Google in the header to grant Gmail label access, then retry.', 401);
    return this.request(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, init);
  }

  /** Gmail draft operations, including explicit sending from Batch send. */
  async gmailRequest(path: 'profile' | 'drafts' | `drafts?${string}` | `drafts/${string}`, init: RequestInit = {}): Promise<Response> {
    if (!this.draftsAccess) throw new GoogleHttpError('Connect Google in the header to grant Gmail draft access, then retry.', 401);
    return this.request(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, init);
  }

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
      client_id: googleConfig.clientId!, scope: `${driveScope} ${matchingScope} ${draftsScope} ${gmailModifyScope}`,
      callback: response => {
        if (response.error || !response.access_token) {
          this.pendingPicker = undefined;
          callbacks.onPickerClosed();
          callbacks.onError(response.error_description || response.error || 'Google authorization failed.');
          return;
        }
        this.token = { accessToken: response.access_token, scope: response.scope,
          expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000 - 60000 };
        try { sessionStorage.setItem(tokenStorageKey, JSON.stringify(this.token)); } catch { /* Memory-only fallback. */ }
        callbacks.onConnection(true);
        if (this.pendingPicker) {
          const kind = this.pendingPicker;
          this.pendingPicker = undefined;
          this.openPicker(kind, this.pendingPickerParent);
          this.pendingPickerParent = undefined;
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
    this.client.requestAccessToken({ prompt: this.workflowAccess ? '' : 'consent' });
  }

  forgetSession(): void {
    this.pendingPicker = undefined;
    this.client = null;
    this.clearToken();
  }

  disconnect(): void {
    const token = this.token?.accessToken;
    this.clearToken();
    if (token) window.google.accounts.oauth2.revoke(token, () => {});
  }

  private studentFolder(): string | undefined {
    if (!rememberStudentFolder()) return undefined;
    try {
      const id = localStorage.getItem(studentFolderStorageKey);
      return validFolderId(id) ? id : undefined;
    } catch { return undefined; }
  }

  private async rememberStudentFolder(item: DriveItem, parents: unknown): Promise<void> {
    if (!rememberStudentFolder()) return;
    const selection = ++this.studentFolderSelection;
    try {
      // Picker supplies parent folders for selections; search results may omit them.
      let parent = Array.isArray(parents) && parents.length === 1 ? parents[0]?.id : undefined;
      if (!validFolderId(parent)) {
        const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?fields=parents&supportsAllDrives=true`);
        const metadata = await response.json() as { parents?: string[] };
        parent = metadata.parents?.[0];
      }
      if (rememberStudentFolder() && selection === this.studentFolderSelection && validFolderId(parent)) localStorage.setItem(studentFolderStorageKey, parent);
    } catch { /* Remembering a location is optional; never interrupt CSV selection. */ }
  }

  openPicker(kind: PickerKind, parentId?: string): void {
    const configError = getGoogleConfigError();
    if (configError) throw new Error(configError);
    if (!this.connected) { this.pendingPicker = kind; this.pendingPickerParent = parentId; this.connect(); return; }
    const picker = window.google.picker;
    const mimeTypes = kind === 'attachment' ? '' : kind === 'folder' ? folderMimeType : kind === 'pdf' ? pdfMimeType : 'text/csv,application/csv,text/plain,application/vnd.ms-excel,application/octet-stream';
    // Picker defaults to /favicon.ico for its parent-side RPC relay. Serve a
    // real same-origin HTML document instead of relying on a missing favicon.
    const relayUrl = new URL(`${import.meta.env.BASE_URL}google-picker-relay.html`, window.location.origin).href;
    // Deliberately log only lifecycle events, never tokens, document IDs or names.
    console.info('[Drive Picker] Opening', { kind, origin: window.location.origin, embedded: window.self !== window.top });
    const makeView = () => {
      const view = new picker.DocsView(kind === 'folder' ? picker.ViewId.FOLDERS : picker.ViewId.DOCS)
        .setIncludeFolders(true).setSelectFolderEnabled(kind === 'folder').setMode(picker.DocsViewMode.LIST);
      return mimeTypes ? view.setMimeTypes(mimeTypes) : view;
    };
    const builder = new picker.PickerBuilder()
      .setTitle(kind === 'attachment' ? 'Choose a shared attachment' : kind === 'pdf' ? 'Choose an exam PDF' : kind === 'csv' ? 'Choose a student CSV' : 'Choose an output folder')
      .setDeveloperKey(googleConfig.apiKey!).setAppId(googleConfig.appId!)
      .setOAuthToken(this.token!.accessToken).setOrigin(window.location.origin)
      .setRelayUrl(relayUrl);
    if (mimeTypes) builder.setSelectableMimeTypes(mimeTypes);
    if (kind === 'attachment') builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    if (parentId) builder.addView(makeView().setParent(parentId).setLabel('Selected workflow folder'));
    if (kind === 'pdf' && !parentId) {
      // No parent restriction: expose Google's PDF listing across folders.
      // RECENTLY_PICKED is deprecated; listing order is controlled by Picker.
      builder.addView(new picker.DocsView(picker.ViewId.PDFS)
        .setMimeTypes(pdfMimeType).setIncludeFolders(false)
        .setSelectFolderEnabled(false).setMode(picker.DocsViewMode.LIST));
    }
    const studentFolder = kind === 'csv' ? this.studentFolder() : undefined;
    if (studentFolder) builder.addView(makeView().setParent(studentFolder).setLabel('Last student list folder'));
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
          this.callbacks?.onPickerClosed(true);
          const doc = Array.isArray(documents) ? documents[0] as PickerDocument | undefined : undefined;
          if (!doc || typeof doc !== 'object') {
            this.callbacks?.onError('Google Picker returned no selected item. Open the picker again, click the file or folder row, then click Select.');
            return;
          }
          const selectedDocs = kind === 'attachment' ? documents as PickerDocument[] : [doc];
          const items = selectedDocs.map(selected => ({ id: String(selected[picker.Document.ID] || ''), name: String(selected[picker.Document.NAME] || ''), mimeType: String(selected[picker.Document.MIME_TYPE] || '') }));
          if (items.some(item => !item.id || (kind === 'attachment' ? item.mimeType === folderMimeType : kind === 'csv' ? !/\.csv$/i.test(item.name) : item.mimeType !== (kind === 'pdf' ? pdfMimeType : folderMimeType)))) {
            this.callbacks?.onError(kind === 'attachment' ? 'Please select files.' : kind === 'pdf' ? 'Please select a PDF file.' : kind === 'csv' ? 'Please select a CSV file.' : 'Please select a folder.');
            return;
          }
          if (kind === 'csv') void this.rememberStudentFolder(items[0], data[picker.Response.PARENTS]);
          this.callbacks?.onPick(kind, items[0], items);
          console.info('[Drive Picker] Selection accepted', { kind });
        } catch {
          console.error('[Drive Picker] The app failed while handling a Picker callback.');
          this.callbacks?.onError('The app could not handle the Google Picker response. Reload the page and retry; check the browser console for [Drive Picker] events.');
        }
      }).build().setVisible(true);
  }

  async downloadPdf(item: DriveItem, signal: AbortSignal, onProgress?: (received: number, total?: number) => void): Promise<Uint8Array> {
    return this.downloadFile(item, signal, onProgress);
  }

  async downloadAttachment(item: DriveItem, signal: AbortSignal, onProgress?: (received: number, total?: number) => void): Promise<File> {
    const native = item.mimeType.startsWith('application/vnd.google-apps.');
    if (native && !['document', 'spreadsheet', 'presentation', 'drawing'].some(type => item.mimeType === `application/vnd.google-apps.${type}`)) throw new Error('This Google Drive item cannot be attached. Choose a downloadable file or a Google document, sheet, slide deck or drawing.');
    let bytes: Uint8Array;
    if (native) {
      const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}/export?mimeType=application%2Fpdf`, { signal });
      bytes = new Uint8Array(await response.arrayBuffer());
      signal.throwIfAborted();
      onProgress?.(bytes.length, bytes.length);
    } else bytes = await this.downloadFile(item, signal, onProgress, 25_000_000);
    if (!bytes.length || bytes.length >= 25_000_000) throw new Error('Choose a non-empty attachment smaller than 25 MB, leaving space for the exam PDF.');
    return new File([bytes as Uint8Array<ArrayBuffer>], native && !/\.pdf$/i.test(item.name) ? `${item.name}.pdf` : item.name, { type: native ? pdfMimeType : item.mimeType || 'application/octet-stream' });
  }

  private async downloadFile(item: DriveItem, signal: AbortSignal, onProgress?: (received: number, total?: number) => void, maxBytes = Infinity): Promise<Uint8Array> {
    signal.throwIfAborted();
    onProgress?.(0);
    const fileUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}`;
    const metadataResponse = await this.request(`${fileUrl}?fields=size&supportsAllDrives=true`, { signal });
    const metadata = await metadataResponse.json() as { size?: string };
    const fileSize = Number(metadata.size);
    if (fileSize >= maxBytes) throw new Error('Shared attachment must be smaller than 25 MB.');
    const metadataTotal = Number.isSafeInteger(fileSize) && fileSize > 0 ? fileSize : undefined;
    signal.throwIfAborted();
    onProgress?.(0, metadataTotal);
    const response = await this.request(`${fileUrl}?alt=media&supportsAllDrives=true`, { signal });
    // Drive metadata gives the actual PDF size even when the media response
    // omits Content-Length or compresses the transfer. Headers are a fallback.
    const length = Number(response.headers.get('Content-Length'));
    const encoding = response.headers.get('Content-Encoding');
    let total = metadataTotal ?? (Number.isSafeInteger(length) && length > 0 && (!encoding || encoding === 'identity') ? length : undefined);
    onProgress?.(0, total);
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      signal.throwIfAborted();
      onProgress?.(bytes.length, bytes.length);
      return bytes;
    }
    const reader = response.body.getReader();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastReport = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (received >= maxBytes) throw new Error('Shared attachment must be smaller than 25 MB.');
        if (total !== undefined && received > total) total = undefined;
        const now = performance.now();
        if (now - lastReport >= 100) {
          onProgress?.(received, total);
          lastReport = now;
        }
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      onProgress?.(received, received);
      return bytes;
    } catch (error) {
      await reader.cancel().catch(() => {});
      signal.throwIfAborted();
      throw new Error('File download failed. Check your connection and retry. ' + (error instanceof Error ? error.message : ''));
    } finally {
      signal.removeEventListener('abort', abort);
      reader.releaseLock();
    }
  }

  async downloadCsv(item: DriveItem, signal: AbortSignal): Promise<string> {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?alt=media&supportsAllDrives=true`, { signal });
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return new TextDecoder('windows-1252').decode(bytes); }
  }

  async listFolderPdfs(folderId: string, signal?: AbortSignal): Promise<DriveItem[]> {
    return this.listFolderItems(folderId, pdfMimeType, signal);
  }

  async listFolderItems(folderId: string, mimeType?: string, signal?: AbortSignal): Promise<DriveItem[]> {
    const files: DriveItem[] = [];
    let pageToken = '';
    do {
      const escaped = folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const params = new URLSearchParams({ q: `'${escaped}' in parents and trashed = false${mimeType ? ` and mimeType = '${mimeType}'` : ''}`,
        fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,md5Checksum)', pageSize: '1000', orderBy: 'name_natural',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) });
      const response = await this.request(`https://www.googleapis.com/drive/v3/files?${params}`, { signal });
      const data = await response.json() as { files?: DriveItem[]; nextPageToken?: string; incompleteSearch?: boolean };
      if (data.incompleteSearch) throw new Error('Drive returned an incomplete folder listing. Please retry.');
      files.push(...(data.files || []));
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return files;
  }

  async copyScan(item: DriveItem, sourceFolderId: string, destinationFolderId: string, name: string, copyId: string): Promise<DriveItem> {
    // The job keeps this pre-generated ID, including when a successful response is lost.
    const existing = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(copyId)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true`, {}, [404]);
    if (existing.ok) {
      const copy = await existing.json() as DriveItem & { parents?: string[]; trashed?: boolean };
      if (copy.trashed || copy.mimeType !== pdfMimeType || copy.name !== name || !copy.parents?.includes(destinationFolderId)) {
        throw new Error('The prepared scan copy was changed or moved. Restore it in the selected destination folder before retrying.');
      }
      return copy;
    }
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}`;
    const response = await this.request(`${url}?fields=mimeType,parents,trashed&supportsAllDrives=true`);
    const metadata = await response.json() as { mimeType: string; parents?: string[]; trashed?: boolean };
    if (metadata.trashed || metadata.mimeType !== pdfMimeType) throw new Error('The selected scan is no longer an available PDF.');
    if (!metadata.parents?.includes(sourceFolderId)) throw new Error('The scan is no longer in the input folder. Refresh the file list.');
    const siblings = await this.listFolderPdfs(destinationFolderId);
    if (siblings.some(file => file.name.normalize('NFC').toLocaleLowerCase() === name.normalize('NFC').toLocaleLowerCase())) {
      throw new Error('A scan with this filename already exists in the destination folder.');
    }
    const copied = await this.request(`${url}/copy?supportsAllDrives=true&fields=id,name,mimeType`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: copyId, name, parents: [destinationFolderId] }),
    });
    return await copied.json() as DriveItem;
  }

  async renameExam(item: DriveItem, folderId: string, name: string): Promise<void> {
    // Recheck for collisions just before writing. Drive allows duplicate names.
    const siblings = await this.listFolderPdfs(folderId);
    if (!siblings.some(file => file.id === item.id)) throw new Error('This exam is no longer in the selected folder. Reload the folder.');
    if (siblings.some(file => file.id !== item.id && file.name.normalize('NFC').toLocaleLowerCase() === name.normalize('NFC').toLocaleLowerCase())) {
      throw new Error(`Another exam is already named “${name}”. Choose a different student or resolve the duplicate in Drive.`);
    }
    if (siblings.find(file => file.id === item.id)!.name === name) return; // Safe retry after a lost response.
    await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?supportsAllDrives=true&fields=id,name`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
  }

  async verifyFolder(item: DriveItem): Promise<void> {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?fields=mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`);
    const info = await response.json() as { mimeType: string; trashed?: boolean; capabilities?: { canAddChildren?: boolean } };
    if (info.mimeType !== folderMimeType || info.trashed || !info.capabilities?.canAddChildren) {
      throw new Error('You cannot add files to this folder. Choose a writable output folder.');
    }
  }

  async getParentFolder(item: DriveItem, requireFolder = true): Promise<DriveItem> {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?fields=parents,mimeType,trashed&supportsAllDrives=true`);
    const info = await response.json() as { parents?: string[]; mimeType?: string; trashed?: boolean };
    if (info.trashed || (requireFolder && info.mimeType !== folderMimeType) || info.parents?.length !== 1) {
      throw new Error(requireFolder ? 'Choose an exam folder inside a Test folder so 04_Previews can be created beside it.' : 'The selected PDF has no accessible parent folder. Choose another PDF.');
    }
    const parentResponse = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(info.parents[0])}?fields=id,name,mimeType,trashed&supportsAllDrives=true`);
    const parent = await parentResponse.json() as DriveItem & { trashed?: boolean };
    if (parent.trashed || parent.mimeType !== folderMimeType) throw new Error('The parent folder is no longer available. Choose the file or folder again.');
    return parent;
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

  async readTextFile(item: DriveItem, signal?: AbortSignal): Promise<string> {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?alt=media&supportsAllDrives=true`, { signal });
    return response.text();
  }

  async saveJsonFile(id: string, name: string, folderId: string, content: string): Promise<DriveItem> {
    const existing = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true`, {}, [404]);
    const params = 'supportsAllDrives=true&fields=id,name,mimeType';
    if (existing.ok) {
      const item = await existing.json() as DriveItem & { parents?: string[]; trashed?: boolean };
      if (item.trashed || item.mimeType === folderMimeType || item.name !== name || !item.parents?.includes(folderId)) throw new Error('The results file was moved, renamed, or deleted. Restore it in the course directory before retrying.');
      const response = await this.request(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&${params}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: content,
      });
      return await response.json() as DriveItem;
    }
    const boundary = `edu-results-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ id, name, mimeType: 'application/json', parents: [folderId] });
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--\r\n`]);
    const response = await this.request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&${params}`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
    return await response.json() as DriveItem;
  }

  private clearToken(): void {
    this.token = null;
    try { sessionStorage.removeItem(tokenStorageKey); } catch { /* Storage may be disabled. */ }
    this.callbacks?.onConnection(false);
  }

  private async request(url: string, init: RequestInit = {}, allowedStatuses: number[] = []): Promise<Response> {
    const service = url.startsWith('https://gmail.googleapis.com/') ? 'Gmail' : 'Google Drive';
    if (!this.connected) {
      this.clearToken();
      throw new GoogleHttpError('Your Google session expired. Connect Google in the header again, then retry.', 401);
    }
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token!.accessToken}`);
    let response: Response;
    try { response = await fetch(url, { ...init, headers }); }
    catch (error) {
      if (init.signal?.aborted) throw error;
      throw new Error(`Could not reach ${service}. Check your connection and retry.`);
    }
    if (response.ok || allowedStatuses.includes(response.status)) return response;
    if (response.status === 401) {
      this.clearToken();
      throw new GoogleHttpError('Your Google session expired. Connect Google in the header again, then retry.', 401);
    }
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new GoogleHttpError(`${service} (${response.status}): ${detail?.error?.message || response.statusText || 'Request failed. Please retry.'}`, response.status);
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
