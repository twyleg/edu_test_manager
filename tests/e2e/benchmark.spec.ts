import { test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockGoogleUi } from './googleMock';

test('scanner benchmark', async ({ page }) => {
  test.skip(!process.env.SCAN_BENCHMARK, 'Opt-in local benchmark');
  await mockGoogleUi(page);
  await page.goto('/');
  const bytes = (await readFile('20260911_142302_005443.pdf')).toString('base64');
  for (const threads of [1, 2, 4]) {
    const result = await page.evaluate(async ({ bytes, threads }) => {
      const modulePath = '/src/pdf.ts';
      const { scanPdf } = await import(modulePath);
      const input = Uint8Array.from(atob(bytes), char => char.charCodeAt(0));
      const start = performance.now();
      const pages = await scanPdf(input, () => {}, new AbortController().signal, threads);
      const ms = Math.round(performance.now() - start);
      pages.forEach((p: { thumbnailUrl: string }) => URL.revokeObjectURL(p.thumbnailUrl));
      return { threads, ms, markers: pages.map((p: { hasQr: boolean }) => p.hasQr) };
    }, { bytes, threads });
    console.log(JSON.stringify(result));
  }
});
