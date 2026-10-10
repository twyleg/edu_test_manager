import { test, expect } from '@playwright/test';
import { mockGoogleUi } from './googleMock';

const folder = (id: string, name: string) => ({
  id,
  name,
  mimeType: 'application/vnd.google-apps.folder',
});

test('student lists switch directly, preserve the test, and remember Picker selections', async ({
  page,
}) => {
  await mockGoogleUi(page, true);
  await page.addInitScript(() => {
    if (!localStorage.getItem('edu-test-manager-workflow-v1')) {
      const folder = (id: string, name: string) => ({
        id,
        name,
        mimeType: 'application/vnd.google-apps.folder',
      });
      const csv = (id: string, name: string) => ({ id, name, mimeType: 'text/csv' });
      localStorage.setItem(
        'edu-test-manager-workflow-v1',
        JSON.stringify({
          course: folder('course', 'Physics 8a'),
          test: folder('test', '01_Test'),
          csv: csv('csv-a', '8a.csv'),
          recentStudentLists: [csv('csv-a', '8a.csv'), csv('csv-b', '8b.csv')],
        }),
      );
      localStorage.setItem('edu-test-manager-student-list-folder', 'roster-folder');
    }
  });
  await page.route('https://www.googleapis.com/drive/v3/files?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    const files = query.includes("'course'")
      ? [folder('lzks', 'LZKs'), folder('klausuren', 'Klausuren')]
      : query.includes("'lzks'")
        ? [folder('test', '01_Test')]
        : query.includes("'test'")
          ? [folder('split', '03_Split'), folder('previews', '04_Previews')]
          : [];
    await route.fulfill({ json: { files } });
  });
  await page.route('https://www.googleapis.com/drive/v3/files/course?*', (route) =>
    route.fulfill({ json: { ...folder('course', 'Physics 8a'), parents: [] } }),
  );

  await page.goto('/');
  await page.locator('#connect').click();
  await expect(page.locator('#workflow-csv')).toBeEnabled();
  await page.locator('#workflow-csv').click();
  await expect(page.locator('#student-list-choice-0')).toBeFocused();
  await expect(page.locator('#student-list-choice-0')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '8b.csv', exact: true }).click();
  await expect(page.locator('#workflow-csv')).toContainText('8b.csv');
  await expect(page.locator('#workflow-csv')).toBeFocused();
  await expect(page.locator('#workflow-course')).toContainText('Physics 8a');
  await expect(page.locator('#workflow-test')).toContainText('01_Test');
  expect(await page.evaluate(() => '__mockPickerRelayUrl' in window)).toBe(false);
  await page.locator('#task-match').click();
  await expect(page.locator('#match-setup-body')).toContainText('Student list: 8b.csv');
  await page.locator('#task-drafts').click();
  await expect(page.locator('#draft-setup-body')).toContainText('8b.csv');

  await page.locator('#workflow-csv').click();
  await page.locator('#student-list-pick').click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __mockPickerParents: string[] }).__mockPickerParents[0],
    ),
  ).toBe('roster-folder');
  let picker = page.getByRole('dialog', { name: 'Choose a student CSV' });
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#workflow-csv')).toContainText('8b.csv');
  await page.locator('#workflow-csv').click();
  await page.locator('#student-list-pick').click();
  picker = page.getByRole('dialog', { name: 'Choose a student CSV' });
  await picker.getByRole('button', { name: 'students.csv', exact: true }).click();
  await picker.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.locator('#workflow-csv')).toContainText('students.csv');
  await page.reload();
  await expect(page.locator('#workflow-csv')).toBeEnabled();
  await page.locator('#workflow-csv').click();
  await expect(page.locator('#workflow-student-menu .test-menu-choice strong')).toHaveText([
    'students.csv',
    '8b.csv',
    '8a.csv',
  ]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#workflow-student-menu')).toBeHidden();
  await expect(page.locator('#workflow-csv')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workflow-csv').click();
  const bounds = await page.locator('#workflow-student-menu').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/recent-student-lists-mobile.png', fullPage: true });
  await page.locator('#workflow-course').click();
  await expect(page.locator('#workflow-student-menu')).toBeHidden();
  await expect(page.locator('#workflow-course-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#privacy-settings').click();
  await page.locator('#privacy-google').click();
  expect(
    await page.evaluate(() => localStorage.getItem('edu-test-manager-workflow-v1')),
  ).toBeNull();
  await page.reload();
  await expect(page.locator('#workflow-csv')).toBeEnabled();
  await page.locator('#workflow-csv').click();
  await expect(page.locator('#workflow-student-menu')).toContainText('No recent student lists yet');
});
