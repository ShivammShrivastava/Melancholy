/**
 * api/parse-message.js
 * --------------------
 * Vercel Serverless Function — the online parsing path. Calls
 * Qwen2.5-3B-Instruct via a LOCAL Ollama instance (default) or a remote
 * HuggingFace Inference Endpoint (configurable override).
 *
 * LOCAL MODE (default for dev/judging):
 *   Ollama runs on localhost:11434, serving Qwen2.5-3B-Instruct-GGUF.
 *   No API token needed — Ollama's local API is unauthenticated.
 *   Start with: `ollama serve` then `ollama pull qwen2.5:3b`
 *
 * REMOTE MODE (for Vercel deployment):
 *   Set LLM_ENDPOINT_URL and optionally HF_API_TOKEN in Vercel env vars
 *   to point at a remote HF Inference Endpoint or any OpenAI-compatible API.
 *
 * On any failure (bad response, schema validation, timeout), returns a
 * fallback-shaped response with `_parse_error` so the client-side routing
 * in parse-message.js knows to fall back to rules-parser.js.
 *
 * Environment variables:
 *   LLM_ENDPOINT_URL — override the LLM API URL (default: local Ollama)
 *   HF_API_TOKEN     — auth token for remote endpoints (not needed for local Ollama)
 *   LLM_MODEL        — model name (default: qwen2.5:3b for Ollama)
 */

const SCHEMA_FIELDS = [
  'customer', 'items', 'due_date', 'amount',
  'references_prior_order', 'confidence', 'needs_clarification',
];

/**
 * Build the structured extraction prompt. Encodes the key rules from
 * DATASET_CARD.md directly so the model doesn't need fine-tuning — every
 * constraint is in the system prompt.
 */
function buildPrompt(message, receivedAt, domain) {
  // Domain-specific attribute vocabulary (from schema.json x-devcraft-vocabulary)
  const vocabMap = {
    tailor: 'color, fabric, chest, waist, length, sleeve, size, fit',
    tiffin: 'portion, spice_level, meal, roti_count, jain, days',
    electrician: 'appliance, issue, room, brand, wattage',
    baker: 'flavour, weight_kg, egg_free, tier, message_on_cake, shape',
  };

  const blockingMap = {
    baker: 'flavour (if missing from ALL items → needs_clarification: true)',
    electrician: 'issue (if missing from ALL items → needs_clarification: true)',
  };

  const vocab = vocabMap[domain] || '';
  const blocking = blockingMap[domain] || 'none';

  return [
    {
      role: 'system',
      content: `You are a structured data extraction system for Indian small businesses.
You parse Hinglish (Hindi-English mixed) customer messages into JSON order records.

RULES — follow these EXACTLY:
1. Output ONLY valid JSON matching this schema: { customer, items, due_date, amount, references_prior_order, confidence, needs_clarification }
2. "customer" = customer name if stated (e.g. "X ke liye", "X ka order"), else null
3. "items" = array of { description, quantity, attributes }
   - description: lowercase singular item name
   - quantity: integer, default 1 if unstated. "do ya teen" = ambiguous, record FIRST value (2), set needs_clarification true
   - attributes: keys MUST be from this domain's vocabulary: [${vocab}]. No other keys.
4. "due_date" = YYYY-MM-DD resolved against received_at (${receivedAt}) in Asia/Kolkata
   - aaj=+0, kal=+1 (always tomorrow in this dataset), parso=+2, tarso/narsu=+3
   - "agle <weekday>" = strictly next occurrence, never today
   - "<N> tarikh/tareekh" = Nth of current month if N>=today, else next month
   - "<N> din me" = +N days
   - "is weekend" = upcoming Saturday
   - "agle hafte/next week" = +7 days (but "next week kabhi bhi" is vague → null + needs_clarification)
   - Vague deadlines (jaldi, asap, urgent, jab ho jaye, etc.) → null + needs_clarification: true
   - No deadline mentioned at all → null, needs_clarification stays false for this reason
5. "amount" = INR number if stated, else null. "dedh hazaar"=1500, "do hazaar"=2000
6. "references_prior_order" = true if "last time jaisa", "pichli baar wala", etc. BUT "pichli baar jaisa nahi" = false
7. "needs_clarification" = true iff: (a) no identifiable item, (b) ambiguous quantity, (c) vague unresolvable deadline, (d) blocking attribute missing from ALL items. Blocking: ${blocking}
8. "confidence" = 0.0-1.0, your self-assessed confidence

NEGATION HANDLING:
- "X nahi, Y" means Y replaces X. Drop X entirely.
- "somvar ko nahi, mangalvar ko" → Tuesday, not Monday
- "Ramesh ke liye nahi, Sunita ke liye" → customer is Sunita
- "pant nahi, sirf shirt" → only shirt is ordered
- BUT "jain nahi" = jain:false, "ande nahi" = egg_free:true (attribute negation, not item replacement)

IMPORTANT: A field that is absent and never referenced is null, NOT a clarification.
"kurta chahiye" → due_date:null, needs_clarification:false (no deadline mentioned)
"kurta chahiye jaldi" → due_date:null, needs_clarification:true (deadline referenced but unresolvable)`,
    },
    {
      role: 'user',
      content: `Domain: ${domain}
Received at: ${receivedAt}
Message: "${message}"

Parse this into the JSON schema. Output ONLY the JSON object, no explanation.`,
    },
  ];
}

/**
 * Validate that a parsed result has all required schema fields and correct types.
 */
function validateOutput(parsed) {
  for (const field of SCHEMA_FIELDS) {
    if (!(field in parsed)) return false;
  }
  if (!Array.isArray(parsed.items)) return false;
  if (typeof parsed.references_prior_order !== 'boolean') return false;
  if (typeof parsed.needs_clarification !== 'boolean') return false;
  if (typeof parsed.confidence !== 'number') return false;
  return true;
}

/**
 * Extract JSON from LLM response text, handling markdown code blocks and
 * other wrapping the model might add.
 */
function extractJSON(text) {
  // Try to find a JSON object in the text
  // First try: look for ```json ... ``` blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1].trim());
  }
  // Second try: find the first { ... } block
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error('No JSON found in LLM response');
}

/**
 * Vercel serverless function handler.
 * POST /api/parse-message
 * Body: { message: string, received_at: string, domain: string }
 */
export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, received_at, domain } = req.body || {};

  if (!message || !received_at || !domain) {
    return res.status(400).json({
      error: 'Missing required fields: message, received_at, domain',
    });
  }

  // Default to local Ollama; override with LLM_ENDPOINT_URL for remote/Vercel
  const endpoint = process.env.LLM_ENDPOINT_URL
    || process.env.HF_ENDPOINT_URL
    || 'http://localhost:11434/v1/chat/completions';
  const token = process.env.HF_API_TOKEN || null;
  const modelName = process.env.LLM_MODEL || 'qwen2.5:3b';

  const messages = buildPrompt(message, received_at, domain);

  // Retry loop: try up to 2 times (initial + 1 retry)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000); // 15s server-side timeout

      // Build headers — only add Authorization if a token is configured
      // (Ollama's local API doesn't need auth)
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelName,
          messages,
          max_tokens: 1024,
          temperature: 0.1,    // low temperature for deterministic extraction
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`HF API returned ${response.status}: ${errText}`);
      }

      const data = await response.json();

      // Chat completions format: { choices: [{ message: { content: "..." } }] }
      // Also handle legacy HF format: [{ generated_text: "..." }]
      let generatedText;
      if (data.choices && data.choices[0]?.message?.content) {
        generatedText = data.choices[0].message.content;
      } else if (Array.isArray(data) && data[0]?.generated_text) {
        generatedText = data[0].generated_text;
      } else if (data.generated_text) {
        generatedText = data.generated_text;
      }

      if (!generatedText) {
        throw new Error('No generated text in HF response');
      }

      const parsed = extractJSON(generatedText);

      if (!validateOutput(parsed)) {
        throw new Error('LLM output failed schema validation');
      }

      // Success — return the parsed result
      return res.status(200).json(parsed);

    } catch (err) {
      // On last attempt, signal the client to fall back to rules
      if (attempt === 1) {
        console.error(`parse-message API error (attempt ${attempt + 1}):`, err.message);
        return res.status(200).json({
          _parse_error: `LLM extraction failed after 2 attempts: ${err.message}`,
        });
      }
      // Otherwise retry
      console.warn(`parse-message API attempt ${attempt + 1} failed:`, err.message);
    }
  }
}

