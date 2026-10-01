import { expect, test } from '@playwright/test';
import { mockGoogleUi } from './googleMock';

test('batch send uses the exact label query, paginates and sends only checked drafts', async ({ page }) => {
  await mockGoogleUi(page);
  const sent: string[] = [];
  let changed = false;
  let fail = false;
  let account = 'teacher@example.org';
  let reorder = false;
  await page.route('https://gmail.googleapis.com/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/users/me/')[1];
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (path === 'profile') return json({ emailAddress: account });
    if (path === 'drafts') {
      expect(url.searchParams.get('q')).toBe('label:bulk-send');
      return json(url.searchParams.has('pageToken') ? { drafts: [{ id: 'b' }] } : { drafts: [{ id: 'a' }], nextPageToken: 'next' });
    }
    if (path === 'drafts/send') {
      const id = route.request().postDataJSON().id;
      sent.push(id);
      return fail ? json({ error: { message: 'Temporary failure' } }, 503) : json({ id: `sent-${id}` });
    }
    const id = path.split('/')[1];
    const headers = [
      { name: 'Subject', value: `Exam ${id}` }, { name: 'To', value: `${id}@example.org` }, { name: 'Bcc', value: 'archive@example.org' },
    ];
    const parts = [{ filename: `${id}.pdf` }];
    // Identical JSON data can arrive with a different object property order.
    const payload = reorder ? { parts, headers } : { headers, parts };
    return json({ id, message: { id: `${id}-${changed ? 2 : 1}`, snippet: 'Your exam', payload } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Batch send', exact: true }).click();
  await page.getByRole('button', { name: 'Enable Gmail access' }).click();
  await page.getByRole('button', { name: 'Load drafts', exact: true }).click();
  await expect(page.locator('#send-row-1')).toBeVisible();
  await expect(page.locator('#send-submit')).toBeDisabled();
  await expect(page.locator('#panel-send')).toContainText('archive@example.org');
  await expect(page.locator('#panel-send')).toContainText('b.pdf');
  await page.locator('#send-row-0').check();
  account = 'different@example.org';
  await page.locator('#send-submit').click();
  await expect(page.getByRole('alert')).toContainText('account changed');
  expect(sent).toEqual([]);
  account = 'teacher@example.org';
  changed = true;
  await page.locator('#send-submit').click();
  await expect(page.getByRole('alert')).toContainText('changed in Gmail');
  await expect(page.getByRole('status')).toContainText('This draft changed in Gmail');
  expect(sent).toEqual([]);
  changed = false;
  reorder = true;
  await page.locator('#send-submit').click();
  await expect(page.getByRole('status')).toContainText('1 of 1 selected emails sent');
  expect(sent).toEqual(['a']);
  await page.locator('#send-toggle-review').click();
  await expect(page.locator('#send-row-0')).toBeDisabled();
  await page.locator('#send-row-1').check();
  fail = true;
  await page.locator('#send-submit').click();
  await expect(page.locator('#panel-send')).toContainText('Send result unknown');
  await expect(page.locator('#send-row-1')).toBeDisabled();
  expect(sent).toEqual(['a', 'b']);
  await page.locator('#send-toggle-load').click();
  await page.locator('#send-load').click();
  await expect(page.locator('#send-row-1')).toBeDisabled();
  await expect(page.locator('#send-submit')).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('empty label search explains Gmail limitation', async ({ page }) => {
  await mockGoogleUi(page);
  await page.route('https://gmail.googleapis.com/**', route => route.fulfill({ json: route.request().url().endsWith('profile') ? { emailAddress: 'teacher@example.org' } : { drafts: [] } }));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Batch send', exact: true }).click();
  await page.locator('#send-access').click();
  await page.locator('#send-load').click();
  await expect(page.getByRole('status')).toContainText('No drafts found');
  await expect(page.locator('#send-submit')).toBeDisabled();
});
