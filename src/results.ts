import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';
import type { Student } from './students';
import { folderMimeType } from './config';

export interface ExamResult {
  points: string;
  mark: string;
}
export type Results = Record<string, ExamResult>;
export interface DocumentationRow extends ExamResult {
  file: DriveItem;
  student: Student;
}
export const resultKey = (student: Student): string =>
  `${student.lastName}, ${student.firstName}`.normalize('NFC');
export const prettyResults = (results: Results): string => JSON.stringify(results, null, 2) + '\n';

function resultsEqual(left: ExamResult, right: ExamResult): boolean {
  return left.points === right.points && left.mark === right.mark;
}

function isResultValue(value: unknown): boolean {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/** Migrate names using the CSV, which preserves the boundary for compound surnames and first names. */
export function normalizeResultKeys(base: Results, students: Student[]): Results {
  const results: Results = Object.create(null);
  for (const [name, value] of Object.entries(base)) {
    const key = name.normalize('NFC');
    if (results[key] && !resultsEqual(results[key], value)) {
      throw new Error(
        `Conflicting entries for “${key}” in results.json. Resolve them before saving.`,
      );
    }
    results[key] = value;
  }

  const aliases = new Map<string, Set<string>>();
  const canonicalNames = new Set(students.map(resultKey));
  for (const student of students) {
    const legacyName = `${student.lastName} ${student.firstName}`.normalize('NFC');
    const names = aliases.get(legacyName) || new Set<string>();
    names.add(resultKey(student));
    aliases.set(legacyName, names);
  }

  for (const [legacyName, names] of aliases) {
    if (!results[legacyName] || canonicalNames.has(legacyName)) {
      continue;
    }
    if (names.size !== 1) {
      throw new Error(
        `The old result key “${legacyName}” matches multiple students. Resolve it in results.json before saving.`,
      );
    }
    const key = [...names][0];
    if (results[key] && !resultsEqual(results[key], results[legacyName])) {
      throw new Error(
        `Conflicting entries for “${key}” in results.json. Resolve them before saving.`,
      );
    }
    results[key] ??= results[legacyName];
    delete results[legacyName];
  }

  return results;
}

export function parseResults(text: string): Results {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('results.json contains invalid JSON. Repair it before saving results.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('results.json must contain an object keyed by student names.');
  }

  const results: Results = Object.create(null);
  for (const [name, value] of Object.entries(data)) {
    const row = value as Record<string, unknown> | null;
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      !isResultValue(row.points) ||
      !isResultValue(row.mark)
    ) {
      throw new Error(`The entry for “${name}” in results.json needs points and mark values.`);
    }
    results[name] = { points: String(row.points), mark: String(row.mark) };
  }

  return results;
}

export function documentationRows(
  files: DriveItem[],
  students: Student[],
): { rows: DocumentationRow[]; unmatched: DriveItem[] } {
  const keys = students.map(resultKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      'Two students have the same surname and first name. results.json cannot distinguish them; resolve the student names before documenting results.',
    );
  }
  const rows: DocumentationRow[] = [];
  const unmatched = files.filter(
    (file) =>
      !students.some((student) => student.filename.normalize('NFC') === file.name.normalize('NFC')),
  );
  for (const student of students) {
    const exams = files.filter(
      (file) => file.name.normalize('NFC') === student.filename.normalize('NFC'),
    );
    if (exams.length > 1) {
      throw new Error(
        `Multiple exams are named “${student.filename}”. Resolve duplicate PDFs before documenting results.`,
      );
    }
    if (exams[0]) {
      rows.push({ file: exams[0], student, points: '', mark: '' });
    }
  }
  if (!rows.length) {
    throw new Error('No exam filenames match the student list. Match students first.');
  }
  return { rows, unmatched };
}

export function collectResults(rows: DocumentationRow[], base: Results): Results {
  const results = normalizeResultKeys(
    base,
    rows.map((row) => row.student),
  );
  for (const row of rows) {
    const points = row.points.trim();
    const mark = row.mark.trim();
    if (!points && !mark) {
      continue;
    }
    results[resultKey(row.student)] = { points, mark };
  }
  return results;
}

/** A stable ID makes a new course file safe to retry after a lost creation response. */
export class ResultsStore {
  file?: DriveItem;
  private id?: string;

  constructor(
    private course: DriveItem,
    private students: Student[] = [],
  ) {}

  async read(drive: GoogleDrive, signal?: AbortSignal): Promise<Results> {
    const matches = (await drive.listFolderItems(this.course.id, undefined, signal)).filter(
      (item) => item.name === 'results.json',
    );
    if (matches.length > 1 || matches.some((item) => item.mimeType === folderMimeType)) {
      throw new Error(
        'Resolve duplicate results.json files or a folder named results.json in the course directory.',
      );
    }
    if (this.id && matches[0] && matches[0].id !== this.id) {
      throw new Error('The course results.json file changed. Reload results before saving again.');
    }
    this.file = matches[0];
    if (this.file) {
      this.id = this.file.id;
    }

    if (!this.file) {
      return Object.create(null);
    }

    const text = await drive.readTextFile(this.file, signal);
    return normalizeResultKeys(parseResults(text), this.students);
  }

  async save(drive: GoogleDrive, changes: Results, replace = false): Promise<Results> {
    await drive.verifyFolder(this.course);
    const current = await this.read(drive);
    const results: Results = replace
      ? normalizeResultKeys(changes, this.students)
      : Object.assign(Object.create(null), current, changes);

    this.id ??= await drive.generateFileId();
    this.file = await drive.saveJsonFile(
      this.id,
      'results.json',
      this.course.id,
      prettyResults(results),
    );

    return results;
  }
}
