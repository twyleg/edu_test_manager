import { describe, expect, it, vi } from 'vitest';
import { ExamCache } from '../src/examCache';

const exam = { id: 'exam-a', name: 'scan.pdf', mimeType: 'application/pdf', md5Checksum: 'original' };
const signal = () => new AbortController().signal;
function setup(limit?: number) {
  const drive = { downloadPdf: vi.fn(async () => new Uint8Array([1, 2, 3])) };
  const render = vi.fn(async () => new Blob(['crop']));
  return { drive, render, cache: new ExamCache(drive, render, limit) };
}

describe('shared course exam cache', () => {
  it('reuses downloaded bytes and rendered corners after renaming and switching tasks', async () => {
    const { cache, drive, render } = setup();
    cache.setCourse('course');
    const preview = await cache.get(exam, signal());
    const progress = vi.fn();
    expect(await cache.get({ ...exam, name: '01_Müller_Anna.pdf' }, signal(), progress)).toBe(preview);
    expect(drive.downloadPdf).toHaveBeenCalledOnce(); expect(render).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(3, 3);
  });
  it('reuses an in-flight prefetch instead of starting a second download', async () => {
    const { cache, drive } = setup();
    let resolve!: (bytes: Uint8Array) => void;
    drive.downloadPdf.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const background = cache.get(exam, signal());
    const foreground = cache.get(exam, signal());
    resolve(new Uint8Array([1]));
    expect(await foreground).toBe(await background);
    expect(drive.downloadPdf).toHaveBeenCalledOnce();
  });
  it('lets a foreground reader finish if the prefetch consumer is cancelled', async () => {
    const { cache, drive } = setup();
    let resolve!: (bytes: Uint8Array) => void;
    drive.downloadPdf.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const background = cache.get(exam, controller.signal);
    const rejected = expect(background).rejects.toMatchObject({ name: 'AbortError' });
    const foreground = cache.get(exam, signal());
    controller.abort(); await rejected;
    resolve(new Uint8Array([1]));
    expect((await foreground).bytes).toEqual(new Uint8Array([1]));
    expect(drive.downloadPdf).toHaveBeenCalledOnce();
  });
  it('invalidates changed PDF contents while retaining a renamed PDF', async () => {
    const { cache, drive, render } = setup();
    await cache.get(exam, signal());
    await cache.get({ ...exam, md5Checksum: 'changed' }, signal());
    expect(drive.downloadPdf).toHaveBeenCalledTimes(2); expect(render).toHaveBeenCalledTimes(2);
  });
  it('clears the cache when the course changes or the session is disconnected', async () => {
    const { cache, drive } = setup();
    cache.setCourse('a'); await cache.get(exam, signal());
    cache.setCourse('a'); await cache.get(exam, signal());
    expect(drive.downloadPdf).toHaveBeenCalledOnce();
    cache.setCourse('b'); await cache.get(exam, signal());
    cache.clear(); await cache.get(exam, signal());
    expect(drive.downloadPdf).toHaveBeenCalledTimes(3);
  });
  it('does not retain failed downloads or rendering failures', async () => {
    const { cache, drive, render } = setup();
    drive.downloadPdf.mockRejectedValueOnce(new Error('Download failed'));
    await expect(cache.get(exam, signal())).rejects.toThrow('Download failed');
    render.mockRejectedValueOnce(new Error('Render failed'));
    await expect(cache.get(exam, signal())).rejects.toThrow('Render failed');
    await cache.get(exam, signal());
    expect(drive.downloadPdf).toHaveBeenCalledTimes(3);
  });
  it('bounds memory while keeping a task’s held preview usable after eviction', async () => {
    const { cache, drive } = setup(7);
    const first = await cache.get(exam, signal());
    await cache.get({ ...exam, id: 'exam-b' }, signal());
    expect(await first.corner.text()).toBe('crop');
    expect(first.bytes).toEqual(new Uint8Array([1, 2, 3]));
    await cache.get(exam, signal());
    expect(drive.downloadPdf).toHaveBeenCalledTimes(3);
  });
  it('aborts in-flight course requests and does not cache their stale results', async () => {
    const { cache, drive } = setup();
    let resolve!: (bytes: Uint8Array) => void;
    drive.downloadPdf.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = cache.get(exam, signal());
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    cache.clear(); resolve(new Uint8Array([1])); await rejected;
    await cache.get(exam, signal());
    expect(drive.downloadPdf).toHaveBeenCalledTimes(2);
  });
});
