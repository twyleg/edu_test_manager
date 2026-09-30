import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

test('reuses matching inputs and creates only Gmail drafts with templates, tags and exact attachments', async ({ page }) => {
  await mockGoogleUi(page);
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
  await page.route('https://www.googleapis.com/**', async route => {
    const url = new URL(route.request().url());
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
  await page.getByRole('tab', { name: 'Match students', exact: true }).click();
  await page.locator('#match-folder').click();
  await expect(page.locator('#match-setup-body')).toContainText('Physics class');
  await page.locator('#match-csv').click();
  await expect(page.locator('#match-setup-body')).toContainText('students.csv');
  await page.getByRole('tab', { name: 'Prepare drafts', exact: true }).click();
  await expect(page.locator('#draft-setup-body')).toContainText('Physics class');
  await expect(page.locator('#draft-setup-body')).toContainText('students.csv');
  await page.locator('#draft-access').click();
  await page.locator('#draft-load').click();
  await expect(page.locator('#draft-compose-body')).toBeVisible();
  await expect(page.locator('#draft-file-2')).toBeDisabled();
  await page.locator('#draft-subject').fill('Deine {{Klasse}}-Arbeit, {{Vorname}}');
  await page.locator('#draft-tags').fill('8A, Informatik');
  await page.locator('#draft-body').fill('Hallo {{Vorname}} {{Nachname}},\n\nhier ist deine Arbeit. Viele Grüße!');
  await page.locator('#draft-prepare').click();
  await expect(page.locator('.draft-preview')).toHaveCount(2);
  await expect(page.locator('.draft-preview').first()).toContainText('[8A] [Informatik] Deine 8A-Arbeit, Anna');
  await expect(page.locator('.draft-preview').first()).toContainText('anna@example.org');
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
  await expect(page.getByRole('status')).toContainText('2 of 2 drafts saved in Gmail. Nothing was sent.');
  await expect(page.locator('#draft-toggle-review')).toHaveAttribute('aria-expanded', 'false');
  expect(created).toHaveLength(2);
  for (const [i, mime] of created.entries()) {
    expect(mime).toContain(`To: ${i === 0 ? 'anna' : 'lukas'}@example.org\r\n`);
    const boundary = mime.match(/boundary="([^"]+)"/)![1];
    const parts = mime.split(`--${boundary}`);
    expect(Buffer.from(parts[1].split('\r\n\r\n')[1].trim(), 'base64').toString('utf8')).toContain(i === 0 ? 'Anna Müller' : 'Lukas Schmidt');
    expect(Buffer.from(parts[2].split('\r\n\r\n')[1].trim(), 'base64')).toEqual(i === 0 ? bytes.a : bytes.b);
  }
  await page.locator('#draft-toggle-review').click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/drafts-mobile.png', fullPage: true });
});
