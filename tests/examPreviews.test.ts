import { describe, expect, it, vi } from 'vitest';
import { ExamPreviewExport, examPreviewFilename } from '../src/examPreviews';
import { folderMimeType, pdfMimeType } from '../src/config';
import type { GoogleDrive } from '../src/googleDrive';
import type { DriveItem } from '../src/types';

const folder: DriveItem = { id: 'split', name: '03_Split', mimeType: folderMimeType };
const parent: DriveItem = { id: 'test', name: '01_Test', mimeType: folderMimeType };
const exams: DriveItem[] = [
  { id: 'anna', name: '01_Müller_Anna.pdf', mimeType: pdfMimeType },
  { id: 'lukas', name: '02_Schmidt_Lukas.pdf', mimeType: pdfMimeType },
];
function mockDrive() {
  let serial = 0;
  const siblings: DriveItem[] = [];
  const saved = new Map<string, DriveItem>();
  const api = {
    listFolderPdfs: vi.fn(async (id: string) =>
      id === folder.id ? exams.map((exam) => ({ ...exam })) : [...saved.values()],
    ),
    getParentFolder: vi.fn(async () => parent),
    listFolderItems: vi.fn(async () => siblings),
    generateFileId: vi.fn(async () => `id-${++serial}`),
    createFolder: vi.fn(async (id: string, name: string, parentId: string) => {
      expect(parentId).toBe(parent.id);
      const result = siblings.find((item) => item.id === id) || {
        id,
        name,
        mimeType: folderMimeType,
      };
      if (!siblings.includes(result)) {
        siblings.push(result);
      }
      return result;
    }),
    verifyFolder: vi.fn(async () => {}),
    uploadPdf: vi.fn(async (id: string, name: string, folderId: string, _blob: Blob) => {
      expect(folderId).toBe(siblings[0].id);
      saved.set(id, { id, name, mimeType: pdfMimeType });
    }),
  };
  const create = vi.fn(async (_exam: DriveItem) => new Blob(['preview'], { type: pdfMimeType }));
  return { api, drive: api as unknown as GoogleDrive, siblings, saved, create };
}

describe('exam preview exports', () => {
  it('preserves the exact student filename for draft matching', () => {
    expect(examPreviewFilename('01_Müller_Anna.pdf')).toBe('01_Müller_Anna.pdf');
    expect(examPreviewFilename('02_Schmidt_Lukas.PDF')).toBe('02_Schmidt_Lukas.PDF');
    expect(() => examPreviewFilename('not-a-pdf')).toThrow('PDF filename');
  });
  it('creates 04_Previews beside the exam folder and saves every matched exam', async () => {
    const { api, drive, siblings, saved, create } = mockDrive();
    const job = new ExamPreviewExport(folder, exams);
    const progress = vi.fn();
    await job.run(drive, create, progress);
    expect(api.getParentFolder).toHaveBeenCalledWith(folder);
    expect(siblings).toEqual([{ id: 'id-1', name: '04_Previews', mimeType: folderMimeType }]);
    expect([...saved.values()].map((file) => file.name)).toEqual([
      '01_Müller_Anna.pdf',
      '02_Schmidt_Lukas.pdf',
    ]);
    expect(create.mock.calls.map((args) => args[0])).toEqual(exams);
    expect(progress).toHaveBeenLastCalledWith(
      'All 2 exam previews are available in 04_Previews.',
      2,
      2,
    );
    expect(job.complete).toBe(true);
  });
  it('reuses the prepared folder and keeps existing preview files without rendering or uploading them', async () => {
    const { api, drive, siblings, saved, create } = mockDrive();
    siblings.push({ id: 'prepared', name: '04_Previews', mimeType: folderMimeType });
    saved.set('existing', { id: 'existing', name: '01_Müller_Anna.pdf', mimeType: pdfMimeType });
    const job = new ExamPreviewExport(folder, exams);
    await job.run(drive, create, vi.fn());
    expect(create).toHaveBeenCalledTimes(1);
    expect(api.uploadPdf).toHaveBeenCalledTimes(1);
    expect(job.rows[0]).toMatchObject({ id: 'existing', saved: true, existing: true });
    expect(saved.size).toBe(2);
    expect(siblings).toHaveLength(1);
  });
  it('recovers a lost upload response without uploading another copy', async () => {
    const { api, drive, saved, create } = mockDrive();
    const upload = api.uploadPdf.getMockImplementation()!;
    api.uploadPdf.mockImplementation(async (...args) => {
      await upload(...args);
      if (args[1].startsWith('02_')) {
        throw new Error('Lost response');
      }
    });
    const job = new ExamPreviewExport(folder, exams);
    await expect(job.run(drive, create, vi.fn())).rejects.toThrow('Lost response');
    expect(job.savedCount).toBe(1);
    await job.run(drive, create, vi.fn());
    expect(job.complete).toBe(true);
    expect(saved.size).toBe(2);
    expect(api.uploadPdf).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('retries a failed upload using the same ID and leaves completed uploads alone', async () => {
    const { api, drive, create } = mockDrive();
    const upload = api.uploadPdf.getMockImplementation()!;
    let fail = true;
    api.uploadPdf.mockImplementation(async (...args) => {
      if (args[1].startsWith('02_') && fail) {
        fail = false;
        throw new Error('Upload failed');
      }
      await upload(...args);
    });
    const job = new ExamPreviewExport(folder, exams);
    await expect(job.run(drive, create, vi.fn())).rejects.toThrow('Upload failed');
    await job.run(drive, create, vi.fn());
    expect(api.uploadPdf.mock.calls.map((args) => args[0])).toEqual(['id-2', 'id-3', 'id-3']);
    expect(job.complete).toBe(true);
  });
  it('reuses the folder ID after a lost folder-creation response', async () => {
    const { api, drive, siblings, create } = mockDrive();
    const createFolder = api.createFolder.getMockImplementation()!;
    api.createFolder.mockImplementationOnce(async (...args) => {
      await createFolder(...args);
      throw new Error('Lost folder response');
    });
    const job = new ExamPreviewExport(folder, exams);
    await expect(job.run(drive, create, vi.fn())).rejects.toThrow('Lost folder response');
    await job.run(drive, create, vi.fn());
    expect(siblings).toHaveLength(1);
    expect(api.createFolder.mock.calls.map((args) => args[0])).toEqual(['id-1', 'id-1']);
  });
  it('rejects duplicate output names before any upload', async () => {
    const { api, drive, saved, create } = mockDrive();
    for (const id of ['a', 'b']) {
      saved.set(id, { id, name: '01_Müller_Anna.pdf', mimeType: pdfMimeType });
    }
    await expect(new ExamPreviewExport(folder, exams).run(drive, create, vi.fn())).rejects.toThrow(
      'Multiple previews',
    );
    expect(api.uploadPdf).not.toHaveBeenCalled();
  });
  it('rejects ambiguous preview folders', async () => {
    const { api, drive, siblings, create } = mockDrive();
    for (const id of ['a', 'b']) {
      siblings.push({ id, name: '04_Previews', mimeType: folderMimeType });
    }
    await expect(new ExamPreviewExport(folder, exams).run(drive, create, vi.fn())).rejects.toThrow(
      'duplicate folders',
    );
    expect(api.createFolder).not.toHaveBeenCalled();
    expect(api.uploadPdf).not.toHaveBeenCalled();
  });
  it('rejects exams renamed or moved since matching before creating folders', async () => {
    const { api, drive, create } = mockDrive();
    api.listFolderPdfs.mockResolvedValueOnce([{ ...exams[0], name: 'changed.pdf' }]);
    await expect(new ExamPreviewExport(folder, exams).run(drive, create, vi.fn())).rejects.toThrow(
      'renamed or moved',
    );
    expect(api.createFolder).not.toHaveBeenCalled();
  });
  it('rejects duplicate student filenames and an empty batch', () => {
    expect(
      () => new ExamPreviewExport(folder, [exams[0], { ...exams[1], name: exams[0].name }]),
    ).toThrow('same preview filename');
    expect(() => new ExamPreviewExport(folder, [])).toThrow('at least one');
  });
  it('uses a selected output folder and keeps it fixed across retries', async () => {
    const { api, drive, create } = mockDrive();
    const destination = { id: 'custom-output', name: 'Custom previews', mimeType: folderMimeType };
    const saved = new Map<string, DriveItem>();
    api.listFolderPdfs.mockImplementation(async (id) =>
      id === folder.id ? exams : [...saved.values()],
    );
    let fail = true;
    api.uploadPdf.mockImplementation(async (id, name, folderId) => {
      expect(folderId).toBe('custom-output');
      if (name.startsWith('02_') && fail) {
        fail = false;
        throw new Error('Upload failed');
      }
      saved.set(id, { id, name, mimeType: pdfMimeType });
    });
    const job = new ExamPreviewExport(folder, exams, destination);
    destination.id = 'changed-after-start';
    await expect(job.run(drive, create, vi.fn())).rejects.toThrow('Upload failed');
    const progress = vi.fn();
    await job.run(drive, create, progress);
    expect(job.complete).toBe(true);
    expect(api.getParentFolder).not.toHaveBeenCalled();
    expect(api.createFolder).not.toHaveBeenCalled();
    expect(api.uploadPdf.mock.calls.map((args) => args[0])).toEqual(['id-1', 'id-2', 'id-2']);
    expect(progress).toHaveBeenLastCalledWith(
      'All 2 exam previews are available in Custom previews.',
      2,
      2,
    );
  });
  it('creates missing previews in the current test when the exam input is overridden', async () => {
    const { api, drive, create } = mockDrive();
    await new ExamPreviewExport(folder, exams, undefined, parent).run(drive, create, vi.fn());
    expect(api.getParentFolder).not.toHaveBeenCalled();
    expect(api.createFolder).toHaveBeenCalledWith('id-1', '04_Previews', parent.id);
  });
  it('rejects the exam folder as the preview output', () => {
    expect(() => new ExamPreviewExport(folder, exams, folder)).toThrow('different folders');
  });
});
