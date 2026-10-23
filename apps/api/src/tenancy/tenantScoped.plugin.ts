import type { Schema } from 'mongoose';

/** Owner-scoped models: queries must filter by ownerId. Enforcement lands in Task 3. */
export function tenantScoped(_schema: Schema): void {}
