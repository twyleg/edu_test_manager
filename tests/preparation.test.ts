import { describe, expect, it, vi } from 'vitest';
import { folderMimeType, pdfMimeType } from '../src/config';
import { PreparationJob, nextTestFolderName, scanFilename, topicSlug, type PreparationInput } from '../src/preparation';
import type { GoogleDrive } from '../src/googleDrive';
import type { DriveItem } from '../src/types';

const folder = (id: string, name = id): DriveItem => ({ id, name, mimeType: folderMimeType });
const input: PreparationInput = { inputFolder: folder('input'), courseFolder: folder('course', '8a'),
  scan: { id: 'scan', name: 'scanner.pdf', mimeType: pdfMimeType }, course: '8a', subject: 'Informatik',
  type: 'LZK', topic: 'Zahlen Konvertieren Dezimal Dual', date: '2026-10-03' };

function fakeDrive() {
  const items = new Map<string, DriveItem>([['course', input.courseFolder], ['input', input.inputFolder], ['scan', input.scan]]);
  const parents = new Map<string, string>([['scan', 'input']]);
  let serial = 0;
  const api = {
    verifyFolder: vi.fn(async () => {}),
    listFolderItems: vi.fn(async (id: string) => [...items.values()].filter(item => parents.get(item.id) === id)),
    listFolderPdfs: vi.fn(async (id: string) => [...items.values()].filter(item => parents.get(item.id) === id && item.mimeType === pdfMimeType)),
    generateFileId: vi.fn(async () => `generated-${++serial}`),
    createFolder: vi.fn(async (id: string, name: string, parent: string) => {
      const existing = items.get(id);
      if (existing) return existing;
      const item = folder(id, name); items.set(id, item); parents.set(id, parent); return item;
    }),
    copyScan: vi.fn(async (scan: DriveItem, source: string, destination: string, name: string, copyId: string) => {
      const copy = { ...scan, id: copyId, name }; items.set(copyId, copy); parents.set(copyId, destination); return copy;
    }),
  };
  return { api, drive: api as unknown as GoogleDrive, items, parents };
}

describe('preparation names', () => {
  it.each([
    ['LZK', 'Informatik', 'LZK-IF8a'], ['LZK', 'Physik', 'LZK-PH8a'],
    ['Klausur', 'Informatik', 'KA-IF8a'], ['Klausur', 'Physik', 'KA-PH8a'],
  ] as const)('names %s / %s scans', (type, subject, code) => {
    expect(scanFilename({ ...input, type, subject })).toBe(`20261003_${code}-Zahlen-Konvertieren-Dezimal-Dual.pdf`);
  });
  it('normalizes repeated whitespace while preserving umlauts', () => {
    expect(topicSlug('  Kräfte\tund\nBewegung ')).toBe('Kräfte-und-Bewegung');
  });
  it('increments the highest folder index instead of counting entries or files', () => {
    const items = [folder('1', '01_One'), folder('2', '09_Nine'), folder('3', 'notes'), { id: '4', name: '99_file.pdf', mimeType: pdfMimeType }];
    expect(nextTestFolderName(items, 'New test')).toBe('10_New-test');
    expect(nextTestFolderName([], 'New test')).toBe('01_New-test');
    expect(nextTestFolderName([folder('100', '99_Last')], 'New')).toBe('100_New');
  });
  it.each([{ topic: ' ' }, { topic: 'a/b' }, { course: '8 a' }, { date: '2026-02-30' }, { date: '' }])('rejects invalid input %j', change => {
    expect(() => scanFilename({ ...input, ...change })).toThrow();
  });
});

describe('preparation workflow', () => {
  it('creates the full hierarchy and copies the original scan only after all folders exist', async () => {
    const { api, drive, items, parents } = fakeDrive();
    api.copyScan.mockImplementationOnce(async (scan, source, destination, name, copyId) => {
      expect([...items.values()].map(item => item.name)).toEqual(expect.arrayContaining(['LZKs', 'Klausuren', '01_Zahlen-Konvertieren-Dezimal-Dual', '01_Scans', '02_Korrigiert', '03_Split', '04_Previews']));
      expect(source).toBe('input'); const copy = { ...scan, id: copyId, name }; items.set(copyId, copy); parents.set(copyId, destination); return copy;
    });
    const result = await new PreparationJob(input).run(drive);
    expect(parents.get(result.previews.id)).toBe(result.test.id);
    expect(parents.get(result.test.id)).toBe([...items.values()].find(item => item.name === 'LZKs')!.id);
    expect(parents.get('scan')).toBe('input');
    expect(items.get('scan')!.name).toBe('scanner.pdf');
    expect(result.scan.id).not.toBe('scan');
    expect(parents.get(result.scan.id)).toBe(result.scans.id);
    expect(items.get(result.scan.id)!.name).toBe('20261003_LZK-IF8a-Zahlen-Konvertieren-Dezimal-Dual.pdf');
    expect(api.copyScan).toHaveBeenCalledTimes(1);
  });
  it('reuses existing type folders and numbers Klausuren independently', async () => {
    const { drive, items, parents } = fakeDrive();
    for (const item of [folder('lzk', 'LZKs'), folder('ka', 'Klausuren')]) { items.set(item.id, item); parents.set(item.id, 'course'); }
    items.set('old', folder('old', '03_Old')); parents.set('old', 'ka');
    items.set('lzk-old', folder('lzk-old', '99_Old')); parents.set('lzk-old', 'lzk');
    const result = await new PreparationJob({ ...input, type: 'Klausur' }).run(drive);
    expect(result.test.name).toBe('04_Zahlen-Konvertieren-Dezimal-Dual');
    expect(parents.get(result.test.id)).toBe('ka');
    expect([...items.values()].filter(item => item.name === 'LZKs')).toHaveLength(1);
  });
  it('resumes with the same folder IDs after a successful creation loses its response', async () => {
    const { api, drive, items } = fakeDrive();
    const create = api.createFolder.getMockImplementation()!;
    let lost = false;
    api.createFolder.mockImplementation(async (id, name, parent) => {
      const result = await create(id, name, parent);
      if (name === '01_Scans' && !lost) { lost = true; throw new Error('Lost response'); }
      return result;
    });
    const job = new PreparationJob(input);
    await expect(job.run(drive)).rejects.toThrow('Lost response');
    expect(api.copyScan).not.toHaveBeenCalled();
    const result = await job.run(drive);
    expect(result.test.name).toBe('01_Zahlen-Konvertieren-Dezimal-Dual');
    expect([...items.values()].filter(item => item.name === '01_Scans')).toHaveLength(1);
    expect([...items.values()].filter(item => /^\d+_Zahlen/.test(item.name))).toHaveLength(1);
  });
  it('leaves the scan alone when a required name is ambiguous', async () => {
    const { api, drive, items, parents } = fakeDrive();
    for (const id of ['one', 'two']) { items.set(id, folder(id, 'LZKs')); parents.set(id, 'course'); }
    await expect(new PreparationJob(input).run(drive)).rejects.toThrow('duplicate');
    expect(api.copyScan).not.toHaveBeenCalled();
    expect(api.createFolder).not.toHaveBeenCalled();
  });
  it('reuses the same copy ID when retrying an interrupted copy', async () => {
    const { api, drive } = fakeDrive();
    const copy = api.copyScan.getMockImplementation()!;
    api.copyScan.mockImplementationOnce(async (...args) => { await copy(...args); throw new Error('Lost copy response'); });
    const job = new PreparationJob(input);
    await expect(job.run(drive)).rejects.toThrow('Lost copy response');
    const result = await job.run(drive);
    expect(api.copyScan.mock.calls[0][4]).toBe(api.copyScan.mock.calls[1][4]);
    expect(result.scan.id).toBe(api.copyScan.mock.calls[0][4]);
  });
  it('checks source membership before creating folders', async () => {
    const { api, drive, parents } = fakeDrive(); parents.set('scan', 'elsewhere');
    await expect(new PreparationJob(input).run(drive)).rejects.toThrow('no longer');
    expect(api.createFolder).not.toHaveBeenCalled();
  });
});
