import { test, expect } from '@playwright/test';
import { mockGoogleUi } from './googleMock';

test.beforeEach(async ({ page }) => { await mockGoogleUi(page); });

test('creates a folder in My Drive and selects it as the output destination', async ({ page }) => {
  let writes = 0;
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/generateIds')) return route.fulfill({ json: { ids: ['new-folder-id'] } });
    if (url.pathname.endsWith('/new-folder-id')) return route.fulfill({ status: 404, json: {} });
    expect(request.method()).toBe('POST');
    expect(request.postDataJSON()).toEqual({ id: 'new-folder-id', name: 'Physics exams', mimeType: 'application/vnd.google-apps.folder' });
    writes++;
    await route.fulfill({ json: { id: 'new-folder-id', name: 'Physics exams', mimeType: 'application/vnd.google-apps.folder' } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a new folder' });
  await expect(dialog).toContainText('Inside My Drive');
  await dialog.getByLabel('Folder name').fill('   ');
  await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  expect(writes).toBe(0);
  await dialog.getByLabel('Folder name').fill(' Physics exams ');
  await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.file-selection').nth(1)).toContainText('Physics exams');
  expect(writes).toBe(1);
});

test('creates inside the selected parent and recovers a lost response without duplicates', async ({ page }) => {
  let created = false;
  let writes = 0;
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/destination-folder')) return route.fulfill({ json: {
      mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true },
    } });
    if (url.pathname.endsWith('/generateIds')) return route.fulfill({ json: { ids: ['child-id'] } });
    if (url.pathname.endsWith('/child-id')) return route.fulfill({ status: created ? 200 : 404,
      json: created ? { id: 'child-id', name: 'September', mimeType: 'application/vnd.google-apps.folder' } : {},
    });
    expect(request.method()).toBe('POST');
    expect(request.postDataJSON().parents).toEqual(['destination-folder']);
    writes++;
    created = true;
    await route.abort('failed');
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Drive folder' }).click();
  await expect(page.locator('.file-selection').nth(1)).toContainText('Physics class');
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Inside Physics class');
  await dialog.getByLabel('Folder name').fill('September');
  await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Check your connection and retry');
  await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.file-selection').nth(1)).toContainText('September');
  expect(writes).toBe(1);
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.file-selection').nth(1)).toContainText('September');
});
