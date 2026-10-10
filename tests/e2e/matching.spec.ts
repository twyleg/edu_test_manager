import { test, expect } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

test('matches a Drive folder using CSV and renames in place, recovering a lost rename response', async ({ page }) => {
  await mockGoogleUi(page);
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]).drawText('Anna Mueller', { x: 350, y: 740, size: 22, color: rgb(0, 0, 0) });
  const bytes = Buffer.from(await pdf.save());
  const exams = [
    { id: 'exam-a', name: 'scan_exam-001.pdf', mimeType: 'application/pdf' },
    { id: 'exam-b', name: 'scan_exam-002.pdf', mimeType: 'application/pdf' },
    { id: 'exam-c', name: 'leave-untouched.pdf', mimeType: 'application/pdf' },
  ];
  const writes: { id: string; name: string }[] = [];
  let failFirst = true;
  const downloads: string[] = [];
  let releaseSecond!: () => void;
  const secondReady = new Promise<void>(resolve => { releaseSecond = resolve; });
  await page.route('https://www.googleapis.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/drive/v3/files') {
      expect(url.searchParams.get('q')).toContain("'destination-folder' in parents");
      return route.fulfill({ json: { files: exams } });
    }
    if (url.pathname.endsWith('/students-csv')) return route.fulfill({ body: '\uFEFFNr.;Nachname;Vorname;E-Mail-Adresse\r\n1;Müller;Anna;anna@example.org\r\n2;Schmidt;Lukas;lukas@example.org', contentType: 'text/csv' });
    const exam = exams.find(exam => url.pathname.endsWith('/' + exam.id));
    if (exam) {
      if (route.request().method() === 'PATCH') {
        const data = route.request().postDataJSON();
        expect(Object.keys(data)).toEqual(['name']);
        writes.push({ id: exam.id, name: data.name }); exam.name = data.name;
        if (failFirst) { failFirst = false; return route.fulfill({ status: 503, json: { error: { message: 'Temporary failure' } } }); }
        return route.fulfill({ json: exam });
      }
      if (url.searchParams.get('fields') === 'size') return route.fulfill({ json: { size: String(bytes.length) } });
      downloads.push(exam.id);
      if (exam.id === 'exam-b') await secondReady;
      return route.fulfill({ body: bytes, contentType: 'application/pdf' });
    }
    throw new Error(`Unexpected URL: ${url.pathname}`);
  });
  await page.goto('/');
  await page.locator('#connect').click();
  // The slicing folder is prefilled in matching, without needing to scan.
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Drive folder', exact: true }).click();
  await expect(page.locator('#panel-slice .file-selection').nth(1)).toContainText('Physics class');
  await page.getByRole('tab', { name: 'Match students', exact: true }).click();
  await expect(page.locator('#match-setup-body')).toContainText('Physics class');
  await page.getByRole('button', { name: 'Choose student CSV', exact: true }).click();
  await expect(page.locator('#match-setup-body')).toContainText('students.csv');
  await expect(page.locator('#match-files')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#match-review')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#match-review')).toBeDisabled();
  await expect(page.locator('#match-previews')).toBeDisabled();
  await page.getByRole('button', { name: 'Find exams & students', exact: true }).click();
  await expect(page.locator('#match-files')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-match-file]:checked')).toHaveCount(3);
  expect(downloads).toEqual([]);
  await page.locator('#match-select-none').click();
  await expect(page.locator('#match-preload')).toBeDisabled();
  await page.locator('#match-select-all').click();
  await page.locator('[data-match-file="exam-c"]').uncheck();
  await page.locator('#match-preload').click();
  await expect.poll(() => downloads).toEqual(['exam-a', 'exam-b']);
  await expect(page.locator('#student-search')).toHaveCount(0);
  await expect(page.locator('#match-files')).toHaveAttribute('aria-expanded', 'true');
  releaseSecond();
  await expect(page.getByRole('img', { name: 'Top right name area of the exam front page' })).toBeVisible();
  await expect(page.locator('#student-search')).toBeFocused();
  await page.locator('#student-search').fill('example.org');
  await page.locator('#student-search').press('Tab');
  await expect(page.locator('#student-search')).toHaveValue('example.org');
  expect(writes).toHaveLength(0);
  // Only an actual CSV student may be saved, not arbitrary text.
  await page.locator('#student-search').fill('Someone else');
  await expect(page.locator('#match-save')).toBeDisabled();
  await page.locator('#student-search').fill('Müll');
  await page.locator('#student-search').press('Tab');
  await expect(page.locator('#student-search')).toHaveValue('1 · Müller, Anna — anna@example.org');
  await expect(page.locator('#student-search')).toBeFocused();
  await expect(page.locator('#match-target')).toHaveText('01_Müller_Anna.pdf');
  await page.locator('#student-search').press('Enter');
  await expect(page.getByRole('alert')).toContainText('Temporary failure');
  await page.getByRole('button', { name: 'Rename & next' }).click();
  await expect(page.getByRole('heading', { name: 'Exam 2 of 2' })).toBeVisible();
  await expect(page.locator('#student-search')).toBeEnabled();
  await page.locator('#student-search').fill('1 · Müller, Anna — anna@example.org');
  await page.locator('#match-save').click();
  await expect(page.getByRole('alert')).toContainText('Another exam is already named');
  await page.locator('#student-search').fill('Lukas');
  await page.locator('#student-search').press('Tab');
  await expect(page.locator('#student-search')).toHaveValue('2 · Schmidt, Lukas — lukas@example.org');
  await page.locator('#student-search').press('Enter');
  await expect(page.getByRole('status')).toContainText('All 2 selected exam filenames now match students');
  await expect(page.locator('#match-previews')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#match-review')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#student-search')).not.toBeVisible();
  await expect(page.locator('#match-progress')).toBeFocused();
  await page.locator('#match-review').click();
  expect(downloads).toEqual(['exam-a', 'exam-b']);
  expect(writes).toEqual([{ id: 'exam-a', name: '01_Müller_Anna.pdf' }, { id: 'exam-b', name: '02_Schmidt_Lukas.pdf' }]);
  await page.getByRole('button', { name: 'View full front page' }).click();
  await expect(page.getByRole('dialog').locator('canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/matching-mobile.png', fullPage: true });
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('tab', { name: 'Match students', exact: true }).click();
  await expect(page.locator('#student-search')).toHaveValue('2 · Schmidt, Lukas — lukas@example.org');
  // Reloading the folder recognizes previously named files without writing them again.
  await page.locator('#match-setup').click();
  await page.locator('#match-load').click();
  await expect(page.locator('#match-files')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('[data-match-file="exam-c"]').uncheck();
  await page.locator('#match-preload').click();
  await expect(page.getByRole('status')).toContainText('Matching complete');
  await expect(page.locator('#match-review')).toHaveAttribute('aria-expanded', 'false');
  expect(exams[2].name).toBe('leave-untouched.pdf');
  expect(writes).toHaveLength(2);
});

test('matching starts independently and reports invalid CSV and empty folders', async ({ page }) => {
  await mockGoogleUi(page);
  let validCsv = false;
  await page.route('https://www.googleapis.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/students-csv')) return route.fulfill({ contentType: 'text/csv', body: validCsv ? 'Nr.;Nachname;Vorname;E-Mail-Adresse\n1;Müller;Anna;anna@example.org' : 'Name;Email\nAnna;anna@example.org' });
    if (url.pathname === '/drive/v3/files') return route.fulfill({ json: { files: [] } });
    throw new Error('Unexpected request');
  });
  await page.goto('/');
  await page.locator('#connect').click();
  await page.getByRole('tab', { name: 'Match students', exact: true }).click();
  await page.getByRole('button', { name: 'Choose exam folder' }).click();
  await expect(page.locator('#match-setup-body')).toContainText('Physics class');
  await page.getByRole('button', { name: 'Choose student CSV' }).click();
  await expect(page.locator('#match-setup-body')).toContainText('students.csv');
  await page.locator('#match-load').click();
  await expect(page.getByRole('alert')).toContainText('CSV needs the columns');
  validCsv = true;
  await page.locator('#match-load').click();
  await expect(page.getByRole('alert')).toContainText('contains no PDF files');
  await expect(page.locator('#match-load')).toBeEnabled();
});

test('cancelling preloading releases cached previews and keeps matching closed', async ({ page }) => {
  await mockGoogleUi(page);
  await page.addInitScript(() => {
    const live = new Set<string>();
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); live.add(url); return url; };
    URL.revokeObjectURL = url => { live.delete(url); revoke(url); };
    Object.assign(window, { livePreviewCount: () => live.size });
  });
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let secondRequested = false;
  await page.route('https://www.googleapis.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/students-csv')) return route.fulfill({ body: 'Nr.;Nachname;Vorname;E-Mail-Adresse\n1;Müller;Anna;a@example.org' });
    if (url.pathname === '/drive/v3/files') return route.fulfill({ json: { files: [{ id: 'one', name: 'one.pdf', mimeType: 'application/pdf' }, { id: 'two', name: 'two.pdf', mimeType: 'application/pdf' }] } });
    if (url.searchParams.get('fields') === 'size') return route.fulfill({ json: { size: String(bytes.length) } });
    if (url.pathname.endsWith('/two')) { secondRequested = true; await held; }
    return route.fulfill({ body: bytes, contentType: 'application/pdf' });
  });
  await page.goto('/');
  await page.locator('#connect').click();
  await page.getByRole('tab', { name: 'Match students', exact: true }).click();
  await page.locator('#match-folder').click();
  await expect(page.locator('#match-setup-body')).toContainText('Physics class');
  await page.locator('#match-csv').click();
  await expect(page.locator('#match-setup-body')).toContainText('students.csv');
  await page.locator('#match-load').click();
  await page.locator('#match-preload').click();
  await expect.poll(() => secondRequested).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { livePreviewCount: () => number }).livePreviewCount())).toBeGreaterThan(0);
  await page.locator('#match-cancel').click();
  await expect(page.getByRole('status')).toContainText('Loading cancelled');
  release();
  expect(await page.evaluate(() => (window as unknown as { livePreviewCount: () => number }).livePreviewCount())).toBe(0);
  await expect(page.locator('#student-search')).toHaveCount(0);
  await expect(page.locator('#match-files')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#match-preload')).toBeEnabled();
});
