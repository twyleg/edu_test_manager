import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

const folderMime = 'application/vnd.google-apps.folder';
test('prepares a scan copy and finishes with links to the test folders', async ({ page }) => {
  await mockGoogleUi(page);
  await page.addInitScript(() => {
    Object.assign(window, { __mockFolderSelections: [{ id: 'scanner', name: 'Scanner inbox' }, { id: 'course', name: '8a' }] });
  });
  const files = new Map([
    ['scanner', { id: 'scanner', name: 'Scanner inbox', mimeType: folderMime, parents: ['root'] }],
    ['course', { id: 'course', name: '8a', mimeType: folderMime, parents: ['school-year'] }],
    ['original', { id: 'original', name: 'scanner-original.pdf', mimeType: 'application/pdf', parents: ['scanner'] }],
  ]);
  let nextId = 0;
  const copies: { source: string; id: string; name: string; parents: string[] }[] = [];
  const mutations: string[] = [];
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Physics test - first page');
  pdf.addPage().drawText('Physics test - second page');
  const pdfBytes = Buffer.from(await pdf.save());
  let mediaRequests = 0;
  let holdDownload: Promise<void> | undefined;
  let downloadStarted: (() => void) | undefined;
  await page.route('https://www.googleapis.com/drive/v3/files**', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() !== 'GET') mutations.push(request.method());
    if (url.pathname.endsWith('/copy')) {
      const body = request.postDataJSON();
      copies.push({ source: url.pathname.split('/').at(-2)!, ...body });
      const copy = { ...body, mimeType: 'application/pdf' }; files.set(copy.id, copy);
      await route.fulfill({ json: copy }); return;
    }
    if (url.searchParams.get('alt') === 'media') {
      mediaRequests++;
      downloadStarted?.();
      if (holdDownload) await holdDownload;
      if (mediaRequests === 1) { await route.fulfill({ status: 503, json: { error: { message: 'Try again' } } }); return; }
      await route.fulfill({ contentType: 'application/pdf', body: pdfBytes }); return;
    }
    if (url.searchParams.get('fields') === 'size') { await route.fulfill({ json: { size: String(pdfBytes.length) } }); return; }
    if (url.pathname.endsWith('/generateIds')) { await route.fulfill({ json: { ids: [`new-${++nextId}`] } }); return; }
    if (url.pathname.endsWith('/files')) {
      if (request.method() === 'POST') {
        const item = request.postDataJSON(); files.set(item.id, item);
        await route.fulfill({ json: item }); return;
      }
      const query = url.searchParams.get('q') || '';
      const parent = /'([^']+)' in parents/.exec(query)?.[1];
      const mime = /mimeType = '([^']+)'/.exec(query)?.[1];
      await route.fulfill({ json: { files: [...files.values()].filter(item => item.parents.includes(parent!) && (!mime || item.mimeType === mime)) } }); return;
    }
    const id = url.pathname.split('/').at(-1)!;
    const item = files.get(id);
    if (!item) { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: { ...item, capabilities: { canAddChildren: true } } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Preparation', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Organize a new test.' })).toBeVisible();
  await expect(page.getByLabel('Corrected PDF', { exact: true })).toHaveCount(0);
  await page.locator('#prep-toggle-setup').click();
  await expect(page.locator('#prep-setup-body')).toBeHidden();
  await page.locator('#prep-toggle-setup').click();
  await page.getByRole('button', { name: 'Enable folder access', exact: true }).click();
  await page.getByRole('button', { name: 'Choose input folder', exact: true }).click();
  await expect(page.locator('#prep-file option')).toHaveCount(2);
  await page.locator('#prep-file').selectOption('original');
  await page.getByRole('button', { name: 'Preview scan', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'scanner-original.pdf' });
  await expect(preview.getByRole('alert')).toContainText('Could not preview this scan');
  await preview.getByRole('button', { name: 'Retry preview' }).click();
  await expect(preview.getByRole('img', { name: 'Page 1 of 2 of scanner-original.pdf' })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await preview.getByRole('button', { name: 'Next page' }).click();
  await expect(preview.getByRole('img', { name: 'Page 2 of 2 of scanner-original.pdf' })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await preview.getByRole('button', { name: 'Previous page' }).click();
  await expect(preview.getByRole('img', { name: 'Page 1 of 2 of scanner-original.pdf' })).toBeVisible();
  expect(mediaRequests).toBe(2); // Navigation reuses downloaded bytes.
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview scan', exact: true })).toBeFocused();
  let release!: () => void;
  holdDownload = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { downloadStarted = resolve; });
  await page.getByRole('button', { name: 'Preview scan', exact: true }).click();
  await started;
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  release(); holdDownload = undefined;
  await expect(preview).toHaveCount(0);
  expect(mutations).toHaveLength(0);

  await page.getByRole('button', { name: 'Choose Course folder', exact: true }).click();
  await expect(page.locator('#prep-course')).toHaveValue('8a');
  await page.locator('#prep-file').selectOption('');
  await expect(page.getByRole('button', { name: 'Start preparation', exact: true })).toBeDisabled();
  await page.locator('#prep-file').selectOption('original');
  await expect(page.getByRole('button', { name: 'Start preparation', exact: true })).toBeEnabled();
  await page.locator('#prep-subject').selectOption('Physik');
  await page.locator('#prep-type').selectOption('Klausur');
  await page.locator('#prep-date').fill('2026-09-30');
  await page.locator('#prep-topic').fill('Kräfte und Bewegung');
  await expect(page.locator('#prep-filename')).toHaveText('20260930_KA-PH8a-Kräfte-und-Bewegung.pdf');
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('tab', { name: 'Preparation', exact: true }).click();
  await expect(page.locator('#prep-topic')).toHaveValue('Kräfte und Bewegung');
  await page.screenshot({ path: 'test-results/preparation-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/preparation-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Start preparation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Preparation complete');
  await expect(page.locator('#prep-toggle-setup')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: 'Test folders ready' })).toBeVisible();
  await expect(page.locator('#prep-progress')).toBeFocused();
  expect(copies).toHaveLength(1);
  const find = (name: string) => [...files.values()].find(item => item.name === name)!;
  expect(find('LZKs').parents).toEqual(['course']);
  expect(find('Klausuren').parents).toEqual(['course']);
  expect(find('01_Kräfte-und-Bewegung').parents).toEqual([find('Klausuren').id]);
  expect(find('01_Scans').parents).toEqual([find('01_Kräfte-und-Bewegung').id]);
  expect(copies[0]).toEqual({ source: 'original', id: expect.any(String), parents: [find('01_Scans').id], name: '20260930_KA-PH8a-Kräfte-und-Bewegung.pdf' });
  expect(copies[0].id).not.toBe('original');
  expect(files.get('original')!.parents).toEqual(['scanner']);
  expect(files.get('original')!.name).toBe('scanner-original.pdf');
  expect(mutations).not.toContain('PATCH');
  await expect(page.getByLabel('Corrected PDF', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load corrected PDFs', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Preparation', exact: true })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['01_Scans', '02_Korrigiert', '03_Split', '04_Previews']) {
    await expect(page.getByRole('link', { name: `${name} ↗`, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Prepare another test', exact: true }).click();
  await expect(page.locator('#prep-topic')).toHaveValue('');
  expect(copies).toHaveLength(1);
});
