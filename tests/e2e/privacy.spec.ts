import { test, expect } from '@playwright/test';
import { mockGoogleUi } from './googleMock';

test('Google stays blocked until chosen; fonts are local and folder remembering can be disabled', async ({ page }) => {
  await mockGoogleUi(page, false, 'application/octet-stream', 1, false);
  const external: string[] = [];
  const fontUrls: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') external.push(url.href);
    if (url.pathname.endsWith('.woff2')) fontUrls.push(url.href);
  });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('#privacy-title')).toBeVisible();
  expect(external).toEqual([]);
  expect(fontUrls.length).toBeGreaterThan(0);
  expect(fontUrls.every(url => new URL(url).hostname === '127.0.0.1')).toBe(true);
  await expect(page.locator('#connect')).toBeDisabled();
  await page.locator('#privacy-remember').click();
  await expect(page.locator('#connect')).toBeEnabled();
  expect(external.some(url => url.includes('accounts.google.com'))).toBe(true);
  await page.locator('#connect').click();
  await page.getByRole('tab', { name: 'Match students', exact: true }).click();
  await page.locator('#match-csv').click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('edu-test-manager-student-list-folder'))).toBe('student-list-folder');
  await page.evaluate(() => localStorage.setItem('edu-test-manager-documentation-highlights-v1', JSON.stringify({ course: { points: { x: .1, y: .1, width: .4, height: .2 } } })));
  await page.locator('#privacy-settings').click();
  await page.locator('#privacy-google').click();
  expect(await page.evaluate(() => localStorage.getItem('edu-test-manager-student-list-folder'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('edu-test-manager-documentation-highlights-v1'))).toBeNull();
  await page.locator('#match-csv').click();
  await expect(page.locator('#match-setup-body')).toContainText('students.csv');
  expect(await page.evaluate(() => localStorage.getItem('edu-test-manager-student-list-folder'))).toBeNull();
  await page.locator('#privacy-settings').click();
  await page.locator('#privacy-local').click();
  await expect(page.locator('#connect')).toBeDisabled();
  external.length = 0;
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem('edu-test-manager-token'))).toBeNull();
  await expect(page.locator('#local-pdf')).toBeEnabled();
});

test('local-only choice and privacy notice are available without contacting Google', async ({ page }) => {
  await mockGoogleUi(page, false, 'application/octet-stream', 1, false);
  const external: string[] = [];
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  await page.goto('/');
  await page.locator('#privacy-local').click();
  await expect(page.locator('#local-pdf')).toBeEnabled();
  await page.goto('/privacy.html');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy');
  expect(external).toEqual([]);
});
