export interface Student {
  id: string;
  number: string;
  lastName: string;
  firstName: string;
  email: string;
  filename: string;
  fields?: Record<string, string>;
}

function filenamePart(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u001f/\\:*?"<>|]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
}

/** Quoted CSV fields may contain delimiters, newlines, and escaped quotes. */
function parseCsvRows(text: string): string[][] {
  const delimiter = text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === delimiter || character === '\n' || character === '\r')) {
      row.push(field.trim());
      field = '';
      if (character !== delimiter) {
        if (row.some(Boolean)) {
          rows.push(row);
        }
        row = [];
        if (character === '\r' && text[i + 1] === '\n') {
          i++;
        }
      }
    } else {
      field += character;
    }
  }
  if (quoted) {
    throw new Error('The CSV contains an unclosed quoted field.');
  }
  row.push(field.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

export function parseStudents(text: string): Student[] {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
  const originalHeaders = rows.shift() || [];
  const headers = originalHeaders.map((value) => value.toLocaleLowerCase());
  const numberColumn = headers.findIndex((header) => header === 'nr.' || header === 'nr');
  const lastNameColumn = headers.indexOf('nachname');
  const firstNameColumn = headers.indexOf('vorname');
  const emailColumn = headers.indexOf('e-mail-adresse');
  if (numberColumn < 0 || lastNameColumn < 0 || firstNameColumn < 0 || emailColumn < 0) {
    throw new Error('CSV needs the columns Nr., Nachname, Vorname and E-Mail-Adresse.');
  }

  const names = new Set<string>();
  const numbers = new Set<string>();
  const students = rows.map((row, i) => {
    const number = row[numberColumn] || '';
    if (!/^\d+$/.test(number)) {
      throw new Error(`CSV row ${i + 2} needs a numeric Nr. value.`);
    }
    const canonicalNumber = number.replace(/^0+(?=\d)/, '');
    if (numbers.has(canonicalNumber)) {
      throw new Error(`Duplicate student number ${number} in the CSV.`);
    }
    numbers.add(canonicalNumber);
    const lastName = row[lastNameColumn] || '';
    const firstName = row[firstNameColumn] || '';
    if (!lastName || !firstName) {
      throw new Error(`CSV row ${i + 2} has a missing first or last name.`);
    }
    const filename = `${number.padStart(2, '0')}_${filenamePart(lastName)}_${filenamePart(firstName)}.pdf`;
    if (names.has(filename.toLocaleLowerCase())) {
      throw new Error(
        `Multiple students would have the filename “${filename}”. Distinguish their names in the CSV before matching.`,
      );
    }
    names.add(filename.toLocaleLowerCase());

    return {
      id: number,
      number,
      lastName,
      firstName,
      email: row[emailColumn] || '',
      filename,
      fields: Object.fromEntries(
        originalHeaders.map((header, index) => [header, row[index] || '']),
      ),
    };
  });
  if (!students.length) {
    throw new Error('The CSV contains no students.');
  }

  return students.sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'de'),
  );
}

export const studentLabel = (student: Student): string =>
  `${student.number} · ${student.lastName}, ${student.firstName}${student.email ? ` — ${student.email}` : ''}`;

export function matchingStudents(students: Student[], query: string): Student[] {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/ß/g, 'ss');
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return students.filter((student) =>
    words.every((word) => normalize(studentLabel(student)).includes(word)),
  );
}
