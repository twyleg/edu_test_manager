import { test, expect } from '@playwright/test';
import { mockGoogleUi } from './googleMock';

test.beforeEach(async ({ page }) => { await mockGoogleUi(page, true); });

test('accepts PDF and folder selections after the picker has opened', async ({ page }) => {
  const pickerEvents: string[] = [];
  page.on('console', message => { if (message.text().startsWith('[Drive Picker]')) pickerEvents.push(message.text()); });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('button', { name: 'Choose PDF from Drive' }).click();
  const relayUrl = await page.evaluate(() => (window as unknown as { __mockPickerRelayUrl: string }).__mockPickerRelayUrl);
  expect(relayUrl).toBe(new URL('/google-picker-relay.html', page.url()).href);
  const relayResponse = await page.request.get(relayUrl);
  expect(relayResponse.status()).toBe(200);
  expect(relayResponse.headers()['content-type']).toContain('text/html');
  expect(await relayResponse.text()).not.toMatch(/<script|src\/main/);
  let dialog = page.getByRole('dialog');
  await expect(page.getByRole('button', { name: 'Choose PDF from Drive' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Drive exam.pdf' }).click();
  await dialog.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.locator('#panel-slice .file-selection').first()).toContainText('Drive exam.pdf');
  await expect(page.getByRole('button', { name: 'Scan PDF', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Choose Drive folder' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Select', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Physics class' }).click();
  await dialog.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.locator('#panel-slice .file-selection').nth(1)).toContainText('Physics class');
  await expect(page.getByRole('button', { name: 'Choose Drive folder' })).toBeEnabled();
  expect(pickerEvents.filter(event => event.includes('Selection accepted'))).toHaveLength(2);
  expect(pickerEvents.some(event => event.includes('loaded'))).toBe(true);
  expect(pickerEvents.join('\n')).not.toMatch(/browser-test-token|source-pdf|destination-folder|Drive exam\.pdf|Physics class/);
});

test('empty selection displays an error and cancel releases the controls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('button', { name: 'Choose PDF from Drive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Simulate empty selection' }).click();
  await expect(page.getByRole('alert')).toContainText('Google Picker returned no selected item');
  await page.getByRole('button', { name: 'Choose PDF from Drive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose PDF from Drive' })).toBeEnabled();
  await expect(page.locator('#panel-slice .file-selection').first()).toContainText('No PDF selected');
});

test('remembers the student CSV folder across tasks and reloads without changing other pickers', async ({ page }) => {
  await mockGoogleUi(page, true);
  const parents = () => page.evaluate(() => (window as unknown as { __mockPickerParents: (string | null)[] }).__mockPickerParents);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('tab', { name: 'Match students', exact: true }).click();
  await page.locator('#match-csv').click();
  expect((await parents())[0]).toBe('root');
  let dialog = page.getByRole('dialog', { name: 'Choose a student CSV' });
  await dialog.getByRole('button', { name: 'students.csv', exact: true }).click();
  await dialog.getByRole('button', { name: 'Select', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('edu-test-manager-student-list-folder'))).toBe('student-list-folder');
  await page.reload();
  await page.getByRole('tab', { name: 'Prepare drafts', exact: true }).click();
  await page.locator('#draft-csv').click();
  expect(await parents()).toEqual(['student-list-folder', 'root', null]);
  dialog = page.getByRole('dialog', { name: 'Choose a student CSV' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#draft-folder').click();
  expect((await parents())[0]).toBe('root');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('edu-test-manager-student-list-folder'))).toBe('student-list-folder');
});
