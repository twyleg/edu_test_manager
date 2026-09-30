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
