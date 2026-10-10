import { test, expect } from '@playwright/test';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

const folderMimeType = 'application/vnd.google-apps.folder';
const pdfMimeType = 'application/pdf';

for (const mode of ['existing', 'missing', 'custom'] as const) test(`exports matched exam previews and resumes uploads; destination=${mode}`, async ({ page }) => {
  const existingFolder = mode === 'existing';
  const customOutput = mode === 'custom';
  await mockGoogleUi(page);
  await page.addInitScript(() => Object.assign(window, { __mockFolderSelections: [{ id: 'split', name: '03_Split' }] }));
  const source = await PDFDocument.create();
  source.addPage([600, 800]).drawText('Exam header', { x: 320, y: 740, size: 20 });
  source.addPage([600, 800]).drawText('Second page, excluded from preview');
  const bytes = Buffer.from(await source.save());
  type Item = { id: string; name: string; mimeType: string; parents: string[] };
  const files = new Map<string, Item>([
    ['test-folder', { id: 'test-folder', name: '01_Test', mimeType: folderMimeType, parents: ['type-folder'] }],
    ['split', { id: 'split', name: '03_Split', mimeType: folderMimeType, parents: ['test-folder'] }],
    ['anna', { id: 'anna', name: '01_Müller_Anna.pdf', mimeType: pdfMimeType, parents: ['split'] }],
    ['lukas', { id: 'lukas', name: '02_Schmidt_Lukas.pdf', mimeType: pdfMimeType, parents: ['split'] }],
    ['excluded', { id: 'excluded', name: 'unselected.pdf', mimeType: pdfMimeType, parents: ['split'] }],
  ]);
  if (existingFolder) files.set('previews', { id: 'previews', name: '04_Previews', mimeType: folderMimeType, parents: ['test-folder'] });
  if (customOutput) files.set('custom-previews', { id: 'custom-previews', name: 'Paper corrections previews', mimeType: folderMimeType, parents: ['other-folder'] });
  const uploaded = new Map<string, Buffer>();
  const sessions = new Map<string, Item>();
  const downloads: string[] = [];
  const uploadIds: string[] = [];
  let serial = 0;
  let fail = true;
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/drive/v3/files/generateIds') return route.fulfill({ json: { ids: [`generated-${++serial}`] } });
    if (url.pathname === '/upload/drive/v3/files') {
      const item = request.postDataJSON() as Item;
      sessions.set(item.id, item); uploadIds.push(item.id);
      return route.fulfill({ headers: { Location: `https://www.googleapis.com/upload/previews/${item.id}`, 'Access-Control-Expose-Headers': 'Location' }, json: {} });
    }
    if (url.pathname.startsWith('/upload/previews/')) {
      const id = url.pathname.split('/').at(-1)!, item = sessions.get(id)!;
      if (item.name.startsWith('02_') && fail) { fail = false; return route.fulfill({ status: 503, json: { error: { message: 'Temporary preview upload failure' } } }); }
      uploaded.set(id, request.postDataBuffer()!); files.set(id, item);
      return route.fulfill({ json: { id } });
    }
    if (url.pathname === '/drive/v3/files') {
      if (request.method() === 'POST') {
        const item = request.postDataJSON() as Item;
        expect(item.name).toBe('04_Previews'); expect(item.parents).toEqual(['test-folder']);
        files.set(item.id, item); return route.fulfill({ json: item });
      }
      const query = url.searchParams.get('q') || '';
      const parent = /'([^']+)' in parents/.exec(query)?.[1];
      const mime = /mimeType = '([^']+)'/.exec(query)?.[1];
      return route.fulfill({ json: { files: [...files.values()].filter(item => item.parents.includes(parent!) && (!mime || item.mimeType === mime)) } });
    }
    if (url.pathname.endsWith('/students-csv')) return route.fulfill({ body: 'Nr.;Nachname;Vorname;E-Mail-Adresse\n1;Müller;Anna;anna@example.org\n2;Schmidt;Lukas;lukas@example.org', contentType: 'text/csv' });
    const id = url.pathname.split('/').at(-1)!, item = files.get(id);
    if (!item) return route.fulfill({ status: 404, json: {} });
    expect(request.method()).toBe('GET');
    if (url.searchParams.get('alt') === 'media') {
      downloads.push(id); return route.fulfill({ body: bytes, contentType: pdfMimeType });
    }
    return route.fulfill({ json: { ...item, size: String(bytes.length), capabilities: { canAddChildren: true } } });
  });
  await page.goto('/');
  await page.locator('#connect').click();
  await page.getByRole('tab', { name: 'Match students', exact: true }).click();
  await expect(page.locator('#match-previews')).toBeDisabled();
  await page.locator('#match-folder').click();
  await expect(page.locator('#match-setup-body')).toContainText('03_Split');
  await page.locator('#match-csv').click();
  await expect(page.locator('#match-setup-body')).toContainText('students.csv');
  await page.locator('#match-load').click();
  await page.locator('[data-match-file="excluded"]').uncheck();
  await page.locator('#match-preload').click();
  await expect(page.getByRole('status')).toContainText('Matching complete');
  await expect(page.locator('#match-previews')).toHaveAttribute('aria-expanded', 'true');
  if (customOutput) {
    await page.evaluate(() => Object.assign(window, { __mockFolderSelections: [{ id: 'custom-previews', name: 'Paper corrections previews' }] }));
    await page.getByRole('button', { name: 'Change output folder' }).click();
    await expect(page.locator('#match-previews-body')).toContainText('Paper corrections previews');
    await expect(page.locator('#match-previews')).toHaveAttribute('aria-expanded', 'true');
  }
  await page.getByRole('button', { name: 'Create previews', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary preview upload failure');
  await expect(page.getByRole('status')).toContainText('1 of 2 previews saved');
  expect(uploaded.size).toBe(1);
  await expect(page.locator('#match-output')).toBeDisabled();
  await expect(page.locator('#match-folder')).toBeDisabled();
  await page.getByRole('button', { name: 'Retry remaining previews', exact: true }).click();
  const outputName = customOutput ? 'Paper corrections previews' : '04_Previews';
  await expect(page.getByRole('status')).toHaveText(`All 2 exam previews are available in ${outputName}.`);
  await expect(page.locator('#match-previews')).toHaveAttribute('aria-expanded', 'false');
  expect(uploaded.size).toBe(2);
  expect(uploadIds).toHaveLength(3);
  expect(uploadIds[1]).toBe(uploadIds[2]);
  expect(downloads).toEqual(['anna', 'lukas']);
  const destination = [...files.values()].filter(item => item.name === outputName);
  expect(destination).toHaveLength(1);
  expect(destination[0].parents).toEqual([customOutput ? 'other-folder' : 'test-folder']);
  if (customOutput) expect([...files.values()].some(item => item.name === '04_Previews')).toBe(false);
  for (const [id, bytes] of uploaded) {
    const item = files.get(id)!;
    expect(item.parents).toEqual([destination[0].id]);
    expect(['01_Müller_Anna.pdf', '02_Schmidt_Lukas.pdf']).toContain(item.name);
    const preview = await PDFDocument.load(bytes);
    expect(preview.getPageCount()).toBe(1);
    expect(preview.getPage(0).getSize()).toEqual({ width: 600, height: 160 });
  }
  await page.locator('#match-previews').click();
  await expect(page.getByRole('button', { name: 'All previews saved', exact: true })).toBeDisabled();
  await expect(page.locator('#match-previews-body .saved-link')).toHaveCount(2);
  await page.screenshot({ path: `test-results/matching-previews-${mode}.png`, fullPage: true });
  // A fresh matching batch recognizes existing filenames and leaves all saved previews intact.
  await page.locator('#match-setup').click();
  await page.locator('#match-load').click();
  await page.locator('[data-match-file="excluded"]').uncheck();
  await page.locator('#match-preload').click();
  await expect(page.getByRole('status')).toContainText('Matching complete');
  await page.getByRole('button', { name: 'Create previews', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(`All 2 exam previews are available in ${outputName}.`);
  expect(uploadIds).toHaveLength(3);
  expect(uploaded.size).toBe(2);
});

test('preview PDFs contain only the visible top 20%, including rotated and cropped front pages', async ({ page }) => {
  await mockGoogleUi(page);
  await page.goto('/');
  await page.locator('#connect').click();
  for (const rotation of [0, 90, 180, 270, -90]) {
    const source = await PDFDocument.create();
    const first = source.addPage([600, 800]);
    first.setRotation(degrees(rotation));
    first.drawRectangle({ x: 0, y: 0, width: 600, height: 800, color: rgb(0, 0, 1) });
    const top = rotation === 0 ? { x: 0, y: 640, width: 600, height: 160 }
      : rotation === 90 ? { x: 0, y: 0, width: 120, height: 800 }
      : rotation === 180 ? { x: 0, y: 0, width: 600, height: 160 }
      : { x: 480, y: 0, width: 120, height: 800 };
    first.drawRectangle({ ...top, color: rgb(0, 1, 0) });
    source.addPage([600, 800]).drawRectangle({ x: 0, y: 0, width: 600, height: 800, color: rgb(1, 0, 0) });
    const output = await createAndInspect(await source.save());
    const preview = await PDFDocument.load(Uint8Array.from(output.bytes));
    expect(preview.getPageCount()).toBe(1);
    expect(preview.getPage(0).getSize()).toEqual(rotation % 180 ? { width: 800, height: 120 } : { width: 600, height: 160 });
    expect(output.pixels).toEqual([[0, 255, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255]]);
  }
  const source = await PDFDocument.create();
  const first = source.addPage([600, 800]);
  first.setCropBox(50, 100, 500, 600);
  first.drawRectangle({ x: 0, y: 0, width: 600, height: 800, color: rgb(0, 0, 1) });
  first.drawRectangle({ x: 50, y: 580, width: 500, height: 120, color: rgb(0, 1, 0) });
  const output = await createAndInspect(await source.save());
  const preview = await PDFDocument.load(Uint8Array.from(output.bytes));
  expect(preview.getPage(0).getSize()).toEqual({ width: 500, height: 120 });
  expect(output.pixels).toEqual([[0, 255, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255]]);

  async function createAndInspect(bytes: Uint8Array) {
    return page.evaluate(async input => {
      const path = '/src/pdf.ts';
      const { createExamPreviewPdf, renderPagePreview } = await import(path);
      const controller = new AbortController();
      const blob = await createExamPreviewPdf(Uint8Array.from(input), controller.signal);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const canvas = document.createElement('canvas');
      await renderPagePreview(bytes, 1, canvas, controller.signal);
      const pixels = [.05, .5, .95].map(y => Array.from(canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * y), 1, 1).data));
      canvas.width = canvas.height = 0;
      return { bytes: Array.from(bytes), pixels };
    }, Array.from(bytes));
  }
});
