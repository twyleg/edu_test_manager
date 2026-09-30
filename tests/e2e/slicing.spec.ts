import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

const samplePath = path.resolve(existsSync('resources/example_lzk.pdf') ? 'resources/example_lzk.pdf' : '20260911_142302_005443.pdf');
test.beforeEach(async ({ page }) => { await mockGoogleUi(page); });

async function selectLocal(page: Page, buffer: Buffer, name = 'exam.pdf') {
  await page.locator('#local-pdf').setInputFiles({ name, mimeType: 'application/pdf', buffer });
  await page.getByRole('button', { name: 'Scan PDF', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Scan complete', { timeout: 90000 });
}

test('sample scan yields three original-quality, two-page PDFs', async ({ page }) => {
  test.skip(!existsSync(samplePath), 'Private example PDF is not present.');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await selectLocal(page, await readFile(samplePath), path.basename(samplePath));
  await expect(page.locator('.page-card')).toHaveCount(6);
  await expect(page.locator('.exam-group')).toHaveCount(3);
  for (let group = 0; group < 3; group++) {
    await expect(page.locator('.exam-group').nth(group).locator('.page-index')).toHaveText([String(group * 2 + 1), String(group * 2 + 2)]);
  }
  await page.getByRole('button', { name: 'View page 2', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Page 2', exact: true });
  await expect(preview.getByRole('img', { name: 'Full view of page 2' })).toBeVisible();
  expect(await preview.locator('canvas').evaluate(canvas => canvas.height)).toBeGreaterThan(2000);
  await page.screenshot({ path: 'test-results/page-preview.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View page 2', exact: true })).toBeFocused();
  await expect(page.locator('#front-1')).not.toBeChecked();

  for (let index = 0; index < 6; index++) {
    await expect(page.locator(`#front-${index}`)).toBeChecked({ checked: index % 2 === 0 });
  }
  await page.getByRole('button', { name: 'Prepare 3 PDFs' }).click();
  await expect(page.locator('.result-row')).toHaveCount(3);
  const source = await PDFDocument.load(await readFile(samplePath));
  for (let index = 0; index < 3; index++) {
    const link = page.locator('.result-row').nth(index).getByRole('link', { name: 'Download', exact: true });
    const downloadEvent = page.waitForEvent('download');
    await link.click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toContain(`exam-00${index + 1}_pages-${index * 2 + 1}-${index * 2 + 2}.pdf`);
    const output = await PDFDocument.load(await readFile((await download.path())!));
    expect(output.getPageCount()).toBe(2);
    for (let offset = 0; offset < 2; offset++) {
      expect(output.getPage(offset).getSize()).toEqual(source.getPage(index * 2 + offset).getSize());
    }
  }
  await page.screenshot({ path: 'test-results/sample-split.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('unmarked pages require explicit correction and preserve page order when split', async ({ page }) => {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 3; index++) pdf.addPage([400 + index * 10, 600]);
  await page.goto('/');
  await selectLocal(page, Buffer.from(await pdf.save()), 'Blank test.pdf');
  await expect(page.getByRole('alert')).toContainText('No QR markers found');
  await expect(page.locator('.unassigned-group')).toHaveCount(1);
  await page.locator('#front-1').check();
  await expect(page.getByRole('alert')).toContainText('Page 1');
  await page.getByRole('button', { name: 'Prepare 1 PDF', exact: true }).click();
  await expect(page.locator('.result-row')).toHaveCount(0);
  await page.locator('#front-0').check();
  await expect(page.locator('.exam-group')).toHaveCount(2);
  await expect(page.locator('.unassigned-group')).toHaveCount(0);
  await expect(page.locator('.exam-group').nth(0).locator('.page-index')).toHaveText(['1']);
  await expect(page.locator('.exam-group').nth(1).locator('.page-index')).toHaveText(['2', '3']);
  await page.getByRole('button', { name: 'Prepare 2 PDFs' }).click();
  await expect(page.locator('.result-row')).toHaveCount(2);
  const outputBytes = await page.locator('.result-row').nth(1).getByRole('link', { name: 'Download' }).evaluate(async anchor => {
    const data = await (await fetch((anchor as HTMLAnchorElement).href)).arrayBuffer();
    return Array.from(new Uint8Array(data));
  });
  const output = await PDFDocument.load(Uint8Array.from(outputBytes));
  expect(output.getPages().map(page => page.getWidth())).toEqual([410, 420]);
  await page.locator('#toggle-review').click();
  await page.locator('#front-1').uncheck();
  await expect(page.locator('.exam-group')).toHaveCount(1);
  await expect(page.locator('.exam-group .page-index')).toHaveText(['1', '2', '3']);
  await expect(page.locator('.result-row')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-review.png', fullPage: true });
  await page.getByRole('button', { name: 'View page 3', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Page 3', exact: true });
  await expect(preview.locator('canvas')).toBeVisible();
  expect(await preview.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(preview).toHaveCount(0);
});

test('invalid PDFs fail cleanly and scanning can be cancelled', async ({ page }) => {
  await page.goto('/');
  await page.locator('#local-pdf').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await page.getByRole('button', { name: 'Scan PDF', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not read this PDF');
  await expect(page.getByRole('button', { name: 'Scan PDF', exact: true })).toBeEnabled();
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 20; index++) pdf.addPage();
  await page.locator('#local-pdf').setInputFiles({ name: 'long.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByRole('button', { name: 'Scan PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel scan' }).click();
  await expect(page.getByRole('status')).toContainText('Scan cancelled');
  await expect(page.locator('.page-card')).toHaveCount(0);
});

test('thread setting is bounded and keywords alone do not mark front pages', async ({ page }) => {
  await page.goto('/');
  const threads = page.getByRole('spinbutton', { name: 'Scan threads' });
  await expect(threads).toHaveValue('2');
  await threads.fill('99');
  await threads.press('Tab');
  await expect(threads).toHaveValue('8');
  await threads.fill('0');
  await threads.press('Tab');
  await expect(threads).toHaveValue('1');
  const pdf = await PDFDocument.create();
  for (const keyword of ['LZK', 'Klausur', 'Klassenarbeit']) {
    pdf.addPage([600, 800]).drawText(keyword, { x: 50, y: 740, size: 24 });
  }
  await selectLocal(page, Buffer.from(await pdf.save()));
  await expect(page.locator('.page-card')).toHaveCount(3);
  await expect(page.locator('.page-card input:checked')).toHaveCount(0);
});

test('parallel scanning preserves order and ignores QR codes below the header', async ({ page }) => {
  test.skip(!existsSync(samplePath), 'Private example PDF is not present.');
  const source = await PDFDocument.load(await readFile(samplePath));
  const pdf = await PDFDocument.create();
  const [front] = await pdf.embedPages([source.getPage(0)]);
  const full = pdf.addPage([front.width, front.height]);
  full.drawPage(front);
  // Same real QR code, scaled and moved wholly below the detection region.
  pdf.addPage([front.width, front.height]).drawPage(front, {
    x: 0, y: 0, width: front.width * 0.7, height: front.height * 0.7,
  });
  pdf.addPage([front.width, front.height]).drawPage(front);
  await page.goto('/');
  await page.getByRole('spinbutton', { name: 'Scan threads' }).fill('4');
  await page.getByRole('spinbutton', { name: 'Scan threads' }).press('Tab');
  await selectLocal(page, Buffer.from(await pdf.save()));
  await expect(page.locator('.page-card')).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    await expect(page.locator(`#front-${index}`)).toBeChecked({ checked: index !== 1 });
    await expect(page.locator('.page-index').nth(index)).toHaveText(String(index + 1));
  }
});

test('cancelling active parallel workers releases previews and allows a fresh scan', async ({ page }) => {
  test.skip(!existsSync(samplePath), 'Private example PDF is not present.');
  await page.goto('/');
  const bytes = (await readFile(samplePath)).toString('base64');
  const result = await page.evaluate(async bytes => {
    const modulePath = '/src/pdf.ts';
    const { scanPdf } = await import(modulePath);
    const input = Uint8Array.from(atob(bytes), char => char.charCodeAt(0));
    const controller = new AbortController();
    const liveUrls = new Set<string>();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); liveUrls.add(url); return url; };
    URL.revokeObjectURL = url => { liveUrls.delete(url); revoke(url); };
    let errorName = '';
    try {
      await scanPdf(input, (completed: number) => {
        if (completed === 1) controller.abort();
      }, controller.signal, 2);
    } catch (error) { errorName = (error as Error).name; }
    const leaked = liveUrls.size;
    const fresh = await scanPdf(input, () => {}, new AbortController().signal, 1);
    fresh.forEach((p: { thumbnailUrl: string }) => URL.revokeObjectURL(p.thumbnailUrl));
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    return { errorName, leaked, markers: fresh.map((p: { hasQr: boolean }) => p.hasQr) };
  }, bytes);
  expect(result).toEqual({ errorName: 'AbortError', leaked: 0, markers: [true, false, true, false, true, false] });
});
