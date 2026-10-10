import { describe, expect, it, vi } from 'vitest';
import { folderMimeType, pdfMimeType } from '../src/config';
import { ImportJob, nextTestFolderName, scanFilename, topicSlug, type ImportInput } from '../src/preparation';
import { TestCreationJob, FolderJob, missingCourseFolders } from '../src/testStructure';
import type { GoogleDrive } from '../src/googleDrive';
import type { DriveItem } from '../src/types';

const folder = (id: string, name = id): DriveItem => ({ id, name, mimeType: folderMimeType });
const course = folder('course', '8a');
const input: ImportInput = { destination: '01_Scans', inputFolder: folder('input'), test: folder('test', 'LZKs / 01_Zahlen-Konvertieren-Dezimal-Dual'),
  scan: { id: 'scan', name: 'scanner.pdf', mimeType: pdfMimeType }, course: '8a', subject: 'Informatik',
  type: 'LZK', topic: 'Zahlen Konvertieren Dezimal Dual', date: '2026-10-03' };

function fakeDrive() {
  const items = new Map<string, DriveItem>([['course', course], ['test', input.test], ['input', input.inputFolder], ['scan', input.scan]]);
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

describe('test setup and scan import', () => {
  async function setup(drive: GoogleDrive) {
    const job = new FolderJob();
    for (const name of ['LZKs', 'Klausuren']) await job.ensure(drive, course, name);
  }
  it('checks missing course folders without writing anything', async () => {
    const { api, drive } = fakeDrive();
    expect(await missingCourseFolders(drive, course)).toEqual(['LZKs', 'Klausuren']);
    expect(api.createFolder).not.toHaveBeenCalled();
    await setup(drive);
    expect(await missingCourseFolders(drive, course)).toEqual([]);
  });
  it('creates the test and its subfolders independently of scan import', async () => {
    const { api, drive, items, parents } = fakeDrive();
    await setup(drive);
    const test = await new TestCreationJob(course, 'LZK', input.topic).run(drive);
    expect(test.name).toBe('LZKs / 01_Zahlen-Konvertieren-Dezimal-Dual');
    expect([...items.values()].filter(item => parents.get(item.id) === test.id).map(item => item.name)).toEqual(['01_Scans', '02_Korrigiert', '03_Split', '04_Previews']);
    expect(api.copyScan).not.toHaveBeenCalled();
  });
  it('numbers Klausuren independently and leaves existing folders alone', async () => {
    const { drive, items, parents } = fakeDrive();
    for (const item of [folder('lzk', 'LZKs'), folder('ka', 'Klausuren')]) { items.set(item.id, item); parents.set(item.id, 'course'); }
    items.set('old', folder('old', '03_Old')); parents.set('old', 'ka');
    items.set('lzk-old', folder('lzk-old', '99_Old')); parents.set('lzk-old', 'lzk');
    const test = await new TestCreationJob(course, 'Klausur', input.topic).run(drive);
    expect(test.name).toBe('Klausuren / 04_Zahlen-Konvertieren-Dezimal-Dual');
    expect(parents.get(test.id)).toBe('ka');
  });
  it('resumes creation using the same IDs after a lost response', async () => {
    const { api, drive, items } = fakeDrive();
    await setup(drive);
    const create = api.createFolder.getMockImplementation()!;
    let lost = false;
    api.createFolder.mockImplementation(async (id, name, parent) => {
      const result = await create(id, name, parent);
      if (name === '01_Scans' && !lost) { lost = true; throw new Error('Lost response'); }
      return result;
    });
    const job = new TestCreationJob(course, 'LZK', input.topic);
    await expect(job.run(drive)).rejects.toThrow('Lost response');
    await job.run(drive);
    expect([...items.values()].filter(item => item.name === '01_Scans')).toHaveLength(1);
    expect([...items.values()].filter(item => /^\d+_Zahlen/.test(item.name))).toHaveLength(1);
  });
  it('rejects ambiguous category names without creating folders', async () => {
    const { api, drive, items, parents } = fakeDrive();
    for (const id of ['one', 'two']) { items.set(id, folder(id, 'LZKs')); parents.set(id, 'course'); }
    await expect(missingCourseFolders(drive, course)).rejects.toThrow('duplicate');
    await expect(new TestCreationJob(course, 'LZK', input.topic).run(drive)).rejects.toThrow('duplicate');
    expect(api.createFolder).not.toHaveBeenCalled();
  });
  it('does not implicitly create a missing course category', async () => {
    const { api, drive } = fakeDrive();
    await expect(new TestCreationJob(course, 'LZK', input.topic).run(drive)).rejects.toThrow('Set up LZKs');
    expect(api.createFolder).not.toHaveBeenCalled();
  });
  it.each(['01_Scans', '02_Korrigiert'] as const)('imports into %s in the selected test and preserves the original', async destination => {
    const { api, drive, items, parents } = fakeDrive();
    const result = await new ImportJob({ ...input, destination }).run(drive);
    const scans = [...items.values()].find(item => item.name === destination)!;
    expect(parents.get(scans.id)).toBe('test');
    expect(parents.get(result.id)).toBe(scans.id);
    expect(result.name).toBe('20261003_LZK-IF8a-Zahlen-Konvertieren-Dezimal-Dual.pdf');
    expect(items.get('scan')!.name).toBe('scanner.pdf');
    expect(parents.get('scan')).toBe('input');
    expect(api.createFolder.mock.calls.map(call => call[1])).toEqual([destination]);
  });
  it.each(['01_Scans', '02_Korrigiert'] as const)('retains the copy ID and %s destination across retries', async destination => {
    const { api, drive } = fakeDrive();
    const copy = api.copyScan.getMockImplementation()!;
    api.copyScan.mockImplementationOnce(async (...args) => { await copy(...args); throw new Error('Lost copy response'); });
    const selection = { ...input, destination };
    const job = new ImportJob(selection);
    selection.destination = destination === '01_Scans' ? '02_Korrigiert' : '01_Scans';
    await expect(job.run(drive)).rejects.toThrow('Lost copy response');
    const result = await job.run(drive);
    expect(api.copyScan.mock.calls[0][4]).toBe(api.copyScan.mock.calls[1][4]);
    expect(result.id).toBe(api.copyScan.mock.calls[0][4]);
    expect(job.input.destination).toBe(destination);
    expect(api.copyScan.mock.calls[0][2]).toBe(api.copyScan.mock.calls[1][2]);
  });
  it('checks source membership before creating scan folders', async () => {
    const { api, drive, parents } = fakeDrive(); parents.set('scan', 'elsewhere');
    await expect(new ImportJob(input).run(drive)).rejects.toThrow('no longer');
    expect(api.createFolder).not.toHaveBeenCalled();
  });
});
