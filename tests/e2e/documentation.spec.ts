import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

const folder = (id: string, name: string) => ({
  id,
  name,
  mimeType: 'application/vnd.google-apps.folder',
});
async function setup(
  page: Page,
  initial?: string,
  loseResponse = false,
  beforeDownload?: (id: string) => Promise<void>,
) {
  await mockGoogleUi(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'edu-test-manager-workflow-v1',
      JSON.stringify({
        course: { id: 'course', name: '8a', mimeType: 'application/vnd.google-apps.folder' },
        csv: { id: 'students', name: '8a.csv', mimeType: 'text/csv' },
        test: { id: 'test', name: '01_Test', mimeType: 'application/vnd.google-apps.folder' },
      }),
    );
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          Object.assign(window, { __copiedResults: text });
        },
      },
    });
  });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595, 842]).drawText('Points: 17,5  Mark: 2+', { x: 320, y: 790, size: 16, font });
  const bytes = Buffer.from(await pdf.save());
  let saved = initial;
  let resultId = initial === undefined ? '' : 'existing-results';
  const writes: { method: string; id: string; parent?: string; content: string }[] = [];
  const downloads: string[] = [];
  await page.route('https://www.googleapis.com/drive/v3/files?*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const files = q.includes("'course'")
      ? [
          folder('lzks', 'LZKs'),
          folder('ka', 'Klausuren'),
          ...(resultId
            ? [{ id: resultId, name: 'results.json', mimeType: 'application/json' }]
            : []),
        ]
      : q.includes("'lzks'")
        ? [folder('test', '01_Test')]
        : q.includes("'test'")
          ? [
              folder('corrected', '02_Korrigiert'),
              folder('split', '03_Split'),
              folder('previews', '04_Previews'),
            ]
          : q.includes("'split'")
            ? [
                {
                  id: 'anna',
                  name: '01_Müller_Anna.pdf',
                  mimeType: 'application/pdf',
                  md5Checksum: 'anna-content',
                },
                {
                  id: 'ben',
                  name: '02_Schmidt_Ben.pdf',
                  mimeType: 'application/pdf',
                  md5Checksum: 'ben-content',
                },
              ]
            : [];
    await route.fulfill({ json: { files } });
  });
  await page.route('https://www.googleapis.com/drive/v3/files/*?*', async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').at(-1)!;
    if (id === 'generateIds') {
      return route.fulfill({ json: { ids: ['new-results'] } });
    }
    if (id === 'course') {
      return route.fulfill({
        json: { ...folder('course', '8a'), parents: [], capabilities: { canAddChildren: true } },
      });
    }
    if (id === 'students') {
      return route.fulfill({
        body: 'Nr.;Nachname;Vorname;E-Mail-Adresse\n01;Müller;Anna;anna@example.org\n02;Schmidt;Ben;ben@example.org',
        contentType: 'text/csv',
      });
    }
    if (id === 'anna' || id === 'ben') {
      if (url.searchParams.get('alt') !== 'media') {
        return route.fulfill({ json: { size: String(bytes.length) } });
      }
      downloads.push(id);
      await beforeDownload?.(id);
      return route.fulfill({ body: bytes, contentType: 'application/pdf' });
    }
    if (id === resultId && resultId) {
      return url.searchParams.get('alt') === 'media'
        ? route.fulfill({ body: saved!, contentType: 'application/json' })
        : route.fulfill({
            json: { id, name: 'results.json', mimeType: 'application/json', parents: ['course'] },
          });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route('https://www.googleapis.com/upload/drive/v3/files**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataBuffer()!.toString('utf8');
      const boundary = request.headers()['content-type'].split('boundary=')[1];
      const parts = body.split(`--${boundary}`);
      const metadata = JSON.parse(parts[1].split('\r\n\r\n')[1].trim());
      saved = parts[2].split('\r\n\r\n')[1].replace(/\r\n$/, '');
      resultId = metadata.id;
      writes.push({ method: 'POST', id: resultId, parent: metadata.parents[0], content: saved! });
      if (loseResponse) {
        loseResponse = false;
        return route.abort('failed');
      }
    } else {
      saved = request.postDataBuffer()!.toString('utf8');
      writes.push({ method: 'PATCH', id: resultId, content: saved });
    }
    await route.fulfill({
      json: { id: resultId, name: 'results.json', mimeType: 'application/json' },
    });
  });
  await page.goto('/');
  await page.locator('#connect').click();
  await page.getByRole('tab', { name: 'Create documentation' }).click();
  await expect(page.locator('#doc-load')).toBeEnabled();
  return { writes, downloads, content: () => saved };
}

async function loadExams(page: Page): Promise<void> {
  if ((await page.locator('#doc-setup').getAttribute('aria-expanded')) === 'false') {
    await page.locator('#doc-setup').click();
  }
  await page.locator('#doc-load').click();
  await expect(page.locator('#doc-load')).toBeEnabled();
  if (
    (await page.locator('#doc-results').isEnabled()) &&
    (await page.locator('#doc-results').getAttribute('aria-expanded')) === 'false'
  ) {
    await page.locator('#doc-results').click();
    const field = (await page.locator('#doc-points').isVisible())
      ? page.locator('#doc-points')
      : page.locator('#doc-mark');
    if (await field.isEnabled()) {
      await field.focus();
    }
  }
}

test('records points then marks with Enter, copies partial JSON and saves only at pass boundaries', async ({
  page,
}) => {
  const state = await setup(page, '{"Other, Student":{"points":"20","mark":"1"}}');
  const tabs = await page.getByRole('tab').allTextContents();
  expect(tabs.findIndex((text) => text.includes('Create documentation'))).toBe(
    tabs.findIndex((text) => text.includes('Match students')) + 1,
  );
  await loadExams(page);
  await expect(
    page.getByRole('img', { name: 'Top right corner of the exam front page' }),
  ).toBeVisible();
  await expect(page.locator('#doc-points')).toBeFocused();
  await expect(page.locator('#doc-mark')).toHaveCount(0);
  await expect(page.locator('#doc-pass-points')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#doc-points').press('Enter');
  await expect(page.locator('.documentation-review h3')).toHaveText('Müller, Anna');
  expect(state.writes).toHaveLength(0);
  await page.locator('#doc-points').fill('17,5');
  await expect(page.locator('#workflow-test')).toBeDisabled();
  await page.locator('#doc-copy').click();
  const copied = await page.evaluate(
    () => (window as unknown as { __copiedResults: string }).__copiedResults,
  );
  expect(copied).toContain('\n  "Müller, Anna": {\n    "points": "17,5",\n    "mark": ""\n  }');
  await page.getByRole('tab', { name: 'Prepare emails' }).click();
  await page.getByRole('tab', { name: 'Create documentation' }).click();
  await expect(page.locator('#doc-points')).toHaveValue('17,5');
  await page.locator('#doc-points').press('Enter');
  await expect(page.locator('.documentation-review h3')).toHaveText('Schmidt, Ben');
  await expect(page.locator('#doc-points')).toBeFocused();
  expect(state.writes).toHaveLength(0);
  await page.locator('#doc-points').fill('0');
  await page.locator('#doc-points').press('Enter');
  await expect(page.locator('#doc-mark')).toBeFocused();
  await expect(page.locator('.documentation-review h3')).toHaveText('Müller, Anna');
  await expect(page.locator('#doc-points')).toHaveCount(0);
  await expect(page.locator('.documentation-other-value')).toContainText('17,5');
  expect(state.writes).toHaveLength(1);
  expect(JSON.parse(state.content()!)).toEqual({
    'Other, Student': { points: '20', mark: '1' },
    'Müller, Anna': { points: '17,5', mark: '' },
    'Schmidt, Ben': { points: '0', mark: '' },
  });
  await page.locator('#doc-mark').fill('2+');
  await page.locator('#doc-mark').press('Enter');
  await expect(page.locator('.documentation-review h3')).toHaveText('Schmidt, Ben');
  await expect(page.locator('#doc-mark')).toBeFocused();
  expect(state.writes).toHaveLength(1);
  await page.locator('#doc-mark').fill('6');
  await page.locator('#doc-mark').press('Enter');
  await expect(page.locator('#doc-progress')).toContainText(
    'Saved results.json in 8a. Points: 2/2 · Marks: 2/2',
  );
  expect(state.writes).toHaveLength(2);
  expect(JSON.parse(state.content()!)).toEqual({
    'Other, Student': { points: '20', mark: '1' },
    'Müller, Anna': { points: '17,5', mark: '2+' },
    'Schmidt, Ben': { points: '0', mark: '6' },
  });
  expect(
    state.writes.every((write) => write.id === 'existing-results' && write.method === 'PATCH'),
  ).toBe(true);
  await loadExams(page);
  await expect(page.locator('#doc-points')).toHaveValue('17,5');
  await expect(page.locator('#doc-count')).toContainText('Points: 2/2 · Marks: 2/2');
  await expect(page.locator('#doc-points')).toBeEnabled();
  await page.screenshot({ path: 'test-results/documentation-desktop.png', fullPage: true });
  await page.locator('#doc-pass-mark').click();
  await expect(page.locator('#doc-mark')).toHaveValue('2+');
  await expect(page.locator('#doc-mark')).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/documentation-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('retries a lost points-pass save without advancing or duplicating results.json', async ({
  page,
}) => {
  const state = await setup(page, undefined, true);
  await loadExams(page);
  await expect(page.locator('#doc-points')).toBeEnabled();
  await page.locator('#doc-points').fill('17');
  await page.locator('#doc-points').press('Enter');
  await expect(page.locator('#doc-points')).toBeFocused();
  await page.locator('#doc-points').fill('0');
  await page.locator('#doc-points').press('Enter');
  await expect(page.getByRole('alert')).toContainText('Check your connection and retry');
  await expect(page.locator('#doc-points')).toHaveValue('0');
  await expect(page.locator('#doc-pass-points')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#doc-points').press('Enter');
  await expect(page.locator('#doc-mark')).toBeFocused();
  expect(state.writes.map((write) => [write.method, write.id, write.parent])).toEqual([
    ['POST', 'new-results', 'course'],
    ['PATCH', 'new-results', undefined],
  ]);
});

test('loads old names, resumes the marks pass, and migrates keys when saving', async ({ page }) => {
  const state = await setup(
    page,
    '{"Müller Anna":{"points":"17,5","mark":""},"Schmidt Ben":{"points":"10","mark":"3-"}}',
  );
  await loadExams(page);
  await expect(page.locator('#doc-mark')).toBeFocused();
  await expect(page.locator('#doc-pass-mark')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#doc-mark').fill('2+');
  await page.locator('#doc-mark').press('Enter');
  await expect(page.locator('#doc-mark')).toHaveValue('3-');
  await expect(page.locator('#doc-mark')).toBeEnabled();
  await page.locator('#doc-mark').press('Enter');
  await expect(page.locator('#doc-progress')).toContainText('Saved results.json');
  expect(JSON.parse(state.content()!)).toEqual({
    'Müller, Anna': { points: '17,5', mark: '2+' },
    'Schmidt, Ben': { points: '10', mark: '3-' },
  });
});

test('reports malformed course JSON without replacing it', async ({ page }) => {
  const state = await setup(page, '{broken');
  await loadExams(page);
  await expect(page.getByRole('alert')).toContainText('results.json contains invalid JSON');
  expect(state.content()).toBe('{broken');
  expect(state.writes).toHaveLength(0);
  await expect(page.locator('#doc-load')).toBeEnabled();
});

test('reuses all PDFs and corner previews already loaded in Match students', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('tab', { name: 'Match students', exact: true }).click();
  await expect(page.locator('#match-load')).toBeEnabled();
  await page.locator('#match-load').click();
  await page.locator('#match-preload').click();
  await expect(page.locator('#match-progress')).toContainText('Matching complete');
  expect(state.downloads).toEqual(['anna', 'ben']);
  await page.getByRole('tab', { name: 'Create documentation' }).click();
  await expect(page.locator('#doc-load')).toBeEnabled();
  await loadExams(page);
  await expect(
    page.getByRole('img', { name: 'Top right corner of the exam front page' }),
  ).toBeVisible();
  await expect(page.locator('#doc-next')).toBeEnabled();
  await page.locator('#doc-next').click();
  await expect(page.locator('.documentation-review h3')).toHaveText('Schmidt, Ben');
  await expect(page.locator('#doc-points')).toBeEnabled();
  expect(state.downloads).toEqual(['anna', 'ben']);
});

test('prefetches the next student and preserves entries when switching passes', async ({
  page,
}) => {
  let release!: () => void;
  const secondReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = await setup(page, undefined, false, async (id) => {
    if (id === 'ben') {
      await secondReady;
    }
  });
  await loadExams(page);
  await expect(page.locator('#doc-points')).toBeEnabled();
  await expect.poll(() => state.downloads).toEqual(['anna', 'ben']);
  await page.locator('#doc-points').fill('17');
  await page.locator('#doc-next').click();
  release();
  await expect(page.locator('.documentation-review h3')).toHaveText('Schmidt, Ben');
  await expect(page.locator('#doc-points')).toBeEnabled();
  await page.locator('#doc-points').fill('10');
  await page.locator('#doc-pass-mark').click();
  await expect(page.locator('#doc-mark')).toBeFocused();
  await page.locator('#doc-mark').fill('2');
  await page.locator('#doc-pass-points').click();
  await expect(page.locator('#doc-prev')).toBeEnabled();
  await page.locator('#doc-prev').click();
  await expect(page.locator('#doc-points')).toHaveValue('17');
  await expect(page.locator('.documentation-other-value')).toContainText('2');
  await expect(page.locator('#doc-next')).toBeEnabled();
  await page.locator('#doc-next').click();
  await expect(page.locator('#doc-points')).toHaveValue('10');
  await expect(page.locator('#doc-save')).toBeEnabled();
  expect(state.downloads).toEqual(['anna', 'ben']);
  await page.locator('#doc-save').click();
  await expect(page.locator('#doc-progress')).toContainText('Saved results.json');
});

test('returns to skipped students before saving the points pass', async ({ page }) => {
  const state = await setup(page);
  await loadExams(page);
  await expect(page.locator('#doc-next')).toBeEnabled();
  await page.locator('#doc-next').click();
  await expect(page.locator('#doc-points')).toBeEnabled();
  await page.locator('#doc-points').fill('10');
  await page.locator('#doc-points').press('Enter');
  await expect(page.locator('.documentation-review h3')).toHaveText('Müller, Anna');
  await expect(page.locator('#doc-points')).toBeFocused();
  expect(state.writes).toHaveLength(0);
  await page.locator('#doc-points').fill('17');
  await page.locator('#doc-points').press('Enter');
  await expect(page.locator('#doc-points')).toHaveValue('10');
  await expect(page.locator('#doc-points')).toBeEnabled();
  await page.locator('#doc-points').press('Enter');
  await expect(page.locator('#doc-mark')).toBeFocused();
  expect(state.writes).toHaveLength(1);
});

test('edits JSON directly, synchronizes the review fields and saves added and removed entries', async ({
  page,
}) => {
  const state = await setup(
    page,
    '{"Other, Student":{"points":"20","mark":"1"},"Müller, Anna":{"points":"12","mark":"4"}}',
  );
  await loadExams(page);
  await expect(page.locator('#doc-json')).toBeEditable();
  const edited = {
    'Müller, Anna': { points: '17,5', mark: '2+' },
    'New, Student': { points: '10', mark: '' },
  };
  // Loading partial existing points starts with Ben; go back to Anna to observe synchronization.
  await expect(page.locator('#doc-prev')).toBeEnabled();
  await page.locator('#doc-prev').click();
  await expect(page.locator('#doc-points')).toBeEnabled();
  const source = JSON.stringify(edited);
  await page.locator('#doc-json').fill(source);
  await expect(page.locator('#doc-json')).toHaveValue(source);
  await expect(page.locator('#doc-points')).toHaveValue('17,5');
  await expect(page.locator('.documentation-other-value')).toContainText('2+');
  await expect(page.locator('#doc-count')).toContainText('Unsaved changes');
  await expect(page.locator('#workflow-test')).toBeDisabled();
  await page.locator('#doc-copy').click();
  expect(
    JSON.parse(
      await page.evaluate(() => (window as unknown as { __copiedResults: string }).__copiedResults),
    ),
  ).toEqual(edited);
  await page.locator('#doc-points').fill('18');
  edited['Müller, Anna'].points = '18';
  expect(JSON.parse(await page.locator('#doc-json').inputValue())).toEqual(edited);
  await page.locator('#doc-save').click();
  await expect(page.locator('#doc-progress')).toContainText('Saved results.json');
  expect(JSON.parse(state.content()!)).toEqual(edited);
  expect(state.content()).toContain('\n  "Müller, Anna": {');
  await page.locator('#doc-json').fill('{}');
  await page.locator('#doc-save').click();
  await expect(page.locator('#doc-json')).toHaveValue('{}\n');
  expect(state.content()).toBe('{}\n');
});

test('retains incomplete JSON across tabs and navigation and prevents saving until it is repaired', async ({
  page,
}) => {
  const state = await setup(page);
  await loadExams(page);
  await expect(page.locator('#doc-json')).toBeEditable();
  await page.locator('#doc-json').fill('{ unfinished');
  await expect(page.locator('#doc-validation')).toContainText('invalid JSON');
  await expect(page.locator('#doc-json')).toHaveAttribute('aria-invalid', 'true');
  for (const id of ['doc-save', 'doc-copy', 'doc-save-next', 'doc-points']) {
    await expect(page.locator('#' + id)).toBeDisabled();
  }
  await page.getByRole('tab', { name: 'Prepare emails' }).click();
  await page.getByRole('tab', { name: 'Create documentation' }).click();
  await expect(page.locator('#doc-json')).toHaveValue('{ unfinished');
  await page.locator('#doc-next').click();
  await expect(page.locator('#doc-json')).toBeEnabled();
  await expect(page.locator('#doc-json')).toHaveValue('{ unfinished');
  await page.locator('#doc-json').fill('{"Schmidt, Ben":{"points":"10"}}');
  await expect(page.locator('#doc-validation')).toContainText('needs points and mark');
  expect(state.writes).toHaveLength(0);
  await page.locator('#doc-json').fill('{"Schmidt, Ben":{"points":"10","mark":"3-"}}');
  await expect(page.locator('#doc-json')).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('#doc-validation')).toBeEmpty();
  await expect(page.locator('#doc-points')).toHaveValue('10');
  await expect(page.locator('#doc-points')).toBeEnabled();
  await page.locator('#doc-save').click();
  await expect(page.locator('#doc-progress')).toContainText('Saved results.json');
  expect(JSON.parse(state.content()!)).toEqual({ 'Schmidt, Ben': { points: '10', mark: '3-' } });
});

test('documentation uses independent collapsible subtasks and opens marks after points', async ({
  page,
}) => {
  const state = await setup(page);
  await expect(page.locator('#panel-documentation .subtask')).toHaveCount(4);
  await expect(page.locator('#doc-setup')).toHaveAttribute('aria-expanded', 'true');
  for (const id of ['doc-pass-points', 'doc-pass-mark', 'doc-results']) {
    await expect(page.locator('#' + id)).toBeDisabled();
    await expect(page.locator('#' + id)).toHaveAttribute('aria-expanded', 'false');
  }
  await page.locator('#doc-load').click();
  await expect(page.locator('#doc-points')).toBeFocused();
  await expect(page.locator('#doc-setup')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#doc-pass-points')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#doc-pass-mark')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#doc-points').fill('17');
  await page.locator('#doc-pass-points').click();
  await expect(page.locator('#doc-points')).toBeHidden();
  await page.locator('#doc-pass-points').click();
  await expect(page.locator('#doc-points')).toHaveValue('17');
  await page.locator('#doc-points').press('Enter');
  await expect(page.locator('#doc-points')).toBeFocused();
  await page.locator('#doc-points').fill('10');
  await page.locator('#doc-points').press('Enter');
  await expect(page.locator('#doc-pass-points')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#doc-pass-mark')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#doc-mark')).toBeFocused();
  await page.locator('#doc-mark').fill('2');
  await page.locator('#doc-mark').press('Enter');
  await expect(page.locator('#doc-mark')).toBeFocused();
  await page.locator('#doc-mark').fill('3');
  await page.locator('#doc-mark').press('Enter');
  await expect(page.locator('#doc-pass-mark')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#doc-results')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#doc-json')).toBeFocused();
  expect(state.writes).toHaveLength(2);
});

test('points and grade highlights use reusable course areas without downloading or rendering again', async ({
  page,
}) => {
  const state = await setup(page);
  await loadExams(page);
  await expect(page.locator('#doc-highlight-area img')).toBeVisible();
  await page.locator('#doc-highlight-set').click();
  const area = page.locator('#doc-highlight-area');
  await area.scrollIntoViewIfNeeded();
  const bounds = (await area.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.04, bounds.y + bounds.height * 0.12);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.37, bounds.y + bounds.height * 0.3, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.locator('#doc-highlight-set')).toHaveText('Adjust points highlight');
  await expect(page.locator('#doc-highlight-box')).toBeVisible();
  const pointsStyle = await page.locator('#doc-highlight-box').getAttribute('style');
  await page.screenshot({
    path: 'test-results/documentation-highlight-desktop.png',
    fullPage: true,
  });
  await page.locator('#doc-next').click();
  await expect(page.locator('#doc-points')).toBeEnabled();
  await expect(page.locator('#doc-highlight-box')).toHaveAttribute('style', pointsStyle!);
  await page.locator('#doc-pass-mark').click();
  await expect(page.locator('#doc-mark')).toBeEnabled();
  await expect(page.locator('#doc-highlight-box')).toHaveCount(0);
  await page.locator('#doc-highlight-set').click();
  for (let step = 0; step < 31; step++) {
    await page.locator('#doc-highlight-area').press('ArrowRight');
  }
  await page.locator('#doc-highlight-area').press('Shift+ArrowRight');
  await page.locator('#doc-highlight-area').press('Enter');
  await expect(page.locator('#doc-highlight-set')).toHaveText('Adjust grade highlight');
  const gradeStyle = await page.locator('#doc-highlight-box').getAttribute('style');
  expect(gradeStyle).not.toBe(pointsStyle);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/documentation-highlight-mobile.png',
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mobileArea = (await page.locator('#doc-highlight-area').boundingBox())!;
  const mobileBox = (await page.locator('#doc-highlight-box').boundingBox())!;
  expect((mobileBox.x - mobileArea.x) / mobileArea.width).toBeCloseTo(0.41, 2);
  await expect.poll(() => state.downloads).toEqual(['anna', 'ben']);
  // A reload restores only rectangle coordinates, not PDF content.
  await page.reload();
  await expect(page.locator('#connect')).toHaveText('Disconnect');
  await page.getByRole('tab', { name: 'Create documentation' }).click();
  await expect(page.locator('#doc-load')).toBeEnabled();
  await loadExams(page);
  await expect(page.locator('#doc-highlight-box')).toHaveAttribute('style', pointsStyle!);
  await page.locator('#doc-pass-mark').click();
  await expect(page.locator('#doc-mark')).toBeEnabled();
  await expect(page.locator('#doc-highlight-box')).toHaveAttribute('style', gradeStyle!);
  await page.locator('#doc-highlight-set').click();
  await page.locator('#doc-highlight-area').press('ArrowRight');
  await page.locator('#doc-highlight-area').press('Escape');
  await expect(page.locator('#doc-highlight-box')).toHaveAttribute('style', gradeStyle!);
  await page.locator('#doc-highlight-clear').click();
  await expect(page.locator('#doc-highlight-box')).toHaveCount(0);
  await page.locator('#doc-pass-points').click();
  await expect(page.locator('#doc-points')).toBeEnabled();
  await expect(page.locator('#doc-highlight-box')).toHaveAttribute('style', pointsStyle!);
});
