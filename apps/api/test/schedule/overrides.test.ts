import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { WEEKDAYS } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { SlotOverride, overridesFor } from '../../src/schedule/slotOverride.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    SlotOverride.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const hours = Object.fromEntries(WEEKDAYS.map((d) => [d, { open: '16:00', close: '22:00' }]));

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let v1: string;
let v2: string;
let t1: string;
let t2: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Turf.deleteMany({}).setOptions({ crossTenant: true }),
    SlotOverride.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  v1 = (await seedVenue(a.ownerId, { timezone: 'Asia/Dhaka' })).id as string;
  v2 = (await seedVenue(a.ownerId, { timezone: 'Asia/Dhaka' })).id as string;
  t1 = (await seedTurf(a.ownerId, v1, { slotLengthMin: 60, settings: { hours } })).id as string;
  t2 = (await seedTurf(a.ownerId, v2, { slotLengthMin: 60, settings: { hours } })).id as string;
});

const api = () => request(ctx.app);
const url = (venueId = v1, turfId = t1, ownerId = a.ownerId) =>
  `/api/v1/owners/${ownerId}/venues/${venueId}/turfs/${turfId}/overrides`;
const post = (body: unknown, token = a.token, venueId = v1, turfId = t1) =>
  api().post(url(venueId, turfId)).set(...bearer(token)).send(body as object);

const day = '2026-10-30'; // a Friday

describe('slot overrides', () => {
  it('add after closing time → 201; add over a generated slot → 409 override_overlap', async () => {
    const ok = await post({ date: day, type: 'add', start: '22:00', end: '23:00', price: 1500 });
    expect(ok.status).toBe(201);
    expect(ok.body.override).toMatchObject({ date: day, type: 'add', start: '22:00', end: '23:00', price: 1500, reason: null });
    const clash = await post({ date: day, type: 'add', start: '17:30', end: '18:30' });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({ code: 'override_overlap', message: 'This slot overlaps another slot on this turf' });
    const row = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'override.create' }).lean();
    expect(row).toMatchObject({ entity: 'override' });
    expect(String(row!.entityId)).toBe(ok.body.override.id);
  });

  it('add/add on intersecting dates → 409', async () => {
    expect((await post({ date: day, type: 'add', start: '22:00', end: '23:00' })).status).toBe(201);
    const fri = await post({ recurrence: { weekdays: ['fri'], from: '2026-10-01' }, type: 'add', start: '22:30', end: '23:30' });
    expect(fri.status).toBe(409);
    expect(fri.body.error.code).toBe('override_overlap');
    const sat = await post({ recurrence: { weekdays: ['sat'], from: '2026-10-01' }, type: 'add', start: '22:30', end: '23:30' });
    expect(sat.status).toBe(201);
    expect(sat.body.override.recurrence).toEqual({ weekdays: ['sat'], from: '2026-10-01' });
    // A recurrence ending before the dated add does not intersect it.
    const ended = await post({
      recurrence: { weekdays: ['fri'], from: '2026-10-01', until: '2026-10-29' },
      type: 'add',
      start: '22:30',
      end: '23:30',
    });
    expect(ended.status).toBe(201);
  });

  it('modify needs a matching slot', async () => {
    const over = await post({ date: day, type: 'modify', slotStart: '17:00', start: '17:00', end: '18:30' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('override_overlap');
    const ok = await post({ date: day, type: 'modify', slotStart: '21:00', start: '21:00', end: '22:30', price: 900 });
    expect(ok.status).toBe(201);
    const missing = await post({ date: day, type: 'modify', slotStart: '17:15', start: '17:15', end: '18:00' });
    expect(missing.status).toBe(409);
    expect(missing.body.error).toMatchObject({ code: 'slot_not_found', message: 'No slot starts at that time' });
  });

  it('recurring modify needs the slot on every listed weekday', async () => {
    await Turf.updateOne({ ownerId: a.ownerId, _id: t1 }, { $set: { 'settings.hours.sat': { open: '16:00', close: '20:00' } } });
    const res = await post({
      recurrence: { weekdays: ['fri', 'sat'], from: '2026-10-01' },
      type: 'modify',
      slotStart: '21:00',
      start: '21:00',
      end: '21:30',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('slot_not_found');
  });

  it('block and close never overlap-check', async () => {
    expect((await post({ date: day, type: 'block', start: '16:00', end: '18:00', reason: 'Maintenance' })).status).toBe(201);
    expect((await post({ date: day, type: 'close' })).status).toBe(201);
  });

  it('concurrent overlapping adds → exactly one wins', async () => {
    const res = await Promise.all([
      post({ date: day, type: 'add', start: '22:00', end: '23:00' }),
      post({ date: day, type: 'add', start: '22:30', end: '23:30' }),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409)!.body.error.code).toBe('override_overlap');
    expect(await SlotOverride.countDocuments({ ownerId: a.ownerId })).toBe(1);
  });

  it('past-midnight ranges sit on the business day timeline', async () => {
    const late = Object.fromEntries(WEEKDAYS.map((d) => [d, { open: '16:00', close: '02:00' }]));
    const t3 = (await seedTurf(a.ownerId, v1, { slotLengthMin: 60, settings: { hours: late } })).id as string;
    const clash = await post({ date: day, type: 'add', start: '01:00', end: '02:00' }, a.token, v1, t3);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('override_overlap');
    expect((await post({ date: day, type: 'add', start: '02:00', end: '03:00' }, a.token, v1, t3)).status).toBe(201);

    // 16:00-22:00: 23:00-01:30 is free; on that day 01:00-02:00 is the morning, but on the next
    // date it overlaps the extra running past midnight.
    expect((await post({ date: day, type: 'add', start: '23:00', end: '01:30' })).status).toBe(201);
    expect((await post({ date: day, type: 'add', start: '01:00', end: '02:00' })).status).toBe(201);
    const extra = await post({ date: '2026-10-31', type: 'add', start: '01:00', end: '02:00' });
    expect(extra.status).toBe(409);
    expect(extra.body.error.code).toBe('override_overlap');
  });

  it('a night spilling into a closed day: block is free, an add on the next date overlaps the night', async () => {
    const week = Object.fromEntries(WEEKDAYS.map((d) => [d, 'closed']));
    const t3 = (
      await seedTurf(a.ownerId, v1, { slotLengthMin: 60, settings: { hours: { ...week, sun: { open: '16:00', close: '02:00' } } } })
    ).id as string;
    expect((await post({ date: '2026-11-01', type: 'block', start: '00:00', end: '02:00' }, a.token, v1, t3)).status).toBe(201);
    const mon = await post({ date: '2026-11-02', type: 'add', start: '01:00', end: '02:00' }, a.token, v1, t3);
    expect(mon.status).toBe(409);
    expect(mon.body.error.code).toBe('override_overlap');
  });

  it('a pre-open add is that morning', async () => {
    const t3 = (
      await seedTurf(a.ownerId, v1, {
        slotLengthMin: 60,
        settings: { hours: { mon: { open: '10:00', close: '22:00' }, tue: { open: '10:00', close: '22:00' } } },
      })
    ).id as string;
    const tue = '2026-11-03';
    expect((await post({ date: tue, type: 'add', start: '08:00', end: '09:00' }, a.token, v1, t3)).status).toBe(201);
    const slots = await api()
      .get(`/api/v1/owners/${a.ownerId}/venues/${v1}/turfs/${t3}/slots?date=${tue}`)
      .set(...bearer(a.token));
    expect(slots.status).toBe(200);
    expect(slots.body.day.slots[0]).toMatchObject({
      startAt: '2026-11-03T02:00:00.000Z', // 08:00 Dhaka
      localStart: '08:00',
      source: 'add',
    });
  });

  it('overlap is checked against the neighbour days', async () => {
    const early = Object.fromEntries(WEEKDAYS.map((d) => [d, { open: '06:00', close: '02:00' }]));
    const t3 = (await seedTurf(a.ownerId, v1, { slotLengthMin: 60, settings: { hours: early } })).id as string;
    const spill = await post({ date: day, type: 'add', start: '05:30', end: '06:30' }, a.token, v1, t3);
    expect(spill.status).toBe(409);
    expect(spill.body.error.code).toBe('override_overlap');
    expect((await post({ date: day, type: 'add', start: '02:00', end: '05:00' }, a.token, v1, t3)).status).toBe(201);

    // 16:00-22:00 daily: 23:00-17:00 reaches Saturday's 16:00 slot.
    const long = await post({ date: day, type: 'add', start: '23:00', end: '17:00' });
    expect(long.status).toBe(409);
    expect(long.body.error.code).toBe('override_overlap');
    expect((await post({ date: day, type: 'add', start: '23:00', end: '01:00' })).status).toBe(201);
    const sat = await post({ date: '2026-10-31', type: 'add', start: '00:30', end: '01:30' });
    expect(sat.status).toBe(409);
    expect(sat.body.error.code).toBe('override_overlap');
    // The same pair with recurrences: a Saturday recurrence meets the Friday one a day later.
    const fri = { recurrence: { weekdays: ['fri'], from: '2026-11-01' }, type: 'add', start: '23:00', end: '01:00' };
    expect((await post(fri)).status).toBe(201);
    const satRec = await post({ recurrence: { weekdays: ['sat'], from: '2026-11-07' }, type: 'add', start: '00:30', end: '01:30' });
    expect(satRec.status).toBe(409);
    // Ending before the Friday recurrence starts, it never follows one.
    const before = { weekdays: ['sat'], from: '2026-10-01', until: '2026-10-24' };
    expect((await post({ recurrence: before, type: 'add', start: '00:30', end: '01:30' })).status).toBe(201);
  });

  it('rejects an extra reaching two days ahead', async () => {
    const night = Object.fromEntries(WEEKDAYS.map((d) => [d, { open: '18:00', close: '06:00' }]));
    const t3 = (await seedTurf(a.ownerId, v1, { slotLengthMin: 60, settings: { hours: night } })).id as string;
    // 05:00 is the tail of the night (mapped 1740), so 05:00-04:00 would end at 3120.
    const long = await post({ date: day, type: 'add', start: '05:00', end: '04:00' }, a.token, v1, t3);
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe('override_too_long');
    // 02:00-05:00 sits inside the night (409), so an in-bound morning extra stands in for "unaffected".
    expect((await post({ date: day, type: 'add', start: '06:00', end: '09:00' }, a.token, v1, t3)).status).toBe(201);
  });

  it('blocks have no bound or overlap check', async () => {
    const block = await post({ recurrence: { weekdays: ['fri'], from: '2026-10-01' }, type: 'block', start: '23:00', end: '17:00' });
    expect(block.status).toBe(201);
  });

  it('validation', async () => {
    const add = { type: 'add', start: '22:00', end: '23:00' };
    const rec = { weekdays: ['fri'], from: '2026-10-01' };
    const bad = [
      { ...add, date: day, recurrence: rec },
      { ...add },
      { date: day, type: 'block', start: '16:00', end: '18:00', price: 100 },
      { ...add, recurrence: { weekdays: ['fri'], from: '2026-10-10', until: '2026-10-09' } },
      { ...add, date: '2026-02-30' },
      { ...add, recurrence: { weekdays: [], from: '2026-10-01' } },
      { ...add, recurrence: { weekdays: ['fri', 'fri'], from: '2026-10-01' } },
      { date: day, type: 'close', start: '16:00' },
      { date: day, type: 'add', start: '22:00' },
      { ...add, recurrence: { weekdays: ['mon'], from: '2026-10-30', until: '2026-10-31' } },
    ];
    for (const body of bad) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
  });

  it('lists, finds and deletes', async () => {
    const dated = (await post({ date: day, type: 'add', start: '22:00', end: '23:00' })).body.override;
    const rec = (await post({ recurrence: { weekdays: ['sat'], from: '2026-10-01' }, type: 'block', start: '16:00', end: '17:00', reason: 'Kids' })).body.override;
    await post({ date: '2026-11-20', type: 'close' });

    const list = await api().get(`${url()}?from=2026-10-30&to=2026-10-31`).set(...bearer(a.token));
    expect(list.status).toBe(200);
    expect(list.body.overrides.map((o: { id: string }) => o.id).sort()).toEqual([dated.id, rec.id].sort());
    expect((await api().get(`${url()}?from=2026-10-31&to=2026-10-30`).set(...bearer(a.token))).status).toBe(400);

    expect(await overridesFor(a.ownerId, t1, day)).toEqual([
      { type: 'add', start: '22:00', end: '23:00', reason: null },
    ]);
    expect(await overridesFor(a.ownerId, t1, '2026-10-31')).toEqual([
      { type: 'block', start: '16:00', end: '17:00', reason: 'Kids' },
    ]);
    expect(await overridesFor(a.ownerId, t1, '2026-09-26')).toEqual([]);
    expect(await overridesFor(a.ownerId, t2, day)).toEqual([]);

    await api().delete(`${url()}/${dated.id}`).set(...bearer(a.token)).expect(204);
    expect(await overridesFor(a.ownerId, t1, day)).toEqual([]);
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, action: 'override.delete' })).toBe(1);
    expect((await api().delete(`${url()}/${dated.id}`).set(...bearer(a.token))).status).toBe(404);
    expect((await api().delete(`${url()}/not-an-id`).set(...bearer(a.token))).status).toBe(404);
  });

  it('scope', async () => {
    const staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff', venueIds: 'all' });
    const body = { date: day, type: 'add', start: '22:00', end: '23:00' };
    const denied = await post(body, staff.token);
    expect(denied.status).toBe(403);
    expect((await api().get(`${url()}?from=${day}&to=${day}`).set(...bearer(staff.token))).status).toBe(200);

    const m = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
    expect((await post(body, m.token)).status).toBe(201);
    const out = await post(body, m.token, v2, t2);
    expect(out.status).toBe(404);
    expect((await api().get(`${url(v2, t2)}?from=${day}&to=${day}`).set(...bearer(m.token))).status).toBe(404);
    const own = (await post(body, a.token, v2, t2)).body.override.id;
    expect((await api().delete(`${url(v2, t2)}/${own}`).set(...bearer(m.token))).status).toBe(404);
    // The override id alone is not enough: it must belong to the turf in the URL.
    expect((await api().delete(`${url(v1, t1)}/${own}`).set(...bearer(a.token))).status).toBe(404);

    const b = await seedOwner(ctx.services, { name: 'B' });
    const bv = (await seedVenue(b.ownerId)).id as string;
    const bt = (await seedTurf(b.ownerId, bv, { settings: { hours } })).id as string;
    const bOverride = await api().post(url(bv, bt, b.ownerId)).set(...bearer(b.token)).send(body);
    expect(bOverride.status).toBe(201);
    const del = await api().delete(`${url(bv, bt)}/${bOverride.body.override.id}`).set(...bearer(a.token));
    expect(del.status).toBe(404);
    expect(await SlotOverride.countDocuments({ ownerId: b.ownerId })).toBe(1);
  });
});
