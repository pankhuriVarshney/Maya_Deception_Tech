import mongoose, { Schema, Document } from 'mongoose';

export interface IBenchmarkRun extends Document {
  runId: string;
  status: 'running' | 'completed' | 'failed';
  config: any;
  startedAt: Date;
  finishedAt?: Date;
  log: any[];
  results: any;
  matrix: any;
  error?: string;
}

const BenchmarkRunSchema: Schema = new Schema(
  {
    runId: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
    config: { type: Schema.Types.Mixed },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    log: { type: Schema.Types.Mixed, default: [] },
    results: { type: Schema.Types.Mixed, default: {} },
    matrix: { type: Schema.Types.Mixed, default: null },
    error: { type: String },
  },
  { timestamps: true, minimize: false, collection: 'benchmark_runs' }
);

export default mongoose.model<IBenchmarkRun>('BenchmarkRun', BenchmarkRunSchema);
