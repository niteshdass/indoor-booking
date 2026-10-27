import express, { Router } from 'express';
import mongoose from 'mongoose';
import type { Config } from '../config';
import { AppError } from '../errors';
import { requirePermission, tenantOf } from '../tenancy/context';
import { Image, IMAGE_TYPES, type ImageType } from './image.model';

/** Uploads arrive compressed (long side 2048px or less), so this is generous headroom, not a target. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Unclaimed uploads one owner may have at a time; they are claimed by saving a venue or swept after a day. */
export const MAX_PENDING_IMAGES = 30;
/** All of one owner's stored images together. */
export const MAX_OWNER_IMAGE_BYTES = 200 * 1024 * 1024;

/** The public address of an uploaded image; venue photos may point here as well as at any https URL. */
export const imageBase = (config: Config) => `${config.apiUrl}/api/v1/images/`;

/** The type the bytes really are, from their signature; the Content-Type header is not trusted. */
export function sniffImage(b: Buffer): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Mounted on ownerRouter: POST the raw image bytes, get back its URL. */
export function ownerImagesRouter(config: Config): Router {
  const router = Router({ mergeParams: true });
  router.post(
    '/images',
    requirePermission('venue.manage'),
    express.raw({ type: [...IMAGE_TYPES], limit: MAX_IMAGE_BYTES }),
    async (req, res) => {
      const t = tenantOf(req);
      const body: unknown = req.body;
      const type = Buffer.isBuffer(body) ? sniffImage(body) : null;
      if (!Buffer.isBuffer(body) || type === null) {
        throw new AppError(415, 'unsupported_image', 'Upload a JPEG, PNG or WebP image');
      }
      const [pending, stored] = await Promise.all([
        Image.countDocuments({ ownerId: t.ownerId, venueId: null }),
        Image.aggregate<{ bytes: number }>([
          { $match: { ownerId: new mongoose.Types.ObjectId(t.ownerId) } },
          { $group: { _id: null, bytes: { $sum: '$bytes' } } },
        ]),
      ]);
      if (pending >= MAX_PENDING_IMAGES) {
        throw new AppError(429, 'too_many_uploads', 'Save the venue or wait before uploading more photos');
      }
      if ((stored[0]?.bytes ?? 0) + body.length > MAX_OWNER_IMAGE_BYTES) {
        throw new AppError(409, 'image_storage_full', 'Photo storage for this team is full');
      }
      const image = await Image.create({ ownerId: t.ownerId, uploadedBy: t.userId, contentType: type, bytes: body.length, data: body });
      res.status(201).json({ image: { id: image.id as string, url: `${imageBase(config)}${image.id as string}`, bytes: body.length } });
    },
  );
  return router;
}

/** Public: the image bytes. Ids never change content, so browsers and CDNs may keep them for a year. */
export function publicImagesRouter(): Router {
  const router = Router();
  router.get('/images/:id', async (req, res) => {
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'not_found', 'Image not found');
    const image = await Image.findById(id, { contentType: 1, data: 1 }).setOptions({ crossTenant: true });
    if (!image) throw new AppError(404, 'not_found', 'Image not found');
    res.set({
      'Content-Type': image.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(image.data);
  });
  return router;
}
