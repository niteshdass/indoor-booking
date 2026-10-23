import mongoose, { type FilterQuery, type Model, type ProjectionType, type UpdateQuery } from 'mongoose';
import { AppError } from '../errors';
import { hasVenueAccess, type TenantContext } from './context';

/**
 * Data access for one owner's documents. Every filter gets the tenant's ownerId (overriding any
 * caller-supplied one) and, with venueField, the member's venue scope.
 */
export function tenantRepo<T>(model: Model<T>, t: TenantContext, opts: { venueField?: string } = {}) {
  const { venueField } = opts;
  const venueScoped = venueField !== undefined && t.venueIds !== 'all';

  function scoped(filter: FilterQuery<T> = {}): FilterQuery<T> {
    const out: Record<string, unknown> = { ...filter, ownerId: t.ownerId };
    if (venueScoped) {
      // $and keeps a caller's own condition on the venue field alongside the scope.
      const prior = Array.isArray(out.$and) ? out.$and : [];
      out.$and = [...prior, { [venueField]: { $in: t.venueIds } }];
    }
    return out as FilterQuery<T>;
  }

  return {
    find(filter?: FilterQuery<T>, projection?: ProjectionType<T>) {
      return model.find(scoped(filter), projection);
    },
    findOne(filter?: FilterQuery<T>) {
      return model.findOne(scoped(filter));
    },
    async findById(id: string) {
      if (!mongoose.isValidObjectId(id)) return null;
      return model.findOne(scoped({ _id: id } as FilterQuery<T>));
    },
    countDocuments(filter?: FilterQuery<T>) {
      return model.countDocuments(scoped(filter));
    },
    async create(doc: Partial<Record<keyof T, unknown>> & Record<string, unknown>) {
      if (venueField !== undefined) {
        const venueId = doc[venueField];
        if (venueId == null || !hasVenueAccess(t, String(venueId))) {
          if (t.venueIds !== 'all') throw new AppError(404, 'not_found', 'Venue not found');
        }
      }
      return model.create({ ...doc, ownerId: t.ownerId });
    },
    updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>) {
      return model.updateOne(scoped(filter), update);
    },
    deleteOne(filter: FilterQuery<T>) {
      return model.deleteOne(scoped(filter));
    },
  };
}
