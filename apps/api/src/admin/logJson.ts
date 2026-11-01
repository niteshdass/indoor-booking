import type { PlatformAction, PlatformLogJson } from '@booking/shared';
import { User } from '../auth/user.model';
import { Review } from '../reviews/review.model';
import { Owner } from '../tenancy/owner.model';
import { Venue } from '../venues/venue.model';

type LogLean = {
  _id: unknown;
  actorId: unknown;
  action: string;
  entity: string;
  entityId: unknown;
  ownerId?: unknown;
  reason?: string | null;
  amount?: number | null;
  at: Date;
};

/** Log rows as JSON with actor and target names, looked up in one batch per collection. */
export async function platformLogJson(rows: LogLean[]): Promise<PlatformLogJson[]> {
  const ids = (entity: string) => rows.filter((r) => r.entity === entity).map((r) => r.entityId);
  const [users, owners, reviews] = await Promise.all([
    User.find({ _id: { $in: [...rows.map((r) => r.actorId), ...ids('user')] } }, { name: 1 }).lean(),
    Owner.find({ _id: { $in: ids('owner') } }, { name: 1 }).lean(),
    Review.find({ _id: { $in: ids('review') } }, { venueId: 1 }).setOptions({ crossTenant: true }).lean(),
  ]);
  const venues = await Venue.find({ _id: { $in: reviews.map((r) => r.venueId) } }, { name: 1 })
    .setOptions({ crossTenant: true })
    .lean();
  const names = new Map<string, string>([
    ...users.map((u) => [String(u._id), u.name] as const),
    ...owners.map((o) => [String(o._id), o.name] as const),
  ]);
  const venueName = new Map(venues.map((v) => [String(v._id), v.name]));
  for (const r of reviews) {
    const name = venueName.get(String(r.venueId));
    if (name) names.set(String(r._id), name);
  }
  return rows.map((r) => ({
    id: String(r._id),
    action: r.action as PlatformAction,
    actor: names.has(String(r.actorId)) ? { id: String(r.actorId), name: names.get(String(r.actorId))! } : null,
    entity: r.entity as PlatformLogJson['entity'],
    entityId: String(r.entityId),
    target: names.get(String(r.entityId)) ?? null,
    ownerId: r.ownerId ? String(r.ownerId) : null,
    reason: r.reason ?? null,
    amount: r.amount ?? null,
    at: r.at.toISOString(),
  }));
}
