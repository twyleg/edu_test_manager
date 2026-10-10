import { test, expect } from '@playwright/test';
import { mockGoogleUi } from './googleMock';

const folderMime = 'application/vnd.google-apps.folder';
test('confirms course setup, creates a test with retry, then imports scans into it', async ({
  page,
}) => {
  await mockGoogleUi(page);
  await page.addInitScript(() => {
    Object.assign(window, {
      __mockFolderSelections: [{ id: 'course', name: '8a' }],
      __mockPdfSelection: { id: 'original', name: 'scanner-original.pdf' },
    });
  });
  const files = new Map([
    ['scanner', { id: 'scanner', name: 'Scanner inbox', mimeType: folderMime, parents: ['root'] }],
    ['course', { id: 'course', name: '8a', mimeType: folderMime, parents: ['school-year'] }],
    [
      'school-year',
      { id: 'school-year', name: '2026-2027', mimeType: folderMime, parents: ['grade'] },
    ],
    ['grade', { id: 'grade', name: '08', mimeType: folderMime, parents: ['subject'] }],
    ['subject', { id: 'subject', name: 'Physik', mimeType: folderMime, parents: ['root'] }],
    [
      'original',
      {
        id: 'original',
        name: 'scanner-original.pdf',
        mimeType: 'application/pdf',
        parents: ['scanner'],
      },
    ],
  ]);
  let nextId = 0;
  let loseFolderResponse = true;
  const copies: { source: string; id: string; name: string; parents: string[] }[] = [];
  const mutations: string[] = [];
  await page.route('https://www.googleapis.com/drive/v3/files**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      mutations.push(request.method());
    }
    if (url.pathname.endsWith('/copy')) {
      const body = request.postDataJSON();
      copies.push({ source: url.pathname.split('/').at(-2)!, ...body });
      const copy = { ...body, mimeType: 'application/pdf' };
      files.set(copy.id, copy);
      await route.fulfill({ json: copy });
      return;
    }
    if (url.pathname.endsWith('/generateIds')) {
      await route.fulfill({ json: { ids: [`new-${++nextId}`] } });
      return;
    }
    if (url.pathname.endsWith('/files')) {
      if (request.method() === 'POST') {
        const item = request.postDataJSON();
        files.set(item.id, item);
        if (item.name === '01_Scans' && loseFolderResponse) {
          loseFolderResponse = false;
          await route.fulfill({ status: 503, json: { error: { message: 'Lost response' } } });
          return;
        }
        await route.fulfill({ json: item });
        return;
      }
      const query = url.searchParams.get('q') || '';
      const parent = /'([^']+)' in parents/.exec(query)?.[1];
      const mime = /mimeType = '([^']+)'/.exec(query)?.[1];
      await route.fulfill({
        json: {
          files: [...files.values()].filter(
            (item) => item.parents.includes(parent!) && (!mime || item.mimeType === mime),
          ),
        },
      });
      return;
    }
    const id = url.pathname.split('/').at(-1)!;
    const item = files.get(id);
    if (!item) {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    await route.fulfill({ json: { ...item, capabilities: { canAddChildren: true } } });
  });
  await page.goto('/');
  await page.locator('#connect').click();
  await page.getByRole('tab', { name: 'Import scans', exact: true }).click();
  await expect(page.locator('.import-details')).toBeVisible();
  await expect(page.getByLabel('Corrected PDF', { exact: true })).toHaveCount(0);
  await page.locator('#workflow-course').click();
  await page.locator('#course-pick').click();
  const setup = page.getByRole('dialog', { name: 'Set up course folders' });
  await expect(setup).toContainText('LZKs');
  await expect(setup).toContainText('Klausuren');
  await expect(page.locator('#prep-subject')).toHaveValue('Physik');
  expect(mutations).toHaveLength(0);
  await setup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Subject', { exact: true }).selectOption('Informatik');
  await page.locator('#workflow-test').click();
  await page.locator('#test-new').click();
  await setup.getByRole('button', { name: 'Create folders', exact: true }).click();
  const newTest = page.getByRole('dialog', { name: 'Create a new test' });
  await expect(newTest).toBeVisible();
  await newTest.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(
    [...files.values()].filter((item) => item.parents.includes('course')).map((item) => item.name),
  ).toEqual(['LZKs', 'Klausuren']);
  await page.locator('#workflow-test').click();
  await page.locator('#test-new').click();
  await newTest.getByLabel('Test topic').fill('Kräfte und Bewegung');
  await newTest.getByLabel('Test type').selectOption('Klausur');
  await newTest.getByRole('button', { name: 'Create test', exact: true }).click();
  await expect(newTest.getByRole('alert')).toContainText('Lost response');
  await newTest.getByRole('button', { name: 'Retry creation', exact: true }).click();
  await expect(newTest).toHaveCount(0);
  await expect(page.locator('#workflow-test')).toContainText('01_Kräfte-und-Bewegung');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Informatik');
  expect(copies).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Import scan', exact: true })).toBeDisabled();
  await page.locator('#prep-input').click();
  await expect(page.locator('#prep-input')).toContainText('scanner-original.pdf');
  await expect(page.getByRole('button', { name: 'Import scan', exact: true })).toBeEnabled();
  await expect(page.locator('#prep-course')).toHaveValue('8a');
  await expect(page.locator('#prep-destination')).toHaveValue('01_Scans');
  await page.locator('#prep-subject').selectOption('Physik');
  await page.locator('#prep-date').fill('2026-09-30');
  await expect(page.locator('#prep-filename')).toHaveText(
    '20260930_KA-PH8a-Kräfte-und-Bewegung.pdf',
  );
  await page.getByLabel('Subject', { exact: true }).selectOption('Informatik');
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('tab', { name: 'Import scans', exact: true }).click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Informatik');
  await expect(page.locator('#prep-filename')).toHaveText(
    '20260930_KA-IF8a-Kräfte-und-Bewegung.pdf',
  );
  await page.getByLabel('Subject', { exact: true }).selectOption('Physik');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Physik');
  await expect(page.locator('#prep-topic')).toHaveCount(0);
  await expect(page.locator('#prep-type')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/preparation-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/preparation-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Import scan', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Import complete');
  await expect(page.locator('#prep-progress')).toBeFocused();
  expect(copies).toHaveLength(1);
  const find = (name: string) => [...files.values()].find((item) => item.name === name)!;
  expect(find('LZKs').parents).toEqual(['course']);
  expect(find('Klausuren').parents).toEqual(['course']);
  expect(find('01_Kräfte-und-Bewegung').parents).toEqual([find('Klausuren').id]);
  expect(find('01_Scans').parents).toEqual([find('01_Kräfte-und-Bewegung').id]);
  expect(copies[0]).toEqual({
    source: 'original',
    id: expect.any(String),
    parents: [find('01_Scans').id],
    name: '20260930_KA-PH8a-Kräfte-und-Bewegung.pdf',
  });
  expect(copies[0].id).not.toBe('original');
  expect(files.get('original')!.parents).toEqual(['scanner']);
  expect(files.get('original')!.name).toBe('scanner-original.pdf');
  expect(mutations).not.toContain('PATCH');
  await expect(page.getByLabel('Corrected PDF', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load corrected PDFs', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('tab', { name: 'Import scans', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect([...files.values()].filter((item) => item.name === '01_Scans')).toHaveLength(1);
  expect([...files.values()].filter((item) => item.name === '01_Kräfte-und-Bewegung')).toHaveLength(
    1,
  );
  await page.getByRole('button', { name: 'Import another scan', exact: true }).click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Physik');
  await expect(page.locator('#prep-input')).toContainText('Choose PDF from Drive');
  expect(copies).toHaveLength(1);
  await page.reload();
  await expect(page.locator('#workflow-test')).toContainText('01_Kräfte-und-Bewegung');
  await expect(page.locator('#prep-input')).toContainText('Choose PDF from Drive');
  await page.locator('#prep-input').click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __mockPickerParents: string[] }).__mockPickerParents[0],
    ),
  ).toBe('scanner');
  await expect(page.locator('#prep-input')).toContainText('scanner-original.pdf');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Physik');
  await page.getByLabel('Document status').selectOption('02_Korrigiert');
  await expect(page.locator('#prep-destination-hint')).toContainText('/ 02_Korrigiert');
  await page.getByRole('button', { name: 'Import scan', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'Import complete. Scan copied to 02_Korrigiert',
  );
  await expect(page.getByLabel('Document status')).toBeDisabled();
  expect(copies).toHaveLength(2);
  expect(copies[1].parents).toEqual([find('02_Korrigiert').id]);
  expect(files.get('original')!.parents).toEqual(['scanner']);
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await expect(page.locator('#slice-file-list')).toContainText(copies[1].name);
  for (const item of [
    { id: 'info-course', name: '9b', mimeType: folderMime, parents: ['info-subject'] },
    { id: 'info-subject', name: 'Informatik', mimeType: folderMime, parents: ['root'] },
    { id: 'info-lzks', name: 'LZKs', mimeType: folderMime, parents: ['info-course'] },
    { id: 'info-klausuren', name: 'Klausuren', mimeType: folderMime, parents: ['info-course'] },
  ]) {
    files.set(item.id, item);
  }
  await page.getByRole('tab', { name: 'Import scans', exact: true }).click();
  await page.evaluate(() =>
    Object.assign(window, { __mockFolderSelections: [{ id: 'info-course', name: '9b' }] }),
  );
  await page.locator('#workflow-course').click();
  await page.locator('#course-pick').click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Informatik');
  await expect(page.locator('#prep-course')).toHaveValue('9b');
});

test('keeps a manual subject choice made while the course path is loading', async ({ page }) => {
  await mockGoogleUi(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'edu-test-manager-workflow-v1',
      JSON.stringify({
        course: { id: 'course', name: '8a', mimeType: 'application/vnd.google-apps.folder' },
      }),
    ),
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let readingPath = false;
  await page.route('https://www.googleapis.com/drive/v3/files**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/course')) {
      readingPath = true;
      await pending;
      return route.fulfill({
        json: { id: 'course', name: '8a', mimeType: folderMime, parents: ['subject'] },
      });
    }
    if (url.pathname.endsWith('/subject')) {
      return route.fulfill({ json: { id: 'subject', name: 'Physik', mimeType: folderMime } });
    }
    const q = url.searchParams.get('q') || '';
    return route.fulfill({
      json: {
        files: q.includes("'course'")
          ? ['LZKs', 'Klausuren'].map((name) => ({ id: name, name, mimeType: folderMime }))
          : [],
      },
    });
  });
  await page.goto('/');
  await page.locator('#connect').click();
  await expect.poll(() => readingPath).toBe(true);
  await page.getByLabel('Subject', { exact: true }).selectOption('Informatik');
  release();
  await expect(page.locator('#workflow-course')).toBeEnabled();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Informatik');
  await page.locator('#workflow-test').click();
  await page.locator('#workflow-refresh').click();
  await expect(page.locator('#workflow-refresh')).toBeEnabled();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Informatik');
});
