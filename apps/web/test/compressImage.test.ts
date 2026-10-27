import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressImage, MAX_IMAGE_SIDE, TARGET_BYTES } from '../src/lib/compressImage';

const heic = vi.hoisted(() => ({ heicTo: vi.fn() }));
vi.mock('heic-to', () => heic);

// jsdom has no image decoding or canvas encoding; these fakes record what compressImage asks for.
const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() });
let encoded: { type: string; quality: number }[];
let sizeFor: (type: string, quality: number) => number;
let canvasSize: { w: number; h: number };

beforeEach(() => {
  encoded = [];
  sizeFor = () => 500_000;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), fillRect: vi.fn() } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb, type = 'image/png', quality = 1) {
    canvasSize = { w: this.width, h: this.height };
    encoded.push({ type, quality });
    cb(new Blob([new Uint8Array(sizeFor(type, quality))], { type }));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  heic.heicTo.mockReset();
});

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

describe('compressImage', () => {
  it('keeps a small photo of an accepted type as it is', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap(800, 600)));
    const f = file('a.jpg', 'image/jpeg', 1000);
    expect(await compressImage(f)).toBe(f);
    expect(encoded).toEqual([]);
  });

  it('scales the long side down and writes WebP, lowering quality only while over the target', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap(4000, 3000)));
    sizeFor = (_, q) => (q > 0.7 ? TARGET_BYTES + 1 : TARGET_BYTES - 1);
    const out = await compressImage(file('big.jpg', 'image/jpeg', 4_000_000));
    expect(out.type).toBe('image/webp');
    expect(canvasSize).toEqual({ w: MAX_IMAGE_SIDE, h: 1536 });
    expect(encoded.map((e) => e.quality)).toEqual([0.85, 0.75, 0.65]);
  });

  it('decodes HEIC with the WebAssembly decoder when the browser cannot', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new DOMException('bad', 'InvalidStateError'))));
    heic.heicTo.mockResolvedValue(bitmap(3024, 4032));
    const out = await compressImage(file('IMG_0001.HEIC', ''));
    expect(heic.heicTo).toHaveBeenCalledWith(expect.objectContaining({ type: 'bitmap' }));
    expect(out.type).toBe('image/webp');
    expect(canvasSize).toEqual({ w: 1536, h: MAX_IMAGE_SIDE });
  });

  it('rejects a file that is not a photo without loading the decoder', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new DOMException('bad', 'InvalidStateError'))));
    await expect(compressImage(file('notes.txt', 'text/plain'))).rejects.toThrow();
    expect(heic.heicTo).not.toHaveBeenCalled();
  });
});
