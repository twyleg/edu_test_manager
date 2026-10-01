import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mockGoogleUi } from '../e2e/googleMock';

test('Pages subpath serves fonts, workers, privacy, and the Picker relay', async ({ page, request }) => {
  await mockGoogleUi(page);
  const failed: string[] = [];
  const fonts: string[] = [];
  page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
  page.on('request', request => { if (request.url().endsWith('.woff2')) fonts.push(request.url()); });
  await page.goto('./');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('tab', { name: 'Slice exams' })).toBeVisible();
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every(url => new URL(url).pathname.startsWith('/edu_test_manager/assets/'))).toBe(true);
  await page.locator('#choose-pdf').click();
  await expect(page.locator('#panel-slice')).toContainText('Drive exam.pdf');
  const relay = await page.evaluate(() => (window as unknown as { __mockPickerRelayUrl: string }).__mockPickerRelayUrl);
  expect(new URL(relay).pathname).toBe('/edu_test_manager/google-picker-relay.html');
  expect((await request.get(relay)).ok()).toBe(true);
  for (const path of ['privacy.html', 'fonts/DM-Sans-LICENSE.txt', 'fonts/Manrope-LICENSE.txt']) expect((await request.get(path)).ok()).toBe(true);
  const pdf = await PDFDocument.create(); pdf.addPage();
  await page.locator('#local-pdf').setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByRole('button', { name: 'Scan PDF', exact: true }).click();
  await expect(page.locator('#toggle-review')).toHaveAttribute('aria-expanded', 'true', { timeout: 30000 });
  expect(failed).toEqual([]);
});
