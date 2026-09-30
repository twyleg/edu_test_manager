import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

test('Drive picker, download, upload and reconnect retry preserve completed files', async ({ page }) => {
  await mockGoogleUi(page);
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 3; index++) pdf.addPage();
  const pdfBytes = Buffer.from(await pdf.save());
  let nextId = 0;
  let loseResponse = true;
  const created = new Map<string, { name: string; parents: string[] }>();
  const completed = new Set<string>();
  const uploadCalls: string[] = [];
  const uploadedBodies: Buffer[] = [];
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.headers().authorization).toBe('Bearer browser-test-token');
    if (url.pathname.endsWith('/source-pdf') && url.searchParams.get('fields') === 'size') {
      return route.fulfill({ json: { size: String(pdfBytes.length) } });
    }
    if (url.pathname.endsWith('/source-pdf')) {
      expect(url.searchParams.get('alt')).toBe('media');
      return route.fulfill({ contentType: 'application/pdf', body: pdfBytes });
    }
    if (url.pathname.endsWith('/destination-folder')) return route.fulfill({ json: {
      mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true },
    } });
    if (url.pathname.endsWith('/generateIds')) return route.fulfill({ json: { ids: [`generated-${++nextId}`] } });
    if (url.pathname.startsWith('/drive/v3/files/generated-')) {
      const id = url.pathname.split('/').at(-1)!;
      return route.fulfill({ status: completed.has(id) ? 200 : 404, json: completed.has(id) ? { id } : {} });
    }
    if (url.pathname === '/upload/drive/v3/files') {
      const metadata = request.postDataJSON();
      expect(metadata.parents).toEqual(['destination-folder']);
      expect(metadata.mimeType).toBe('application/pdf');
      expect(created.has(metadata.id)).toBe(false);
      created.set(metadata.id, metadata);
      return route.fulfill({ headers: {
        Location: `https://www.googleapis.com/upload/session/${metadata.id}`,
        'Access-Control-Expose-Headers': 'Location',
      }, body: '' });
    }
    if (url.pathname.startsWith('/upload/session/')) {
      const id = url.pathname.split('/').at(-1)!;
      uploadCalls.push(id);
      uploadedBodies.push(request.postDataBuffer()!);
      completed.add(id);
      if (id === 'generated-2' && loseResponse) {
        loseResponse = false;
        return route.fulfill({ status: 401, json: { error: { message: 'Expired token' } } });
      }
      return route.fulfill({ json: { id } });
    }
    throw new Error(`Unexpected Drive request: ${request.method()} ${url}`);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose PDF from Drive' }).click();
  await expect(page.locator('.file-selection').first()).toContainText('Drive exam.pdf');
  await page.getByRole('button', { name: 'Choose Drive folder' }).click();
  await page.getByRole('button', { name: 'Scan PDF', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Scan complete', { timeout: 90000 });
  for (let index = 0; index < 3; index++) await page.locator(`#front-${index}`).check();
  await page.getByRole('button', { name: 'Prepare 3 PDFs' }).click();
  await page.getByRole('button', { name: 'Save 3 PDFs to Drive' }).click();
  await expect(page.getByRole('alert')).toContainText('session expired');
  await expect(page.getByRole('status')).toContainText('1 of 3 PDFs saved');
  await expect(page.locator('#choose-folder')).toBeDisabled();
  await expect(page.locator('#rotate-left-0')).toBeDisabled();
  await expect(page.locator('#skip-1')).toBeDisabled();
  await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await page.getByRole('button', { name: 'Retry remaining uploads' }).click();
  await expect(page.locator('#toggle-save')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#toggle-save').click();
  await expect(page.getByRole('heading', { name: 'All exams saved to Drive' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Saved ↗' })).toHaveCount(3);
  expect(uploadCalls).toEqual(['generated-1', 'generated-2', 'generated-3']);
  expect(created.size).toBe(3);
  for (const bytes of uploadedBodies) expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  await page.getByRole('button', { name: 'Start a new batch' }).click();
  await expect(page.locator('.result-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose PDF from Drive' })).toBeEnabled();
});
