import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

for (const source of ['none', 'local', 'drive', 'document']) {
const withExtras = source !== 'none';
test(`creates drafts with retry protection; shared attachment source=${source}`,  async ({ page }) => {
  await mockGoogleUi(page, false, source === 'document' ? 'application/vnd.google-apps.document' : 'application/octet-stream', 2);
  const pdfA = await PDFDocument.create(); pdfA.addPage([400, 600]);
  const pdfB = await PDFDocument.create(); pdfB.addPage([500, 700]);
  const bytes = { a: Buffer.from(await pdfA.save()), b: Buffer.from(await pdfB.save()) };
  const files = [
    { id: 'a', name: '01_Müller_Anna.pdf', mimeType: 'application/pdf' },
    { id: 'b', name: '02_Schmidt_Lukas.pdf', mimeType: 'application/pdf' },
    { id: 'unknown', name: 'unmatched.pdf', mimeType: 'application/pdf' },
  ];
  const created: string[] = [];
  const byMessageId = new Map<string, { id: string; message: { id: string } }>();
  let loseResponse = true;
  let account = 'teacher@example.org';
  let searchReady = false;
  let failLabel = true;
  const labelsApplied = new Map<string, string[]>();
  let sharedDownloads = 0;
  const extra = Buffer.from([0, 255, 128, 65, 66]);
  await page.route('https://www.googleapis.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/shared-attachment')) {
      if (url.searchParams.get('fields') === 'size') return route.fulfill({ json: { size: String(extra.length) } });
      sharedDownloads++;
      if (source === 'document') { expect(url.pathname).toContain('/export'); expect(url.searchParams.get('mimeType')).toBe('application/pdf'); }
      return route.fulfill({ body: extra });
    }
    if (url.pathname.endsWith('/students-csv')) return route.fulfill({ body: 'Nr.;Nachname;Vorname;E-Mail-Adresse;Klasse\n1;Müller;Anna;anna@example.org;8A\n2;Schmidt;Lukas;lukas@example.org;8A' });
    if (url.pathname === '/drive/v3/files') return route.fulfill({ json: { files } });
    const id = url.pathname.split('/').at(-1) as 'a' | 'b';
    if (bytes[id]) {
      if (url.searchParams.get('fields') === 'size') return route.fulfill({ json: { size: String(bytes[id].length) } });
      return route.fulfill({ contentType: 'application/pdf', body: bytes[id] });
    }
    throw new Error(`Unexpected Drive operation ${route.request().method()} ${url.pathname}`);
  });
  await page.route('https://gmail.googleapis.com/**', async route => {
    const url = new URL(route.request().url());
    expect(url.pathname).not.toContain('/send');
    if (url.pathname.endsWith('/labels')) {
      if (route.request().method() === 'POST') {
        expect(route.request().postDataJSON().name).toBe('8A');
        return route.fulfill({ json: { id: 'class-label' } });
      }
      return route.fulfill({ json: { labels: [{ id: 'bulk-label', name: 'bulk-send' }, ...(failLabel ? [] : [{ id: 'class-label', name: '8A' }])] } });
    }
    if (url.pathname.includes('/messages/')) {
      const id = url.pathname.split('/').at(-2)!;
      expect(route.request().postDataJSON().addLabelIds).toEqual(['bulk-label', 'class-label']);
      if (failLabel) { failLabel = false; return route.fulfill({ status: 503, json: { error: { message: 'Label operation failed' } } }); }
      labelsApplied.set(id, ['bulk-label', 'class-label']);
      return route.fulfill({ json: {} });
    }
    if (/\/drafts\/draft-/.test(url.pathname)) {
      const id = url.pathname.split('/').at(-1)!;
      const messageId = id.replace('draft-', 'message-');
      return route.fulfill({ json: { id, message: { id: messageId, labelIds: labelsApplied.get(messageId) || ['DRAFT'] } } });
    }
    if (url.pathname.endsWith('/profile')) return route.fulfill({ json: { emailAddress: account } });
    if (url.pathname.endsWith('/drafts') && route.request().method() === 'GET') {
      const messageId = url.searchParams.get('q')!.replace('rfc822msgid:', '');
      const existing = searchReady ? byMessageId.get(messageId) : undefined;
      return route.fulfill({ json: { drafts: existing ? [existing] : [] } });
    }
    if (url.pathname.endsWith('/drafts') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(Object.keys(body)).toEqual(['message']);
      const mime = Buffer.from(body.message.raw, 'base64url').toString('utf8');
      created.push(mime);
      const messageId = mime.match(/Message-ID: <([^>]+)>/)![1];
      const result = { id: `draft-${created.length}`, message: { id: `message-${created.length}` } };
      byMessageId.set(messageId, result);
      if (loseResponse) { loseResponse = false; return route.fulfill({ status: 503, json: { error: { message: 'Lost response' } } }); }
      return route.fulfill({ json: result });
    }
    throw new Error(`Unexpected Gmail operation ${route.request().method()} ${url.pathname}`);
  });
  await page.goto('/');
  await page.locator('#connect').click();
  await page.getByRole('tab', { name: 'Match students', exact: true }).click();
  await page.locator('#match-folder').click();
  await expect(page.locator('#match-setup-body')).toContainText('Physics class');
  await page.locator('#match-csv').click();
  await expect(page.locator('#match-setup-body')).toContainText('students.csv');
  await page.getByRole('tab', { name: 'Prepare emails', exact: true }).click();
  await expect(page.locator('#draft-setup-body')).toContainText('Physics class');
  await expect(page.locator('#draft-setup-body')).toContainText('students.csv');
  await page.locator('#draft-load').click();
  await expect(page.locator('#draft-compose-body')).toBeVisible();
  await expect(page.locator('#draft-file-2')).toBeDisabled();
  await page.locator('#draft-subject').fill('Deine {{Klasse}}-Arbeit, {{Vorname}}');
  await expect(page.locator('#draft-tags')).toHaveCount(0);
  await expect(page.locator('#draft-labels')).toHaveValue('bulk-send');
  if (!withExtras) await page.locator('#draft-labels').fill('');
  await page.locator('#draft-body').fill('Hallo {{Vorname}} {{Nachname}},\n\nhier ist deine Arbeit. Viele Grüße!');
  if (withExtras) {
    await page.locator('#draft-labels').fill('bulk-send, 8A, bulk-send');
    if (source === 'local') await page.locator('#draft-extra').setInputFiles({ name: 'Hinweise.bin', mimeType: 'application/octet-stream', buffer: extra });
    else {
      await page.locator('#draft-extra-drive').click();
      await expect(page.getByRole('status')).toContainText('2 shared attachments added');
    }
    if (source !== 'local') await page.locator('#draft-extra-remove-1').click();
    await page.locator('#draft-extra').setInputFiles([
      { name: 'Second.bin', mimeType: 'application/octet-stream', buffer: extra },
      { name: 'Remove-me.bin', mimeType: 'application/octet-stream', buffer: extra },
    ]);
    await page.locator('#draft-extra-remove-2').click();
    await expect(page.locator('.shared-attachment')).toHaveCount(2);
    expect(await page.locator('#draft-body').evaluate(body => Boolean(body.compareDocumentPosition(document.getElementById('draft-extra')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  }
  await page.locator('#draft-prepare').click();
  await expect(page.locator('.draft-preview')).toHaveCount(2);
  await expect(page.locator('.draft-preview').first()).toContainText('Deine 8A-Arbeit, Anna');
  await expect(page.locator('.draft-preview').first()).toContainText('anna@example.org');
  if (withExtras) {
    await expect(page.locator('.draft-preview').first()).toContainText(`Shared attachment: ${source === 'local' ? 'Hinweise.bin' : source === 'document' ? 'Shared guide.pdf' : 'Shared guide'}`);
    await expect(page.locator('.draft-preview').first()).toContainText('Gmail labels: bulk-send, 8A');
  }
  expect(created).toHaveLength(0);
  account = 'other@example.org';
  await page.locator('#draft-create').click();
  await expect(page.getByRole('alert')).toContainText('Gmail account changed');
  expect(created).toHaveLength(0);
  account = 'teacher@example.org';
  await page.locator('#draft-create').click();
  await expect(page.getByRole('alert')).toContainText('Lost response');
  await page.locator('#draft-create').click();
  await expect(page.getByRole('alert')).toContainText('has not confirmed');
  expect(created).toHaveLength(1);
  searchReady = true;
  await page.locator('#draft-create').click();
  if (withExtras) {
    await expect(page.getByRole('alert')).toContainText('Label operation failed');
    expect(created).toHaveLength(1);
    await page.locator('#draft-create').click();
  }
  await expect(page.getByRole('status')).toContainText('2 of 2 drafts saved in Gmail. Nothing was sent.');
  await expect(page.locator('#draft-toggle-review')).toHaveAttribute('aria-expanded', 'false');
  expect(created).toHaveLength(2);
  expect(sharedDownloads).toBe(source === 'drive' || source === 'document' ? 2 : 0);
  for (const [i, mime] of created.entries()) {
    expect(mime).toContain(`To: ${i === 0 ? 'anna' : 'lukas'}@example.org\r\n`);
    const boundary = mime.match(/boundary="([^"]+)"/)![1];
    const parts = mime.split(`--${boundary}`);
    expect(Buffer.from(parts[1].split('\r\n\r\n')[1].trim(), 'base64').toString('utf8')).toContain(i === 0 ? 'Anna Müller' : 'Lukas Schmidt');
    if (withExtras) {
      expect(parts).toHaveLength(6);
      expect(Buffer.from(parts[3].split('\r\n\r\n')[1].trim(), 'base64')).toEqual(extra);
      expect(Buffer.from(parts[4].split('\r\n\r\n')[1].trim(), 'base64')).toEqual(extra);
      expect(mime).not.toContain('Remove-me');
    }
    expect(Buffer.from(parts[2].split('\r\n\r\n')[1].trim(), 'base64')).toEqual(i === 0 ? bytes.a : bytes.b);
  }
  await page.locator('#draft-toggle-review').click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/drafts-mobile.png', fullPage: true });
});

}
