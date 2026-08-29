/**
 * batch-runner.js
 * ---------------
 * Batch entry point for Test A judging. Reads a JSON file of messages (same
 * shape as messages_train.json, with or without `expected`), runs the full
 * parsing pipeline across every message, and emits results in the exact
 * shape `sample_submission.json` expects.
 *
 * This script is what keeps the team from losing the entire Test A criterion
 * ("a team that cannot run the test loses the entire criterion").
 *
 * Usage:
 *   node batch-runner.js <input.json> <output.json> [--mode rules|full]
 *
 * Modes:
 *   --mode rules  (default) — uses parseWithRules directly. No network needed.
 *                 This is what you run when you don't have a live HF endpoint.
 *   --mode full   — attempts the online LLM path first (requires HF_ENDPOINT_URL
 *                 and HF_API_TOKEN env vars), falls back to rules on failure.
 *                 Use this only when the HF endpoint is confirmed live.
 *
 * Output shape matches sample_submission.json:
 *   [ { id, customer, items, due_date, amount, references_prior_order,
 *       confidence, needs_clarification }, ... ]
 *
 * Score the output:
 *   python score.py --gold <input.json> --pred <output.json>
 */
import { readFileSync, writeFileSync } from 'fs';
import { parseWithRules } from './parser/rules-parser.js';

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

let inputPath = 'messages_train.json';
let outputPath = 'submission.json';
let mode = 'rules';

// Simple arg parser: positional args for input/output, --mode flag
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mode' && i + 1 < args.length) {
    mode = args[++i];
  } else if (args[i].startsWith('--')) {
    console.error(`Unknown flag: ${args[i]}`);
    process.exit(1);
  } else {
    positional.push(args[i]);
  }
}
if (positional.length >= 1) inputPath = positional[0];
if (positional.length >= 2) outputPath = positional[1];

if (!['rules', 'full'].includes(mode)) {
  console.error(`Invalid mode "${mode}". Use "rules" or "full".`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Online parse function (for --mode full)
// ---------------------------------------------------------------------------

/**
 * Attempt to parse via the online LLM path by calling the Vercel serverless
 * Attempt to parse via the LLM by calling the local Ollama instance
 * (or a remote endpoint if LLM_ENDPOINT_URL is set).
 *
 * Falls back to rules on any failure (same contract as parse-message.js).
 */
async function parseOnlineThenFallback(message, receivedAt, domain) {
  const endpoint = process.env.LLM_ENDPOINT_URL
    || process.env.HF_ENDPOINT_URL
    || 'http://localhost:11434/v1/chat/completions';
  const token = process.env.HF_API_TOKEN || null;
  const modelName = process.env.LLM_MODEL || 'qwen2.5:3b';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000); // 30s for batch (model may be cold)

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelName,
        messages: buildPrompt(message, receivedAt, domain),
        max_tokens: 1024,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`LLM endpoint returned ${response.status}`);
    }

    const data = await response.json();

    // Handle chat completions format (Ollama / OpenAI-compatible)
    let text;
    if (data.choices && data.choices[0]?.message?.content) {
      text = data.choices[0].message.content;
    } else if (Array.isArray(data) && data[0]?.generated_text) {
      text = data[0].generated_text;
    } else if (data.generated_text) {
      text = data.generated_text;
    }
    if (!text) throw new Error('No generated text in response');

    // Extract JSON from the response
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = codeBlock ? codeBlock[1].trim() : text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) throw new Error('No JSON found in LLM response');

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    const required = ['customer', 'items', 'due_date', 'amount',
      'references_prior_order', 'confidence', 'needs_clarification'];
    for (const f of required) {
      if (!(f in parsed)) throw new Error(`Missing field: ${f}`);
    }

    return parsed;
  } catch {
    // Any failure → deterministic rules fallback
    return parseWithRules(message, receivedAt, domain);
  }
}

/**
 * Build the chat messages array for the LLM (same prompt as api/parse-message.js).
 */
function buildPrompt(message, receivedAt, domain) {
  const vocabMap = {
    tailor: 'color, fabric, chest, waist, length, sleeve, size, fit',
    tiffin: 'portion, spice_level, meal, roti_count, jain, days',
    electrician: 'appliance, issue, room, brand, wattage',
    baker: 'flavour, weight_kg, egg_free, tier, message_on_cake, shape',
  };
  const vocab = vocabMap[domain] || '';

  return [
    {
      role: 'system',
      content: `You are a structured data extraction system for Indian small businesses.
Parse Hinglish customer messages into JSON. Output ONLY valid JSON.
Rules:
- customer: name if stated ("X ke liye", "X ka order"), else null. "bhaiya" is NOT a name.
- items: [{description (lowercase singular), quantity (integer, default 1), attributes}]
- due_date: YYYY-MM-DD resolved against received_at (${receivedAt}). aaj=+0, kal=+1, parso=+2, tarso/narsu=+3. "agle <weekday>"=strictly next. Vague (jaldi,asap,urgent)→null+needs_clarification.
- amount: INR number or null. dedh hazaar=1500, do hazaar=2000.
- references_prior_order: true if "last time jaisa" etc, false if negated.
- confidence: 0-1
- needs_clarification: true if no item, ambiguous qty, vague deadline, or blocking attr missing.
- Attribute keys MUST be from: [${vocab}]. No other keys.
- Negation: "X nahi, Y" means drop X keep Y. But "jain nahi"=jain:false.
Output ONLY JSON, no explanation.`,
    },
    {
      role: 'user',
      content: `Domain: ${domain}\nReceived at: ${receivedAt}\nMessage: "${message}"\n\nParse into JSON.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Main batch processing
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n  batch-runner.js`);
  console.log(`  mode:   ${mode}`);
  console.log(`  input:  ${inputPath}`);
  console.log(`  output: ${outputPath}\n`);

  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  console.log(`  processing ${data.length} messages...\n`);

  const results = [];
  let onlineCount = 0;
  let rulesCount = 0;

  for (let i = 0; i < data.length; i++) {
    const { id, domain, received_at, message } = data[i];

    let parsed;
    if (mode === 'full') {
      // Try online first, fall back to rules
      parsed = await parseOnlineThenFallback(message, received_at, domain);
      // We can't easily tell which path succeeded without more instrumentation,
      // but the fallback is transparent — the output shape is identical either way
    } else {
      parsed = parseWithRules(message, received_at, domain);
      rulesCount++;
    }

    // Emit exactly the schema.json fields + id (matching sample_submission.json shape)
    results.push({
      id,
      customer: parsed.customer ?? null,
      items: parsed.items || [],
      due_date: parsed.due_date ?? null,
      amount: parsed.amount ?? null,
      references_prior_order: parsed.references_prior_order ?? false,
      confidence: parsed.confidence ?? 0.5,
      needs_clarification: parsed.needs_clarification ?? false,
    });

    // Progress indicator for large batches
    if ((i + 1) % 50 === 0 || i === data.length - 1) {
      process.stdout.write(`  [${i + 1}/${data.length}] processed\r`);
    }
  }

  writeFileSync(outputPath, JSON.stringify(results, null, 1));

  console.log(`\n  ✓ wrote ${results.length} predictions to ${outputPath}`);
  console.log(`  score with: python score.py --gold ${inputPath} --pred ${outputPath}\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
