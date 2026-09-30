import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleDrive } from '../src/googleDrive';

vi.mock('../src/config', () => ({
  driveScope: 'https://www.googleapis.com/auth/drive.file',
  googleConfig: {}, hasGoogleConfig: () => false,
  pdfMimeType: 'application/pdf', folderMimeType: 'application/vnd.google-apps.folder',
}));

function authorizedDrive(): GoogleDrive {
  const drive = new GoogleDrive();
  // Isolate the HTTP contract from the externally hosted OAuth UI.
  Object.assign(drive, { token: { accessToken: 'test-token', expiresAt: Date.now() + 60000 } });
  return drive;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Drive uploads', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

  it('uploads a PDF with its pre-generated ID and chosen parent folder', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(new Response('', { headers: { Location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(json({ id: 'stable-id' }));
    const blob = new Blob(['pdf-bytes'], { type: 'application/pdf' });
    await authorizedDrive().uploadPdf('stable-id', 'exam.pdf', 'chosen-folder', blob);
    const sessionRequest = fetchMock.mock.calls[1][1]!;
    expect(JSON.parse(sessionRequest.body as string)).toEqual({
      id: 'stable-id', name: 'exam.pdf', mimeType: 'application/pdf', parents: ['chosen-folder'],
    });
    expect(new Headers(sessionRequest.headers).get('Authorization')).toBe('Bearer test-token');
    expect(fetchMock.mock.calls[2][1]?.body).toBe(blob);
    expect(fetchMock.mock.calls[2][1]?.method).toBe('PUT');
  });

  it('does not create a duplicate when retrying after a lost upload response', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'already-created' }));
    await authorizedDrive().uploadPdf('already-created', 'exam.pdf', 'folder', new Blob());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/files/already-created?');
  });

  it('preserves a failed upload as retryable', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(new Response('', { headers: { Location: 'https://www.googleapis.com/upload/session' } }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(authorizedDrive().uploadPdf('stable-id', 'exam.pdf', 'folder', new Blob())).rejects.toThrow('Check your connection and retry');
  });

  it('invalidates rejected tokens and asks for reconnection', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 401));
    const drive = authorizedDrive();
    await expect(drive.generateFileId()).rejects.toThrow('session expired');
    expect(drive.connected).toBe(false);
  });

  it('rejects read-only folders before uploading', async () => {
    fetchMock.mockResolvedValueOnce(json({ mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: false } }));
    await expect(authorizedDrive().verifyFolder({ id: 'folder', name: 'Read only', mimeType: 'application/vnd.google-apps.folder' })).rejects.toThrow('writable output folder');
  });

  it('reports permission and quota errors from Drive', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: 'Storage quota exceeded' } }, 403));
    await expect(authorizedDrive().generateFileId()).rejects.toThrow('Google Drive (403): Storage quota exceeded');
  });
});

describe('Drive download progress', () => {
  const item = { id: 'source', name: 'exam.pdf', mimeType: 'application/pdf' };
  beforeEach(() => { vi.spyOn(performance, 'now').mockImplementation((() => { let now = 0; return () => now += 150; })()); });

  it.each([true, false])('streams exact bytes with known size: %s', async known => {
    let index = 0;
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close();
    } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(known ? { size: '5' } : {})).mockResolvedValueOnce(new Response(stream)));
    const progress = vi.fn();
    const bytes = await authorizedDrive().downloadPdf(item, new AbortController().signal, progress);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(progress).toHaveBeenCalledWith(2, known ? 5 : undefined);
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });

  it('cancels a pending streamed download without returning partial PDF bytes', async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); }, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({})).mockResolvedValueOnce(new Response(stream)));
    const download = authorizedDrive().downloadPdf(item, controller.signal, received => { if (received) controller.abort(); });
    await expect(download).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('reports interrupted downloads as retryable failures', async () => {
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) {
      if (!reads++) c.enqueue(new Uint8Array([1])); else c.error(new Error('Connection lost'));
    } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({})).mockResolvedValueOnce(new Response(stream)));
    await expect(authorizedDrive().downloadPdf(item, new AbortController().signal)).rejects.toThrow('PDF download failed. Check your connection and retry.');
  });
});
