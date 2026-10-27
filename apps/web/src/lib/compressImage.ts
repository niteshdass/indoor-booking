/** Types the API stores; anything else (HEIC, GIF, …) is re-encoded first. */
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Longest side after resizing: sharp on a full-width gallery, far smaller than a phone photo. */
export const MAX_IMAGE_SIDE = 2048;
/** Aim under this; quality steps down until it fits. */
export const TARGET_BYTES = 1024 * 1024;
/** The API's limit. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

const QUALITIES = [0.85, 0.75, 0.65];

const HEIC = /\.(heic|heif)$/i;
const looksHeic = (file: File) => file.type === 'image/heic' || file.type === 'image/heif' || HEIC.test(file.name);

/**
 * Decodes the file into a bitmap, upright. Browsers other than Safari can't read iPhone HEIC photos, so those go
 * through a WebAssembly decoder that is only downloaded the first time one is picked.
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    if (!looksHeic(file)) throw err;
    const { heicTo } = await import('heic-to');
    return heicTo({ blob: file, type: 'bitmap', options: { imageOrientation: 'from-image' } });
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Shrinks a photo for upload: at most `MAX_IMAGE_SIDE` on the long side, WebP at 0.85 (JPEG where the browser
 * can't write WebP), stepping quality down only while it is over `TARGET_BYTES`. A file that is already small,
 * of an accepted type and not oversized is kept as it is. Rejects when the browser can't decode the file.
 */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await decode(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const keep = scale === 1 && file.size <= TARGET_BYTES && (UPLOAD_TYPES as readonly string[]).includes(file.type);
    if (keep) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let type = 'image/webp';
    let best: Blob | null = null;
    for (const q of QUALITIES) {
      let blob = await toBlob(canvas, type, q);
      if (blob && blob.type !== type) {
        // No WebP encoder (older Safari): JPEG has no transparency, so paint white under the photo.
        type = 'image/jpeg';
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        blob = await toBlob(canvas, type, q);
      }
      if (!blob) break;
      best = blob;
      if (blob.size <= TARGET_BYTES) break;
    }
    if (!best) throw new Error('encode_failed');
    // A small original can beat its re-encode; send whichever is smaller.
    return file.size < best.size && scale === 1 && (UPLOAD_TYPES as readonly string[]).includes(file.type) ? file : best;
  } finally {
    bitmap.close();
  }
}
