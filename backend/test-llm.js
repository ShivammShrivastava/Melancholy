/**
 * test-llm.js — Smoke test for the LLM parsing via local Ollama.
 * Sends one Hinglish message to Qwen2.5-3B-Instruct running locally,
 * prints the raw response, and tries to parse the JSON output.
 *
 * Prerequisites: `ollama serve` running, `ollama pull qwen2.5:3b` done.
 * Usage: node test-llm.js
 */
const ENDPOINT = process.env.LLM_ENDPOINT_URL
  || 'http://localhost:11434/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || 'qwen2.5:3b';

async function main() {
  console.log('Testing local Ollama LLM...');
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Model: ${MODEL}\n`);

  const messages = [
    {
      role: 'system',
      content: `You are a structured data extraction system for Indian small businesses.
Parse Hinglish (Hindi-English mixed) customer messages into JSON order records.
Output ONLY valid JSON with these exact fields:
- customer (string|null): customer name if stated, else null
- items (array of {description: string, quantity: integer, attributes: object})
- due_date (YYYY-MM-DD|null): resolve relative dates against received_at. kal=+1 day, parso=+2 days, aaj=today
- amount (number|null): INR amount if stated, else null
- references_prior_order (boolean): true if "last time jaisa", "pichli baar wala" etc.
- confidence (0-1): your confidence score
- needs_clarification (boolean): true if no item identified, ambiguous quantity, vague deadline, or blocking attribute missing

Attribute keys per domain:
- tailor: color, fabric, chest, waist, length, sleeve, size, fit
- tiffin: portion, spice_level, meal, roti_count, jain, days
- electrician: appliance, issue, room, brand, wattage
- baker: flavour, weight_kg, egg_free, tier, message_on_cake, shape

Output ONLY the JSON object. No explanation, no markdown.`,
    },
    {
      role: 'user',
      content: `Domain: tailor
Received at: 2026-08-29T10:00:00+05:30
Message: "bhaiya 2 kurta chahiye navy blue, chest 40, parso tak ho jayega kya? last time jaisa hi"

Parse this into JSON.`,
    },
  ];

  const startTime = Date.now();

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 512,
      temperature: 0.1,
    }),
  });

  const elapsed = Date.now() - startTime;
  console.log(`Response status: ${response.status} (${elapsed}ms)`);

  if (!response.ok) {
    const errText = await response.text();
    console.error('Error:', errText);
    return;
  }

  const data = await response.json();

  let text;
  if (data.choices && data.choices[0]?.message?.content) {
    text = data.choices[0].message.content;
  } else {
    console.log('Raw response:', JSON.stringify(data, null, 2));
    console.error('Could not find generated text in response');
    return;
  }

  console.log('\n--- LLM Output ---');
  console.log(text);
  console.log('--- End ---\n');

  // Try to parse JSON
  try {
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = codeBlock ? codeBlock[1].trim() : text.match(/\{[\s\S]*\}/)?.[0];
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      console.log('Parsed result:');
      console.log(JSON.stringify(parsed, null, 2));

      // Validate fields
      const required = ['customer', 'items', 'due_date', 'amount',
        'references_prior_order', 'confidence', 'needs_clarification'];
      const missing = required.filter((f) => !(f in parsed));
      if (missing.length === 0) {
        console.log('\n✅ LLM is working! All schema fields present. Online parsing is ready.');
      } else {
        console.log(`\n⚠️  Missing fields: ${missing.join(', ')}`);
      }
    } else {
      console.log('⚠️  Could not extract JSON from output');
    }
  } catch (e) {
    console.log('⚠️  JSON parse error:', e.message);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
