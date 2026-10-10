import { test, expect } from '@playwright/test';
import { mockGoogleUi } from './googleMock';

test('header connection gates tasks through pending, partial, cancelled, and successful authorization', async ({ page }) => {
  await mockGoogleUi(page);
  await page.addInitScript(() => Object.assign(window, { __mockHoldAuthorization: true }));
  await page.goto('/');
  const tabs = page.getByRole('tab');
  for (const tab of await tabs.all()) await expect(tab).toBeDisabled();
  for (const id of ['workflow-course', 'workflow-csv', 'workflow-test']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Connect to start' })).toBeVisible();
  const connect = page.locator('#connect');
  await expect(connect).toBeEnabled();
  const connectionBox = (await connect.boundingBox())!, courseBox = (await page.locator('#workflow-course').boundingBox())!;
  expect(connectionBox.x + connectionBox.width).toBeLessThan(courseBox.x);
  await page.screenshot({ path: 'test-results/connection-before-desktop.png', fullPage: true });
  await connect.click();
  await expect(connect).toHaveText('Connecting…');
  await expect(connect).toBeDisabled();
  const requested = await page.evaluate(() => (window as unknown as { __mockRequestedScopes: string[] }).__mockRequestedScopes);
  expect(requested).toHaveLength(1);
  for (const scope of ['drive.file', 'drive', 'gmail.compose', 'gmail.modify']) expect(requested[0].split(' ')).toContain(`https://www.googleapis.com/auth/${scope}`);
  await page.evaluate(() => (window as unknown as { __mockAuthorize: (response?: unknown) => void }).__mockAuthorize({ access_token: 'partial-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive' }));
  await expect(connect).toBeEnabled();
  await expect(page.getByRole('alert')).toContainText('Grant Drive and Gmail permissions');
  for (const tab of await tabs.all()) await expect(tab).toBeDisabled();
  await connect.click();
  await page.evaluate(() => (window as unknown as { __mockAuthorize: (response?: unknown) => void }).__mockAuthorize({ error: 'access_denied' }));
  await expect(connect).toBeEnabled();
  for (const tab of await tabs.all()) await expect(tab).toBeDisabled();
  await connect.click();
  await page.evaluate(() => (window as unknown as { __mockAuthorize: () => void }).__mockAuthorize());
  await expect(connect).toHaveText('Disconnect');
  for (const tab of await tabs.all()) await expect(tab).toBeEnabled();
  for (const name of ['Slice exams', 'Match students', 'Create documentation', 'Prepare emails', 'Batch send']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.locator('[id$="-access"]')).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/connection-after-mobile.png', fullPage: true });
  await connect.click();
  for (const tab of await tabs.all()) await expect(tab).toBeDisabled();
  await expect(page.locator('#workflow-course')).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Connect to start' })).toBeVisible();
});

test('a cached session with old permissions requires upgrading through Connect', async ({ page }) => {
  await mockGoogleUi(page);
  await page.addInitScript(() => sessionStorage.setItem('edu-test-manager-token', JSON.stringify({
    accessToken: 'old-session-token', expiresAt: Date.now() + 3600000, scope: 'https://www.googleapis.com/auth/drive.file',
  })));
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Slice exams', exact: true })).toBeDisabled();
  await page.locator('#connect').click();
  await expect(page.getByRole('tab', { name: 'Slice exams', exact: true })).toBeEnabled();
  await expect(page.locator('#connect')).toHaveText('Disconnect');
});
