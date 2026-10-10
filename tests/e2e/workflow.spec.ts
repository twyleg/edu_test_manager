import { test, expect } from '@playwright/test';
import { mockGoogleUi } from './googleMock';

const folder = (id: string, name: string) => ({
  id,
  name,
  mimeType: 'application/vnd.google-apps.folder',
});
test('saved workflow derives folders and switches between preview and final drafts', async ({
  page,
}) => {
  await mockGoogleUi(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'edu-test-manager-workflow-v1',
      JSON.stringify({
        input: { id: 'input', name: 'Scanner', mimeType: 'application/vnd.google-apps.folder' },
        course: { id: 'course', name: '8a', mimeType: 'application/vnd.google-apps.folder' },
        csv: { id: 'students', name: '8a.csv', mimeType: 'text/csv' },
        test: { id: 'test', name: '01_Test', mimeType: 'application/vnd.google-apps.folder' },
      }),
    );
  });
  await page.route('https://www.googleapis.com/drive/v3/files?*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const files = q.includes("'course'")
      ? [folder('lzks', 'LZKs'), folder('ka', 'Klausuren')]
      : q.includes("'lzks'")
        ? [folder('test', '01_Test')]
        : q.includes("'test'")
          ? [
              folder('corrected', '02_Korrigiert'),
              folder('split', '03_Split'),
              folder('previews', '04_Previews'),
            ]
          : q.includes("'alternate-input'")
            ? [
                {
                  id: 'alternate-pdf',
                  name: 'Another corrected exam.pdf',
                  mimeType: 'application/pdf',
                },
              ]
            : q.includes("'matching-input'")
              ? [
                  {
                    id: 'matching-pdf',
                    name: 'Individual exam from custom input.pdf',
                    mimeType: 'application/pdf',
                  },
                ]
              : q.includes("'corrected'")
                ? [
                    { id: 'pdf', name: 'Corrected exam.pdf', mimeType: 'application/pdf' },
                    {
                      id: 'second-pdf',
                      name: 'Second corrected exam.pdf',
                      mimeType: 'application/pdf',
                    },
                  ]
                : [];
    await route.fulfill({ json: { files } });
  });
  await page.route('https://www.googleapis.com/drive/v3/files/students?*', (route) =>
    route.fulfill({
      body: 'Nr.;Nachname;Vorname;E-Mail-Adresse\n1;Müller;Anna;anna@example.org',
      contentType: 'text/csv',
    }),
  );
  await page.route('https://www.googleapis.com/drive/v3/files/course?*', (route) =>
    route.fulfill({ json: { ...folder('course', '8a'), parents: [] } }),
  );
  await page.goto('/');
  await page.locator('#connect').click();
  await expect(page.locator('.topbar #workflow-input')).toHaveCount(0);
  await expect(page.locator('#prep-input')).toContainText('Choose PDF from Drive');
  await expect(page.locator('.topbar #workflow-csv')).toContainText('8a.csv');
  await expect(page.locator('.topbar #workflow-course')).toContainText('8a');
  await page.locator('#workflow-test').click();
  await expect(page.locator('.topbar #workflow-test')).toContainText('01_Test');
  await expect(page.locator('#workflow-test')).toBeEnabled();
  if ((await page.locator('#workflow-test').getAttribute('aria-expanded')) === 'false') {
    await page.locator('#workflow-test').click();
  }
  await expect(page.locator('#test-choice-0')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#test-clear').click();
  await expect(page.locator('#workflow-test')).toBeEnabled();
  await page.locator('#workflow-test').click();
  await page.locator('#test-choice-0').click();
  await expect(page.locator('#workflow-test-menu')).toBeHidden();
  await expect(page.locator('#workflow-test')).toBeFocused();
  await page.locator('#workflow-test').click();
  await page.locator('#workflow-refresh').click();
  await expect(page.locator('#workflow-refresh')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#workflow-test-menu')).toBeHidden();
  await expect(page.locator('#workflow-test')).toBeFocused();
  await page.getByRole('tab', { name: 'Slice exams' }).click();
  await expect(page.locator('#slice-file')).toHaveCount(0);
  await expect(page.locator('#slice-file-list')).toBeVisible();
  await expect(page.locator('#slice-file-list .test-menu-choice')).toHaveCount(2);
  await expect(page.locator('#slice-file-list')).not.toContainText('Choose a corrected PDF');
  await page.locator('[data-slice-file-id="second-pdf"]').click();
  await expect(page.locator('[data-slice-file-id="second-pdf"]')).toBeFocused();
  await expect(page.locator('[data-slice-file-id="second-pdf"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#slice-file-list')).toBeVisible();
  await page.getByRole('button', { name: 'Choose files & scan' }).click();
  await expect(page.locator('#slice-file-list')).toBeHidden();
  await page.getByRole('button', { name: 'Choose files & scan' }).click();
  await expect(page.locator('#slice-file-list')).toBeVisible();
  await page.locator('[data-slice-file-id="pdf"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-slice-file-id="pdf"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-slice-file-id="second-pdf"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('tabpanel')).toContainText('Corrected exam.pdf');
  await expect(page.getByRole('tabpanel')).toContainText('03_Split');
  await page.getByRole('tab', { name: 'Match students' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('03_Split');
  await expect(page.getByRole('tabpanel')).toContainText('8a.csv');
  await expect(page.getByRole('button', { name: 'Change input folder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change output folder' })).toBeVisible();
  await expect(page.locator('#match-setup-body')).toContainText('04_Previews');
  await expect(page.locator('#match-csv')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Prepare emails' }).click();
  await expect(page.locator('#draft-mode-final')).toBeChecked();
  await expect(page.locator('#draft-folder')).toHaveCount(0);
  await expect(page.locator('#draft-csv')).toHaveCount(0);
  await page.locator('#draft-mode-preview').check();
  await expect(page.getByRole('tabpanel')).toContainText('04_Previews');
  await page.screenshot({ path: 'test-results/draft-mode-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/draft-mode-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#draft-mode-final').check();
  await expect(page.getByRole('tabpanel')).toContainText('03_Split');
  await page.getByRole('tab', { name: 'Slice exams' }).click();
  await expect(page.locator('#choose-pdf')).toHaveCount(0);
  await expect(page.locator('#new-folder')).toHaveCount(0);
  await page.evaluate(() =>
    Object.assign(window, {
      __mockFolderSelections: [
        { id: 'alternate-input', name: 'Other corrected scans' },
        { id: 'alternate-output', name: 'Other split exams' },
      ],
    }),
  );
  await page.getByRole('button', { name: 'Change input folder' }).click();
  await expect(page.locator('#slice-file-list .test-menu-choice')).toHaveCount(1);
  await expect(page.locator('#slice-file-list')).toContainText('Another corrected exam.pdf');
  await page.locator('[data-slice-file-id="alternate-pdf"]').click();
  await page.getByRole('button', { name: 'Change output folder' }).click();
  await page.getByRole('tab', { name: 'Match students' }).click();
  await page.getByRole('tab', { name: 'Slice exams' }).click();
  await expect(page.locator('.slice-source')).toContainText('Other corrected scans');
  await expect(page.locator('.slice-destination')).toContainText('Other split exams');
  await expect(page.locator('[data-slice-file-id="alternate-pdf"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: 'test-results/slice-folders-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/slice-folders-mobile.png', fullPage: true });
  const listBounds = await page.locator('#slice-file-list').boundingBox();
  expect(listBounds).not.toBeNull();
  expect(listBounds!.x).toBeGreaterThanOrEqual(0);
  expect(listBounds!.x + listBounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#workflow-test').click();
  await page.locator('#test-clear').click();
  await expect(page.locator('#workflow-test')).toBeEnabled();
  await page.locator('#workflow-test').click();
  await page.locator('#test-choice-0').click();
  await expect(page.locator('.slice-source')).toContainText('02_Korrigiert');
  await expect(page.locator('.slice-destination')).toContainText('03_Split');
  await expect(page.locator('#slice-file-list [aria-pressed="true"]')).toHaveCount(0);
  await page.evaluate(() =>
    Object.assign(window, {
      __mockFolderSelections: [{ id: 'empty-input', name: 'Empty corrected scans' }],
    }),
  );
  await page.getByRole('button', { name: 'Change input folder' }).click();
  await expect(page.locator('#slice-file-list')).toContainText('No PDFs available in this folder.');
  await expect(page.locator('#slice-file-list .test-menu-choice')).toHaveCount(0);
  await expect(page.locator('#scan')).toBeDisabled();
  await page.evaluate(() =>
    Object.assign(window, {
      __mockFolderSelections: [{ id: 'corrected', name: '02_Korrigiert' }],
    }),
  );
  await page.getByRole('button', { name: 'Change input folder' }).click();
  await page.getByRole('tab', { name: 'Match students' }).click();
  await page.evaluate(() =>
    Object.assign(window, {
      __mockFolderSelections: [
        { id: 'matching-input', name: 'Custom individual exams' },
        { id: 'matching-output', name: 'Custom previews' },
      ],
    }),
  );
  await page.getByRole('button', { name: 'Change input folder' }).click();
  await expect(page.locator('#match-setup-body')).toContainText('Custom individual exams');
  await page.getByRole('button', { name: 'Change output folder' }).click();
  await expect(page.locator('#match-setup-body')).toContainText('Custom previews');
  await page.locator('#match-load').click();
  await expect(page.locator('.matching-file-list')).toContainText(
    'Individual exam from custom input.pdf',
  );
  await page.locator('#match-setup').click();
  await page.getByRole('tab', { name: 'Prepare emails' }).click();
  await page.getByRole('tab', { name: 'Match students' }).click();
  await expect(page.locator('#match-setup-body')).toContainText('Custom individual exams');
  await expect(page.locator('#match-setup-body')).toContainText('Custom previews');
  await page.screenshot({ path: 'test-results/matching-folders-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: 'test-results/matching-folders-desktop.png', fullPage: true });
  await page.locator('#workflow-test').click();
  await page.locator('#test-clear').click();
  await page.locator('#workflow-test').click();
  await page.locator('#test-choice-0').click();
  await expect(page.locator('#match-setup-body')).toContainText('03_Split');
  await expect(page.locator('#match-setup-body')).toContainText('04_Previews');
  await expect(page.locator('#match-setup-body')).not.toContainText('Custom');
  await page.reload();
  await expect(page.locator('.topbar #workflow-course')).toContainText('8a');
});

test('topbar selections stay compact and accessible on mobile', async ({ page }) => {
  await mockGoogleUi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#connect').click();
  await expect(page.locator('#prep-input')).toBeVisible();
  await page.locator('#workflow-csv').click();
  await expect(page.locator('#workflow-student-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  for (const key of ['csv', 'course']) {
    await expect(page.locator(`.topbar #workflow-${key}`)).toBeVisible();
  }
  await expect(page.locator('.topbar #workflow-test')).toBeVisible();
  await page.locator('#workflow-test').click();
  await expect(page.locator('#workflow-test-menu')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/workflow-topbar-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/workflow-topbar-desktop.png', fullPage: true });
  await page.locator('.brand').focus();
  await expect(page.locator('#workflow-test-menu')).toBeHidden();
});
