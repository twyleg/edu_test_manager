import jsQR from 'jsqr';

self.onmessage = (
  event: MessageEvent<{ data: Uint8ClampedArray; width: number; height: number }>,
) => {
  const { data, width, height } = event.data;
  try {
    self.postMessage({
      hasQr: Boolean(jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })),
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'QR detection failed.' });
  }
};
