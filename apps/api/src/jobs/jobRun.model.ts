import mongoose from 'mongoose';

/** Global, not per owner: one row per job name, the lease that keeps instances from running it twice at once. */
const jobRunSchema = new mongoose.Schema({
  /** The job name. */
  _id: { type: String, required: true },
  holder: { type: String, required: true },
  leaseUntil: { type: Date, required: true },
  lastStartedAt: { type: Date, required: true },
});

export const JobRun = mongoose.model('JobRun', jobRunSchema, 'jobRuns');
