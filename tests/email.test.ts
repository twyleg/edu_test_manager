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
  it('prepares subject tags and rejects subject header injection', () => {
    const rows = planDrafts([{ id: '1', name: student.filename, mimeType: 'application/pdf' }], students);
    prepareDraftRows(rows, 'Test für {{Vorname}}', 'Hallo {{Vorname}}', '8A, Informatik');
    expect(rows[0].subject).toBe('[8A] [Informatik] Test für Anna');
    expect(() => prepareDraftRows(rows, 'Hello\r\nBcc: other@example.org', '', '')).toThrow('line breaks');
    expect(() => prepareDraftRows(rows, 'Hello', '', '8A\nBcc: other')).toThrow('tags');
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
