export interface Student { id: string; number: string; lastName: string; firstName: string; email: string; filename: string; fields?: Record<string, string> }

/** Quoted CSV fields may contain delimiters, newlines, and escaped quotes. */
export function parseStudents(text: string): Student[] {
  text = text.replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (ch === delimiter || ch === '\n' || ch === '\r')) {
      row.push(field.trim()); field = '';
      if (ch !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (ch === '\r' && text[i + 1] === '\n') i++;
      }
    } else field += ch;
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  const originalHeaders = rows.shift() || [];
  const headers = originalHeaders.map(value => value.toLocaleLowerCase());
  const numberColumn = headers.findIndex(header => header === 'nr.' || header === 'nr');
  const last = headers.indexOf('nachname'), first = headers.indexOf('vorname'), email = headers.indexOf('e-mail-adresse');
  if (numberColumn < 0 || last < 0 || first < 0 || email < 0) throw new Error('CSV needs the columns Nr., Nachname, Vorname and E-Mail-Adresse.');
  const names = new Set<string>();
  const numbers = new Set<string>();
  const students = rows.map((row, i) => {
    const number = row[numberColumn] || '';
    if (!/^\d+$/.test(number)) throw new Error(`CSV row ${i + 2} needs a numeric Nr. value.`);
    const canonicalNumber = number.replace(/^0+(?=\d)/, '');
    if (numbers.has(canonicalNumber)) throw new Error(`Duplicate student number ${number} in the CSV.`);
    numbers.add(canonicalNumber);
    const lastName = row[last] || '', firstName = row[first] || '';
    if (!lastName || !firstName) throw new Error(`CSV row ${i + 2} has a missing first or last name.`);
    const clean = (value: string) => value.normalize('NFC').replace(/[\u0000-\u001f/\\:*?"<>|]/g, '-').replace(/[. ]+$/g, '').trim();
    const filename = `${number.padStart(2, '0')}_${clean(lastName)}_${clean(firstName)}.pdf`;
    if (names.has(filename.toLocaleLowerCase())) throw new Error(`Multiple students would have the filename “${filename}”. Distinguish their names in the CSV before matching.`);
    names.add(filename.toLocaleLowerCase());
    return { id: number, number, lastName, firstName, email: row[email] || '', filename, fields: Object.fromEntries(originalHeaders.map((header, index) => [header, row[index] || ''])) };
  });
  if (!students.length) throw new Error('The CSV contains no students.');
  return students.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'de'));
}
export const studentLabel = (student: Student): string => `${student.number} · ${student.lastName}, ${student.firstName}${student.email ? ` — ${student.email}` : ''}`;

export function matchingStudents(students: Student[], query: string): Student[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/ß/g, 'ss');
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return students.filter(student => words.every(word => normalize(studentLabel(student)).includes(word)));
}
