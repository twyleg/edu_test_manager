import type { Student } from './students';

export function expandTemplate(template: string, student: Student): string {
  const fields: Record<string, string> = { ...student.fields, 'Nr.': student.number, Nr: student.number, Nachname: student.lastName, Vorname: student.firstName, 'E-Mail-Adresse': student.email };
  const result = template.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key: string) => {
    if (!Object.hasOwn(fields, key)) throw new Error(`Unknown placeholder {{${key}}}. Use a column name from the student CSV.`);
    return fields[key];
  });
  // Validate template syntax, not substituted values, so a CSV value isn't interpreted as code.
  if (/{{|}}/.test(template.replace(/{{\s*([^{}]+?)\s*}}/g, ''))) throw new Error('Incomplete template placeholder. Use {{Vorname}}, for example.');
  return result;
}

export function validEmail(value: string): boolean {
  return value.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(value);
}

const utf8 = (text: string) => new TextEncoder().encode(text);
export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
const lines = (value: string) => value.match(/.{1,76}/g)?.join('\r\n') || '';
function encodedHeader(value: string): string {
  const chunks: string[] = [];
  let chunk = '';
  for (const character of value) {
    if (utf8(chunk + character).length > 42) { chunks.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(value => `=?UTF-8?B?${base64(utf8(value))}?=`).join('\r\n ');
}
export interface DraftContent { from: string; to: string; subject: string; body: string; filename: string; bytes: Uint8Array; messageId: string }
export function buildDraftMime(content: DraftContent): string {
  if (!validEmail(content.from) || !validEmail(content.to)) throw new Error('A valid sender and one student email address are required.');
  if (!content.subject.trim() || /[\r\n\u0000]/.test(content.subject)) throw new Error('The expanded subject must be a non-empty single line.');
  if (!/^[a-zA-Z0-9-]+@edu-test-manager\.invalid$/.test(content.messageId)) throw new Error('Invalid draft identifier.');
  if (content.bytes.length > 25_000_000) throw new Error('This PDF exceeds the 25 MB attachment limit.');
  if (!content.bytes.length) throw new Error('Cannot attach an empty PDF.');
  const boundary = `exam-${crypto.randomUUID()}`;
  const filename = encodeURIComponent(content.filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  // RFC 2231 continuation segments keep even long Unicode filenames within header limits.
  const segments = filename.match(/(?:%[0-9A-F]{2}|[^%]){1,18}/g) || ['exam.pdf'];
  return [
    `From: ${content.from}`, `To: ${content.to}`, `Subject: ${encodedHeader(content.subject)}`,
    `Message-ID: <${content.messageId}>`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', lines(base64(utf8(content.body))), '',
    `--${boundary}`, 'Content-Type: application/pdf', 'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment;',
    ...segments.map((segment, index) => ` filename*${index}*=${index === 0 ? "UTF-8''" : ''}${segment}${index < segments.length - 1 ? ';' : ''}`),
    '', lines(base64(content.bytes)), '', `--${boundary}--`, '',
  ].join('\r\n');
}
export const encodeDraft = (mime: string): string => base64(utf8(mime)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
