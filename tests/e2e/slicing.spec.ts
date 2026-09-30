import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

const samplePath = path.resolve('20260911_142302_005443.pdf');
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
  await page.locator('#front-1').check();
  await expect(page.getByRole('alert')).toContainText('Page 1');
  await page.getByRole('button', { name: 'Prepare 1 PDF', exact: true }).click();
  await expect(page.locator('.result-row')).toHaveCount(0);
  await page.locator('#front-0').check();
  await page.getByRole('button', { name: 'Prepare 2 PDFs' }).click();
  await expect(page.locator('.result-row')).toHaveCount(2);
  const outputBytes = await page.locator('.result-row').nth(1).getByRole('link', { name: 'Download' }).evaluate(async anchor => {
    const data = await (await fetch((anchor as HTMLAnchorElement).href)).arrayBuffer();
    return Array.from(new Uint8Array(data));
  });
  const output = await PDFDocument.load(Uint8Array.from(outputBytes));
  expect(output.getPages().map(page => page.getWidth())).toEqual([410, 420]);
  await page.locator('#front-1').uncheck();
  await expect(page.locator('.result-row')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-review.png', fullPage: true });
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
