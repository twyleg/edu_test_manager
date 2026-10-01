import { describe, expect, it } from 'vitest';
import { buildDraftMime, encodeDraft, expandTemplate, validEmail } from '../src/email';
import { parseStudents } from '../src/students';
import { planDrafts, prepareDraftRows } from '../src/draftPlan';

const students = parseStudents('Nr.;Nachname;Vorname;E-Mail-Adresse;Klasse\n1;Müller;Anna;anna@example.org;8A\n2;Schmidt;Lukas;;8A');
const student = students[0];
describe('draft templates and file matching', () => {
  it('expands CSV columns without evaluating substituted text', () => {
    expect(expandTemplate('Hallo {{ Vorname }} aus {{Klasse}} / {{Nr.}}', student)).toBe('Hallo Anna aus 8A / 1');
    expect(expandTemplate('{{Vorname}}', { ...student, firstName: '{{Nachname}}' })).toBe('{{Nachname}}');
    expect(() => expandTemplate('{{NotAColumn}}', student)).toThrow('Unknown placeholder');
    expect(() => expandTemplate('{{Vorname}', student)).toThrow('Incomplete');
  });
  it('blocks unmatched filenames, duplicates and missing emails', () => {
    const rows = planDrafts(['01_Müller_Anna.pdf', '01_Müller_Anna.pdf', '02_Schmidt_Lukas.pdf', 'unmatched.pdf'].map((name, i) => ({ id: String(i), name, mimeType: 'application/pdf' })), students);
    expect(rows.every(row => !row.included)).toBe(true);
    expect(rows[0].issue).toContain('Duplicate');
    expect(rows[2].issue).toContain('email');
    expect(rows[3].issue).toContain('Filename');
  });
  it('prepares subjects and rejects subject header injection', () => {
    const rows = planDrafts([{ id: '1', name: student.filename, mimeType: 'application/pdf' }], students);
    prepareDraftRows(rows, 'Test für {{Vorname}}', 'Hallo {{Vorname}}');
    expect(rows[0].subject).toBe('Test für Anna');
    expect(() => prepareDraftRows(rows, 'Hello\r\nBcc: other@example.org', '')).toThrow('line breaks');
  });
});

describe('MIME PDF attachments', () => {
  it('roundtrips recipient, Unicode subject, body and the exact PDF bytes', () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 0, 255, 128, 10]);
    const mime = buildDraftMime({ from: 'teacher@example.org', to: student.email, subject: '[8A] Prüfung für Anna', body: 'Hallo Anna,\nGrüße!', filename: student.filename, bytes, messageId: 'test-id@edu-test-manager.invalid' });
    expect(Buffer.from(encodeDraft(mime), 'base64url').toString('utf8')).toBe(mime);
    expect(mime).toContain('To: anna@example.org\r\n');
    expect(mime).toContain('Content-Disposition: attachment;');
    expect(mime).not.toMatch(/\r\n(?:Cc|Bcc):/);
    const boundary = mime.match(/boundary="([^"]+)"/)![1];
    const parts = mime.split(`--${boundary}`);
    expect(Buffer.from(parts[1].split('\r\n\r\n')[1].trim(), 'base64').toString('utf8')).toBe('Hallo Anna,\nGrüße!');
    expect(new Uint8Array(Buffer.from(parts[2].split('\r\n\r\n')[1].trim(), 'base64'))).toEqual(bytes);
    const filename = [...parts[2].matchAll(/filename\*\d+\*=([^;\r\n]+)/g)].map(match => match[1]).join('').replace(/^UTF-8''/, '');
    expect(decodeURIComponent(filename)).toBe(student.filename);
  });
  it('does not allow multiple recipients or injected recipient headers', () => {
    expect(validEmail('anna@example.org')).toBe(true);
    expect(validEmail('anna@example.org,bob@example.org')).toBe(false);
    expect(validEmail('anna@example.org\r\nBcc: bob@example.org')).toBe(false);
  });
});

 it('limits the combined attachments and sanitizes attachment MIME headers', () => {
   const content = { from: 'teacher@example.org', to: 'student@example.org', subject: 'Exam', body: '', filename: 'exam.pdf', bytes: new Uint8Array([1]), messageId: 'test@edu-test-manager.invalid' };
   expect(() => buildDraftMime({ ...content, extraAttachments: [{ filename: 'large.bin', mimeType: '', bytes: new Uint8Array(25_000_000) }] })).toThrow('Combined attachments');
   const mime = buildDraftMime({ ...content, extraAttachments: [{ filename: 'file.bin', mimeType: 'text/plain\r\nBcc: injected@example.org', bytes: new Uint8Array([255]) }] });
   expect(mime).toContain('Content-Type: application/octet-stream');
   expect(mime).not.toContain('Bcc:');
 });
