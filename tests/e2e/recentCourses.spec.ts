import { test, expect } from '@playwright/test';
import { mockGoogleUi } from './googleMock';

const folder = (id: string, name: string) => ({
  id,
  name,
  mimeType: 'application/vnd.google-apps.folder',
});

test('recent courses switch without Picker, persist, and stay accessible on mobile', async ({
  page,
}) => {
  await mockGoogleUi(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('edu-test-manager-workflow-v1')) {
      const folder = (id: string, name: string) => ({
        id,
        name,
        mimeType: 'application/vnd.google-apps.folder',
      });
      localStorage.setItem(
        'edu-test-manager-workflow-v1',
        JSON.stringify({
          course: folder('course-a', 'Physics 8a'),
          test: folder('test-a', '01_Test A'),
          recentCourses: [folder('course-a', 'Physics 8a'), folder('course-b', 'Computing 9b')],
        }),
      );
    }
    Object.assign(window, { __mockFolderSelections: [{ id: 'course-c', name: 'Physics 10c' }] });
  });
  await page.route('https://www.googleapis.com/drive/v3/files?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    const course = ['a', 'b', 'c'].find((id) => query.includes(`'course-${id}'`));
    const category = ['a', 'b', 'c'].find((id) => query.includes(`'lzks-${id}'`));
    const files = course
      ? [folder(`lzks-${course}`, 'LZKs'), folder(`klausuren-${course}`, 'Klausuren')]
      : category
        ? [folder(`test-${category}`, `01_Test ${category.toUpperCase()}`)]
        : [];
    await route.fulfill({ json: { files } });
  });
  await page.route(/https:\/\/www.googleapis.com\/drive\/v3\/files\/course-[abc]\?/, (route) =>
    route.fulfill({ json: { ...folder('course', 'Course'), parents: [] } }),
  );

  await page.goto('/');
  await page.locator('#connect').click();
  await expect(page.locator('#workflow-course')).toBeEnabled();
  await page.locator('#workflow-course').click();
  await expect(page.locator('#course-choice-0')).toBeFocused();
  await expect(page.locator('#course-choice-0')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#course-choice-0').click();
  await expect(page.locator('#workflow-test')).toContainText('01_Test A');

  await page.locator('#workflow-course').click();
  await page.getByRole('button', { name: 'Computing 9b', exact: true }).click();
  await expect(page.locator('#workflow-course')).toContainText('Computing 9b');
  await expect(page.locator('#workflow-course')).toBeEnabled();
  await expect(page.locator('#workflow-course')).toBeFocused();
  await expect(page.locator('#workflow-test')).toContainText('Choose…');
  expect(await page.evaluate(() => '__mockPickerRelayUrl' in window)).toBe(false);
  await page.locator('#workflow-test').click();
  await expect(page.locator('#test-choice-0')).toContainText('01_Test B');

  await page.locator('#workflow-course').click();
  await expect(page.locator('#workflow-test-menu')).toBeHidden();
  await page.locator('#course-pick').click();
  await expect(page.locator('#workflow-course')).toContainText('Physics 10c');
  await expect(page.locator('#workflow-course')).toBeEnabled();
  await page.reload();
  await expect(page.locator('#workflow-course')).toBeEnabled();
  await page.locator('#workflow-course').click();
  await expect(page.locator('#workflow-course-menu .test-menu-choice strong')).toHaveText([
    'Physics 10c',
    'Computing 9b',
    'Physics 8a',
  ]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#workflow-course-menu')).toBeHidden();
  await expect(page.locator('#workflow-course')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workflow-course').click();
  const bounds = await page.locator('#workflow-course-menu').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/recent-courses-mobile.png', fullPage: true });
  await page.locator('.topbar').click({ position: { x: 1, y: 1 } });
  await expect(page.locator('#workflow-course-menu')).toBeHidden();
  await page.locator('#task-slice').click();
  await page.locator('#workflow-course').click();
  await page.locator('#privacy-settings').click();
  await page.locator('#privacy-google').click();
  expect(
    await page.evaluate(() => localStorage.getItem('edu-test-manager-workflow-v1')),
  ).toBeNull();
});
