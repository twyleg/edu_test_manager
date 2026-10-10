import { describe, expect, it, vi } from 'vitest';
import { collectResults, documentationRows, normalizeResultKeys, parseResults, prettyResults, resultKey, ResultsStore } from '../src/results';
import { parseStudents } from '../src/students';
import type { GoogleDrive } from '../src/googleDrive';
import type { DriveItem } from '../src/types';

const students = parseStudents('Nr.;Nachname;Vorname;E-Mail-Adresse\n01;Müller;Anna;anna@example.org\n02;Schmidt;Ben;ben@example.org');
const files = students.map((student, index) => ({ id: String(index), name: student.filename, mimeType: 'application/pdf' }));
const course = { id: 'course', name: '8a', mimeType: 'application/vnd.google-apps.folder' };

describe('documented results', () => {
  it('matches student filenames, reports unassigned PDFs and preserves text grades', () => {
    const unmatched = { id: 'unknown', name: 'exam-3.pdf', mimeType: 'application/pdf' };
    const { rows, unmatched: ignored } = documentationRows([...files].reverse().concat(unmatched), students);
    expect(rows.map(row => row.student.firstName)).toEqual(['Anna', 'Ben']);
    expect(ignored).toEqual([unmatched]);
    Object.assign(rows[0], { points: ' 17,5 ', mark: ' 2+ ' });
    const result = collectResults(rows, { 'Other, Student': { points: '20', mark: '1' } });
    expect(result).toEqual({ 'Other, Student': { points: '20', mark: '1' }, 'Müller, Anna': { points: '17,5', mark: '2+' } });
    expect(prettyResults(result)).toContain('\n  "Müller, Anna": {\n    "points": "17,5",\n    "mark": "2+"\n  }');
    expect(prettyResults(result)).toMatch(/\n$/);
    expect(resultKey(students[0])).toBe('Müller, Anna');
  });
  it('collects points-only results for the first pass without changing the base', () => {
    const { rows } = documentationRows(files, students);
    rows[0].points = '17';
    const base = { 'Müller, Anna': { points: '12', mark: '4' } };
    expect(collectResults(rows, base)['Müller, Anna']).toEqual({ points: '17', mark: '' });
    expect(base['Müller, Anna'].points).toBe('12');
  });
  it('blocks duplicate names and duplicate matched PDFs rather than overwriting a student', () => {
    const duplicate = parseStudents('Nr.;Nachname;Vorname;E-Mail-Adresse\n01;Müller;Anna;a@b.org\n02;Müller;Anna;b@b.org');
    expect(() => documentationRows(files, duplicate)).toThrow('same surname and first name');
    expect(() => documentationRows([...files, files[0]], students)).toThrow('Multiple exams');
    expect(() => documentationRows([], students)).toThrow('Match students first');
  });
  it('reads numeric legacy values and handles object-like student keys safely', () => {
    const result = parseResults('\uFEFF{"Müller, Anna":{"points":17.5,"mark":2},"__proto__":{"points":"10","mark":"3"}}');
    expect(result['Müller, Anna']).toEqual({ points: '17.5', mark: '2' });
    expect(result['__proto__']).toEqual({ points: '10', mark: '3' });
    expect(Object.getPrototypeOf(result)).toBeNull();
  });
  it.each(['{', 'null', '[]', '{"A":{"points":1}}', '{"A":{"points":[],"mark":"2"}}'])('rejects malformed saved results: %s', text => {
    expect(() => parseResults(text)).toThrow('results.json');
  });
});

function driveMock() {
  let file: DriveItem | undefined;
  let text = '';
  const drive = {
    verifyFolder: vi.fn(async () => {}),
    listFolderItems: vi.fn(async () => file ? [file] : []),
    readTextFile: vi.fn(async () => text),
    generateFileId: vi.fn(async () => 'stable-results-id'),
    saveJsonFile: vi.fn(async (id: string, name: string, _parent: string, content: string) => {
      file = { id, name, mimeType: 'application/json' }; text = content; return file;
    }),
  };
  return { drive, api: drive as unknown as GoogleDrive, seed: (content: string) => { file = { id: 'existing', name: 'results.json', mimeType: 'application/json' }; text = content; } };
}

describe('course results storage', () => {
  it('updates the existing course file, retaining other students and freshly added entries', async () => {
    const mock = driveMock();
    mock.seed('{"Other, Student":{"points":"20","mark":"1"}}');
    const store = new ResultsStore(course);
    await store.read(mock.api);
    mock.seed('{"Other, Student":{"points":"20","mark":"1"},"New, Student":{"points":"10","mark":"3"}}');
    const result = await store.save(mock.api, { 'Müller, Anna': { points: '17,5', mark: '2+' } });
    expect(Object.keys(result)).toEqual(['Other, Student', 'New, Student', 'Müller, Anna']);
    expect(mock.drive.generateFileId).not.toHaveBeenCalled();
    expect(mock.drive.saveJsonFile).toHaveBeenCalledWith('existing', 'results.json', 'course', prettyResults(result));
  });
  it('keeps the generated ID after a lost creation response', async () => {
    const mock = driveMock();
    const save = mock.drive.saveJsonFile.getMockImplementation()!;
    mock.drive.saveJsonFile.mockImplementationOnce(async (...args) => { await save(...args); throw new Error('Lost response'); });
    const store = new ResultsStore(course);
    const changes = { 'Müller, Anna': { points: '17', mark: '2' } };
    await expect(store.save(mock.api, changes)).rejects.toThrow('Lost response');
    await store.save(mock.api, changes);
    expect(mock.drive.generateFileId).toHaveBeenCalledOnce();
    expect(mock.drive.saveJsonFile.mock.calls.map(call => call[0])).toEqual(['stable-results-id', 'stable-results-id']);
  });
  it('does not write over malformed or ambiguous course results', async () => {
    const mock = driveMock(); mock.seed('{broken');
    const store = new ResultsStore(course);
    await expect(store.save(mock.api, {})).rejects.toThrow('invalid JSON');
    mock.drive.listFolderItems.mockResolvedValueOnce([{ id: 'a', name: 'results.json', mimeType: 'application/json' }, { id: 'b', name: 'results.json', mimeType: 'application/json' }]);
    await expect(store.save(mock.api, {})).rejects.toThrow('duplicate results.json');
    expect(mock.drive.saveJsonFile).not.toHaveBeenCalled();
  });
});

describe('comma-separated student result keys', () => {
  it('migrates known old keys without guessing compound surnames or multiple first names', () => {
    const list = parseStudents('Nr.;Nachname;Vorname;E-Mail-Adresse\n01;von der Müller;Anna Maria;a@example.org');
    expect(resultKey(list[0])).toBe('von der Müller, Anna Maria');
    expect(normalizeResultKeys({ 'von der Müller Anna Maria': { points: '17', mark: '2+' }, 'Unknown Entry': { points: '9', mark: '4' } }, list)).toEqual({
      'von der Müller, Anna Maria': { points: '17', mark: '2+' }, 'Unknown Entry': { points: '9', mark: '4' },
    });
  });
  it('deduplicates identical entries and rejects conflicting old and new values', () => {
    const value = { points: '17', mark: '2' };
    expect(normalizeResultKeys({ 'Müller Anna': value, 'Müller, Anna': value }, students)).toEqual({ 'Müller, Anna': value });
    expect(() => normalizeResultKeys({ 'Müller Anna': value, 'Müller, Anna': { points: '15', mark: '3' } }, students)).toThrow('Conflicting entries');
  });
  it('rejects old keys that cannot distinguish different surname/firstname boundaries', () => {
    const list = parseStudents('Nr.;Nachname;Vorname;E-Mail-Adresse\n01;A B;C;a@example.org\n02;A;B C;b@example.org');
    expect(() => normalizeResultKeys({ 'A B C': { points: '17', mark: '2' } }, list)).toThrow('matches multiple students');
  });
  it('loads and updates legacy results without leaving duplicate student keys', async () => {
    const mock = driveMock(); mock.seed('{"Müller Anna":{"points":"12","mark":"4"}}');
    const store = new ResultsStore(course, students);
    expect(await store.read(mock.api)).toEqual({ 'Müller, Anna': { points: '12', mark: '4' } });
    const results = await store.save(mock.api, { 'Müller, Anna': { points: '17', mark: '' } });
    expect(results).toEqual({ 'Müller, Anna': { points: '17', mark: '' } });
    expect(mock.drive.saveJsonFile).toHaveBeenCalledWith('existing', 'results.json', 'course', prettyResults(results));
  });
});

it('keeps canonical names when a comma inside another surname resembles a legacy alias', () => {
  const list = parseStudents('Nr.;Nachname;Vorname;E-Mail-Adresse\n01;Müller;Meier Anna;a@example.org\n02;Müller, Meier;Anna;b@example.org');
  const base = { 'Müller, Meier Anna': { points: '17', mark: '2' }, 'Müller, Meier, Anna': { points: '10', mark: '3' } };
  expect(normalizeResultKeys(base, list)).toEqual(base);
});

it('saves an explicitly edited JSON document including removed entries', async () => {
  const mock = driveMock();
  mock.seed('{"Other, Student":{"points":"20","mark":"1"},"Müller, Anna":{"points":"12","mark":"4"}}');
  const store = new ResultsStore(course, students);
  const edited = { 'Müller, Anna': { points: '17,5', mark: '2+' }, 'New, Student': { points: '10', mark: '' } };
  expect(await store.save(mock.api, edited, true)).toEqual(edited);
  expect(mock.drive.saveJsonFile).toHaveBeenCalledWith('existing', 'results.json', 'course', prettyResults(edited));
  expect(await store.save(mock.api, {}, true)).toEqual({});
  expect(mock.drive.saveJsonFile).toHaveBeenLastCalledWith('existing', 'results.json', 'course', '{}\n');
});
