// Usage: node test-parser.js <input.json> <output.json>
// <input.json> = array of { id, domain, received_at, message } (e.g. messages_train.json)
// <output.json> = where predictions get written (score against it with score.py)
import { readFileSync, writeFileSync } from 'fs';
import { parseWithRules } from './rules-parser.js';

const [, , inputPath = 'messages_train.json', outputPath = 'pred.json'] = process.argv;

const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
const out = data.map((d) => ({ id: d.id, ...parseWithRules(d.message, d.received_at, d.domain) }));
writeFileSync(outputPath, JSON.stringify(out, null, 1));
console.log(`wrote ${out.length} predictions to ${outputPath}`);
console.log(`score with: python score.py --gold ${inputPath} --pred ${outputPath}`);
