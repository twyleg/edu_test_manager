import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStudents, matchingStudents } from '../src/students';

describe('student CSV', () => {
  it('reads the supplied semicolon/BOM example and preserves umlauts', () => {
    const students = parseStudents(readFileSync('resources/example_student_list.csv', 'utf8'));
    expect(students).toHaveLength(10);
    expect(students.find((s) => s.lastName === 'Müller')).toMatchObject({
      filename: '01_Müller_Anna.pdf',
    });
  });
  it('handles comma delimiters, quoted fields and CRLF', () => {
    expect(
      parseStudents(
        'Nr.,Nachname,Vorname,E-Mail-Adresse,Extra\r\n01,"Müller, Meier",Anna,a@example.org,"quoted ""value""\ncontinued"',
      )[0],
    ).toMatchObject({ lastName: 'Müller, Meier', firstName: 'Anna', email: 'a@example.org' });
  });
  it('preserves leading zeros and distinguishes students with identical names by number', () => {
    const students = parseStudents(
      'Nr.;Nachname;Vorname;E-Mail-Adresse\n01;Müller;Anna;a@b.test\n02;Müller;Anna;c@b.test',
    );
    expect(students.map((s) => s.filename)).toEqual(['01_Müller_Anna.pdf', '02_Müller_Anna.pdf']);
    expect(matchingStudents(students, 'muller')).toHaveLength(2);
    expect(matchingStudents(students, '01 anna')).toHaveLength(1);
  });
  it.each([
    ['Name;Email\nA;a@b.test', 'columns'],
    ['Nr.;Nachname;Vorname;E-Mail-Adresse\n1;Müller;;a@b.test', 'missing'],
    [
      'Nr.;Nachname;Vorname;E-Mail-Adresse\n1;Müller;Anna;a@b.test\n1;Müller;Anna;c@b.test',
      'Duplicate student number',
    ],
    ['Nachname;Vorname;E-Mail-Adresse\n"Müller;Anna;a@b.test', 'unclosed'],
  ])('rejects ambiguous or malformed input', (csv, message) =>
    expect(() => parseStudents(csv)).toThrow(message),
  );
});
