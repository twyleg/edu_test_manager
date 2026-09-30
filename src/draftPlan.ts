import type { DriveItem } from './types';
import type { Student } from './students';
import { expandTemplate, validEmail } from './email';

export interface DraftRow {
  file: DriveItem;
  student?: Student;
  issue?: string;
  included: boolean;
  subject?: string;
  body?: string;
  messageId?: string;
  draftId?: string;
  uncertain?: boolean;
  error?: string;
}
export function planDrafts(files: DriveItem[], students: Student[]): DraftRow[] {
  return files.map(file => {
    const name = file.name.normalize('NFC');
    const student = students.find(student => student.filename.normalize('NFC') === name);
    const duplicate = files.filter(other => other.name.normalize('NFC') === name).length > 1;
    const issue = !student ? 'Filename does not match a student in this CSV.' : duplicate ? 'Duplicate PDF filename in this folder. Resolve it before creating drafts.' : !validEmail(student.email) ? 'Student email is missing or invalid.' : undefined;
    return { file, student, issue, included: !issue };
  });
}
export function subjectPrefix(tags: string): string {
  const values = tags.split(',').map(tag => tag.trim()).filter(Boolean);
  if (values.some(tag => /[\r\n\u0000\[\]]/.test(tag))) throw new Error('Enter subject tags separated by commas, without brackets or line breaks.');
  return values.length ? values.map(tag => `[${tag}]`).join(' ') + ' ' : '';
}
export function prepareDraftRows(rows: DraftRow[], subject: string, body: string, tags: string): void {
  const prefix = subjectPrefix(tags);
  const prepared = rows.filter(row => row.included).map(row => {
    if (row.issue || !row.student) throw new Error('Choose only files with a valid student and email address.');
    const expanded = prefix + expandTemplate(subject, row.student);
    if (!expanded.trim() || /[\r\n\u0000]/.test(expanded)) throw new Error('Each email subject must be non-empty and contain no line breaks.');
    return { row, subject: expanded, body: expandTemplate(body, row.student) };
  });
  if (!prepared.length) throw new Error('Select at least one exam.');
  for (const entry of prepared) { entry.row.subject = entry.subject; entry.row.body = entry.body; }
}
