import mongoose from 'mongoose';

/** Global, not per owner: one row per migration that has run. */
const migrationSchema = new mongoose.Schema({
  /** The migration id. */
  _id: { type: String, required: true },
  appliedAt: { type: Date, required: true },
  /** Rows the migration changed. */
  changed: { type: Number, required: true },
});

export const Migration = mongoose.model('Migration', migrationSchema, 'migrations');
