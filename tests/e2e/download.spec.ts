import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mockGoogleUi } from './googleMock';

test('floating progress follows a streamed Drive download and then scanning', async ({ page }) => {
  await mockGoogleUi(page);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Array.from(await pdf.save());
  await page.addInitScript(({ length }) => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).includes('/files/source-pdf?fields=size')) return Response.json({ size: String(length) });
      if (String(input).includes('/files/source-pdf?alt=media')) {
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
          Object.assign(window, { downloadChunk: (bytes: number[]) => controller.enqueue(new Uint8Array(bytes)), downloadDone: () => controller.close() });
        } });
        return new Response(stream);
      }
      return original(input, init);
    };
  }, { length: bytes.length });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('button', { name: 'Choose PDF from Drive' }).click();
  await expect(page.locator('.file-selection').first()).toContainText('Drive exam.pdf');
  await page.getByRole('button', { name: 'Scan PDF', exact: true }).click();
  const island = page.locator('.progress-island');
  await expect(island).toBeFocused();
  await expect(island).toHaveCSS('position', 'fixed');
  await expect(page.getByRole('status')).toContainText('(0%)');
  await page.waitForFunction(() => typeof (window as unknown as { downloadChunk?: unknown }).downloadChunk === 'function');
  const originalBar = await page.locator('.progress-bar').elementHandle();
  const half = Math.floor(bytes.length / 2);
  await page.evaluate(bytes => (window as unknown as { downloadChunk: (bytes: number[]) => void }).downloadChunk(bytes), bytes.slice(0, half));
  await expect(page.getByRole('status')).toContainText('(50%)');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  expect(await originalBar!.evaluate(node => node === document.querySelector('.progress-bar'))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const box = await island.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/download-island.png', fullPage: false });
  await page.evaluate(bytes => {
    const api = window as unknown as { downloadChunk: (bytes: number[]) => void; downloadDone: () => void };
    api.downloadChunk(bytes); api.downloadDone();
  }, bytes.slice(half));
  await expect(page.getByRole('status')).toContainText('Scan complete');
  await expect(island).toHaveCount(0);
  await expect(page.locator('#toggle-review')).toBeFocused();
});

test('unknown download size shows activity and received bytes, and can be cancelled', async ({ page }) => {
  await mockGoogleUi(page);
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).includes('/files/source-pdf?fields=size')) return Response.json({});
      if (String(input).includes('/files/source-pdf?alt=media')) {
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new Uint8Array(2048));
          Object.assign(window, { moreDownloadBytes: () => controller.enqueue(new Uint8Array(2048)) });
        } }));
      }
      return original(input, init);
    };
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Slice exams', exact: true }).click();
  await page.getByRole('button', { name: 'Choose PDF from Drive' }).click();
  await expect(page.locator('.file-selection').first()).toContainText('Drive exam.pdf');
  await page.getByRole('button', { name: 'Scan PDF', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('2.0 KB received');
  await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  await expect(page.locator('.progress-indeterminate')).toBeVisible();
  const animationState = await page.locator('.progress-bar').evaluate(async bar => {
    const animation = bar.getAnimations()[0];
    await new Promise(resolve => setTimeout(resolve, 180));
    const before = Number(animation.currentTime);
    (window as unknown as { moreDownloadBytes: () => void }).moreDownloadBytes();
    // Wait for the stream callback and a new animation frame.
    await new Promise(resolve => setTimeout(resolve, 100));
    return {
      sameNode: document.querySelector('.progress-bar') === bar,
      sameAnimation: document.querySelector('.progress-bar')?.getAnimations()[0] === animation,
      advanced: Number(animation.currentTime) > before,
    };
  });
  expect(animationState).toEqual({ sameNode: true, sameAnimation: true, advanced: true });
  await expect(page.getByRole('status')).toContainText('4.0 KB received');
  await page.getByRole('button', { name: 'Cancel scan' }).click();
  await expect(page.getByRole('status')).toContainText('Scan cancelled');
  await expect(page.locator('.progress-island')).toHaveCount(0);
  await expect(page.locator('.page-card')).toHaveCount(0);
});
