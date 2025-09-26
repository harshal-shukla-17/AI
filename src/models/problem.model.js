import mongoose from 'mongoose';

const testSchema = new mongoose.Schema({
  input: { type: mongoose.Schema.Types.Mixed, required: true },
  output: { type: mongoose.Schema.Types.Mixed, required: true }
}, { _id: false });

const problemSchema = new mongoose.Schema({
  id: { type: Number, unique: true, index: true },
  slug: { type: String, unique: true, index: true },
  title: { type: String, required: true },
  difficulty: { type: String, default: 'Easy' },
  tags: { type: [String], default: [] },
  statement: { type: String, required: true },
  tests: { type: [testSchema], default: [] },
  starterCode: { type: mongoose.Schema.Types.Mixed, default: {} },
  timeLimitMs: { type: Number, default: 2000 }
});

export default mongoose.model('Problem', problemSchema);
