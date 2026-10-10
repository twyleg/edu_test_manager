import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

test('independent task tabs preserve a batch and subtasks advance on completion', async ({
  page,
}) => {
  await mockGoogleUi(page);
  await page.goto('/');
  await page.locator('#connect').click();
  await expect(page.getByRole('tab', { name: 'Import scans', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Slice exams' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#toggle-review')).toBeDisabled();
  await page.getByRole('tab', { name: 'Match students' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('folder of already-sliced exams');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Create documentation' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Record points');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Prepare emails' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Create a Gmail draft');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Import scans', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const pdf = await PDFDocument.create();
  pdf.addPage();
  await page.locator('#local-pdf').setInputFiles({
    name: 'tabs.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByRole('button', { name: 'Scan PDF', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Scan complete');
  await expect(page.locator('#toggle-setup')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#toggle-review')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#toggle-review')).toBeFocused();
  await page.locator('#front-0').check();
  await page.getByRole('tab', { name: 'Match students' }).click();
  await page.getByRole('tab', { name: 'Slice exams' }).click();
  await expect(page.locator('#front-0')).toBeChecked();
  await page.getByRole('button', { name: 'Prepare 1 PDF', exact: true }).click();
  await expect(page.locator('#toggle-review')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#toggle-save')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#toggle-save')).toBeFocused();
  await page.locator('#toggle-review').click();
  await expect(page.locator('#front-0')).toBeVisible();
  await page.screenshot({ path: 'test-results/task-subtasks.png', fullPage: true });
  await page.getByRole('button', { name: 'Start a new batch' }).click();
  await expect(page.locator('#toggle-setup')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#toggle-review')).toBeDisabled();
});

test('active scanning mutes setup and focuses progress; cancellation restores setup', async ({
  page,
}) => {
  await mockGoogleUi(page);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/src/qr.worker.ts*', async (route) => {
    await hold;
    await route.continue();
  });
  await page.goto('/');
  await page.locator('#connect').click();
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 5; i++) {
    pdf.addPage();
  }
  await page.locator('#local-pdf').setInputFiles({
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByRole('button', { name: 'Scan PDF', exact: true }).click();
  await expect(page.locator('.subtask-busy')).toHaveCount(1);
  await expect(page.locator('#task-progress')).toBeFocused();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Match students' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel scan' }).click();
  release();
  await expect(page.getByRole('status')).toContainText('Scan cancelled');
  await expect(page.locator('#toggle-setup')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#toggle-setup')).toBeFocused();
  await expect(page.locator('.subtask-busy')).toHaveCount(0);
});
