import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Image } from '../../src/images/image.model';
import { MAX_IMAGE_BYTES, MAX_OWNER_IMAGE_BYTES, MAX_PENDING_IMAGES, sniffImage } from '../../src/images/routes';
import { PENDING_IMAGE_TTL_MS, sweepPendingImages } from '../../src/images/attach';
import { MIGRATIONS } from '../../src/migrations';
import { Turf } from '../../src/venues/turf.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Image.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
beforeEach(async () => {
  const any = { crossTenant: true };
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    Role.deleteMany({ ownerId: { $ne: null } }),
    ActivityLog.deleteMany({}).setOptions(any),
    Venue.deleteMany({}).setOptions(any),
    Image.deleteMany({}).setOptions(any),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
});

const api = () => request(ctx.app);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(50, 2)]);
const upload = (body: Buffer, type: string, token = a.token) =>
  api().post(`/api/v1/owners/${a.ownerId}/images`).set(...bearer(token)).set('Content-Type', type).send(body);
const venue = (photos: { url: string }[]) => ({
  name: 'Green Turf',
  address: 'Road 1',
  city: 'Dhaka',
  country: 'BD',
  timezone: 'Asia/Dhaka',
  location: { lat: 23.81, lng: 90.41 },
  photos,
});

describe('images API', () => {
  it('sniffs the real type from the bytes', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(Buffer.from('<svg></svg>'))).toBeNull();
  });

  it('stores an upload and serves it publicly with a long cache', async () => {
    const res = await upload(WEBP, 'image/webp');
    expect(res.status).toBe(201);
    expect(res.body.image.url).toBe(`http://localhost:4000/api/v1/images/${res.body.image.id}`);
    expect(res.body.image.bytes).toBe(WEBP.length);

    const got = await api().get(`/api/v1/images/${res.body.image.id}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/webp');
    expect(got.headers['cache-control']).toContain('immutable');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(got.body as Buffer, WEBP)).toBe(0);
  });

  it('trusts the bytes, not the header, and rejects anything else', async () => {
    const lied = await upload(JPEG, 'image/png');
    expect(lied.status).toBe(201);
    expect((await Image.findOne({ ownerId: a.ownerId }).lean())!.contentType).toBe('image/jpeg');

    const svg = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png');
    expect(svg.status).toBe(415);
    expect(svg.body.error.code).toBe('unsupported_image');
    expect((await upload(JPEG, 'text/plain')).status).toBe(415);
  });

  it('rejects an upload over the size limit', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    const res = await upload(big, 'image/jpeg');
    expect(res.status).toBe(413);
  });

  it('needs venue.manage', async () => {
    const staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
    expect((await upload(JPEG, 'image/jpeg', staff.token)).status).toBe(403);
    expect((await api().post(`/api/v1/owners/${a.ownerId}/images`).set('Content-Type', 'image/jpeg').send(JPEG)).status).toBe(401);
  });

  it('unknown or malformed ids are 404', async () => {
    expect((await api().get('/api/v1/images/nope')).status).toBe(404);
    expect((await api().get('/api/v1/images/0123456789abcdef01234567')).status).toBe(404);
  });

  it('venue photos accept uploaded images and https URLs, at most three', async () => {
    const { url } = (await upload(JPEG, 'image/jpeg')).body.image;
    const venues = `/api/v1/owners/${a.ownerId}/venues`;
    const ok = await api().post(venues).set(...bearer(a.token)).send(venue([{ url }, { url: 'https://x.test/a.jpg' }]));
    expect(ok.status).toBe(201);
    expect(ok.body.venue.photos).toEqual([{ url }, { url: 'https://x.test/a.jpg' }]);

    const four = Array.from({ length: 4 }, () => ({ url }));
    expect((await api().post(venues).set(...bearer(a.token)).send(venue(four))).status).toBe(400);
    expect((await api().patch(`${venues}/${ok.body.venue.id}`).set(...bearer(a.token)).send({ photos: four })).status).toBe(400);
    expect((await api().post(venues).set(...bearer(a.token)).send(venue([{ url: 'http://x.test/a.jpg' }]))).status).toBe(400);
  });

  const venues = () => `/api/v1/owners/${a.ownerId}/venues`;
  const imageRow = (id: string) => Image.findOne({ ownerId: a.ownerId, _id: id }, { data: 0 }).lean();

  it('saving a venue claims its uploads and deletes the ones it drops; deleting the venue deletes the rest', async () => {
    const one = (await upload(JPEG, 'image/jpeg')).body.image;
    const two = (await upload(WEBP, 'image/webp')).body.image;
    const created = await api().post(venues()).set(...bearer(a.token)).send(venue([{ url: one.url }, { url: two.url }]));
    expect(created.status).toBe(201);
    const id = created.body.venue.id as string;
    expect(String((await imageRow(one.id))!.venueId)).toBe(id);

    const patched = await api().patch(`${venues()}/${id}`).set(...bearer(a.token)).send({ photos: [{ url: two.url }] });
    expect(patched.status).toBe(200);
    expect(await imageRow(one.id)).toBeNull();
    expect(String((await imageRow(two.id))!.venueId)).toBe(id);

    await Turf.init();
    expect((await api().delete(`${venues()}/${id}`).set(...bearer(a.token))).status).toBe(204);
    expect(await imageRow(two.id)).toBeNull();
  });

  it('sweeps uploads no venue claimed within a day', async () => {
    const old = (await upload(JPEG, 'image/jpeg')).body.image;
    const kept = (await upload(JPEG, 'image/jpeg')).body.image;
    const used = (await upload(JPEG, 'image/jpeg')).body.image;
    await api().post(venues()).set(...bearer(a.token)).send(venue([{ url: used.url }]));
    const now = new Date(Date.now() + PENDING_IMAGE_TTL_MS + 60_000);
    // createdAt is immutable through Mongoose, so set it on the raw collection.
    await Image.collection.updateOne({ _id: new mongoose.Types.ObjectId(kept.id as string) }, { $set: { createdAt: new Date(now.getTime() - 60_000) } });
    expect(await sweepPendingImages(now)).toBe(1);
    expect(await imageRow(old.id)).toBeNull();
    expect(await imageRow(kept.id)).not.toBeNull();
    expect(await imageRow(used.id)).not.toBeNull();
  });

  it("refuses another team's upload, a photo already on another venue, and unknown ids", async () => {
    const b = await seedOwner(ctx.services, { name: 'Other' });
    const theirs = await api().post(`/api/v1/owners/${b.ownerId}/images`).set(...bearer(b.token)).set('Content-Type', 'image/jpeg').send(JPEG);
    const stolen = await api().post(venues()).set(...bearer(a.token)).send(venue([{ url: theirs.body.image.url }]));
    expect(stolen.status).toBe(400);
    expect(stolen.body.error.code).toBe('invalid_photo');

    const mine = (await upload(JPEG, 'image/jpeg')).body.image;
    const first = await api().post(venues()).set(...bearer(a.token)).send(venue([{ url: mine.url }]));
    expect(first.status).toBe(201);
    const second = await api().post(venues()).set(...bearer(a.token)).send({ ...venue([]), name: 'Blue Turf' });
    const taken = await api().patch(`${venues()}/${second.body.venue.id}`).set(...bearer(a.token)).send({ photos: [{ url: mine.url }] });
    expect(taken.body.error.code).toBe('invalid_photo');
    // Saving the venue that owns it again is fine.
    expect((await api().patch(`${venues()}/${first.body.venue.id}`).set(...bearer(a.token)).send({ photos: [{ url: mine.url, alt: 'Court' }] })).status).toBe(200);

    const base = mine.url.slice(0, mine.url.lastIndexOf('/') + 1);
    for (const url of [`${base}0123456789abcdef01234567`, `${base}nope`]) {
      expect((await api().post(venues()).set(...bearer(a.token)).send(venue([{ url }]))).body.error.code).toBe('invalid_photo');
    }
  });

  it('limits unclaimed uploads and total storage per team', async () => {
    const row = { ownerId: a.ownerId, uploadedBy: a.userId, contentType: 'image/jpeg', data: JPEG };
    await Image.insertMany(Array.from({ length: MAX_PENDING_IMAGES }, () => ({ ...row, bytes: JPEG.length })));
    const many = await upload(JPEG, 'image/jpeg');
    expect(many.status).toBe(429);
    expect(many.body.error.code).toBe('too_many_uploads');

    await Image.deleteMany({ ownerId: a.ownerId });
    const v = await api().post(venues()).set(...bearer(a.token)).send(venue([]));
    await Image.create({ ...row, bytes: MAX_OWNER_IMAGE_BYTES - 10, venueId: v.body.venue.id });
    const full = await upload(JPEG, 'image/jpeg');
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('image_storage_full');
  });

  it('migration claims uploads that venues already show', async () => {
    const img = (await upload(JPEG, 'image/jpeg')).body.image;
    const v = await api().post(venues()).set(...bearer(a.token)).send(venue([{ url: img.url }]));
    await Image.updateOne({ ownerId: a.ownerId, _id: img.id }, { $unset: { venueId: '' } });
    const step = MIGRATIONS.find((m) => m.id === '2026-10-27-image-venue')!;
    expect(await step.run(new Date())).toBe(1);
    expect(String((await imageRow(img.id))!.venueId)).toBe(v.body.venue.id);
  });
});
