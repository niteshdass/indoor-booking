import type { AnyBulkWriteOperation, Aggregate, Schema } from 'mongoose';

const QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'countDocuments',
  'distinct',
] as const;

const hasOwnerId = (obj: unknown): boolean =>
  typeof obj === 'object' && obj !== null && Object.hasOwn(obj, 'ownerId');

/**
 * Safety net for multi-tenancy: queries on the model must filter on ownerId, or opt out
 * explicitly with `.setOptions({ crossTenant: true })`. Document saves rely on ownerId being
 * `required` in the schema instead (Role leaves it optional for system roles).
 *
 * `estimatedDocumentCount` has no filter, so it always needs the opt-out. `bulkWrite` checks each
 * operation's filter (or, for insertOne, its document).
 *
 * Document-level `doc.updateOne()` / `doc.deleteOne()` are rejected: Mongoose adds their `_id`
 * filter after schema hooks run. Use `doc.save()` or the tenantRepo methods instead.
 */
export function tenantScoped(schema: Schema): void {
  schema.pre([...QUERY_OPS], { document: false, query: true }, function () {
    if (hasOwnerId(this.getFilter()) || this.getOptions().crossTenant === true) return;
    const op = (this as unknown as { op?: string }).op;
    throw new Error(`Tenant filter missing: ${this.model.modelName}.${op}`);
  });

  schema.pre('estimatedDocumentCount', function () {
    if (this.getOptions().crossTenant === true) return;
    throw new Error(`Tenant filter missing: ${this.model.modelName}.estimatedDocumentCount`);
  });

  schema.pre('bulkWrite', function (next, ops: AnyBulkWriteOperation[]) {
    for (const op of ops) {
      const body = Object.values(op)[0] as { filter?: unknown; document?: unknown };
      if (body.document !== undefined ? !hasOwnerId(body.document) : !hasOwnerId(body.filter)) {
        throw new Error(`Tenant filter missing: ${this.modelName}.bulkWrite`);
      }
    }
    next();
  });

  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    if ((this.options as { crossTenant?: boolean }).crossTenant === true) return;
    const first = this.pipeline()[0] as Record<string, unknown> | undefined;
    const geoNear = first?.$geoNear as { query?: unknown } | undefined;
    if (hasOwnerId(first?.$match) || hasOwnerId(geoNear?.query)) return;
    throw new Error(`Tenant filter missing: ${this.model().modelName}.aggregate`);
  });
}
