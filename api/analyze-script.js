// api/analyze-script.js
// Vercel serverless function: receives a script payload from Zapier,
// analyzes it with Claude Opus 4.7, writes a structured analysis page
// to Notion, and posts a Discord notification.
//
// Env vars required:
//   ANTHROPIC_API_KEY   — existing, reused from title-picker
//   NOTION_TOKEN        — existing, reused from title-picker
//   DISCORD_WEBHOOK_URL — new, Betty's channel
//   SHARED_SECRET       — new, must match Zapier's x-auth-secret header
//
// POST body (JSON):
//   { script_title: string, page_url: string, page_content: string }

const ANALYSES_PARENT_PAGE_ID = '33ce33c3fbc080f2b0bbf976f2469387';
const MODEL = 'claude-opus-4-7';
const NOTION_VERSION = '2022-06-28';

// System prompt — adapted from the Script Analysis Hub Notion page.
// Orchestration steps (search Notion, create page, reply to user) are stripped
// because the Vercel function handles those. Claude's job here is pure analysis
// returned as structured JSON that this function converts into Notion blocks.
const SYSTEM_PROMPT = `You are a YouTube strategist for a specific channel, trained on its actual performance data. Do NOT apply generic YouTube advice. Every output must tie back to the patterns below, extracted from the channel's real top performers.

# Channel style (brand guardrails — never violate)
- Positive curiosity and intrigue, NOT negative clickbait
- Personal experiments and discoveries
- Authority-driven but approachable
- Titles provide context; thumbnails provide tension or curiosity

# Outperformer title structures (use these, priority order)
1. "I [did extreme thing]... [surprising outcome]" — Personal journey with twist. e.g. "I Quit Every Streaming Service… Here's What I Use Now." (2.2M), "I Tried Linux Fedora (And It's Amazing)" (620k)
2. "[Bold declarative statement]... [tension or qualifier]" — Confident take that invites disagreement. e.g. "OLED is Dead to Me." (485k), "The Frustrating Reality of USB-C" (998k)
3. "[X] Is [surprising verdict]" or "[X] but [unexpected twist]" — Reframe the expected. e.g. "Arch Linux but... Better?" (291k)
4. "The [superlative] [thing] [qualifier]" — Authority claim with specificity. e.g. "The Best Keyboard at Every Price" (898k)
5. "I [waited/spent/tested] [specific number] [thing]... [payoff]" — Stakes + discovery. e.g. "I've Waited 15 Years For This Laptop" (124k)

# Patterns to AVOID
- Vague setups with no payoff implied
- Question format with weak stakes
- Long titles with colons mid-sentence
- Negative words: mistake, worst, wrong, scam (unless framed as discovery)
- Generic round-ups without a specific angle

# Thumbnail formula (always)
- 2–3 words ONLY
- Must NOT repeat any word from the paired title
- Must add a different emotional layer (title factual → thumbnail emotional, and vice versa)
- Punctuation matters: period = confident, ellipsis = tension, exclamation = excitement

High-performing thumbnail word families:
- Transformation: "can't go back", "never going back", "unlocked", "life-changing", "i get it now", "finally"
- Positive verdict: "it's perfect", "perfect.", "worth it", "get this.", "it just works."
- Surprise/contrast: "insane.", "amazing.", "wow.", "incredible.", "so cool."
- Anti-hype curiosity: "why?", "overhyped?", "who is this for?"
- Stakes: "i won", "i said no.", "don't bother", "don't waste your money"

# Your task
Analyze the provided script and return a single JSON object matching the schema below. Do NOT rewrite or edit the script. Do NOT summarize its content. Observe and flag only.

# Output JSON schema (respond with ONLY this JSON, no prose before or after)
{
  "pre_review_summary": "2–3 sentences MAX. One biggest strength, one biggest risk. Readable in under 10 seconds.",
  "top_tier": [
    { "title": "string", "thumbnail": "2–3 words", "why": "Tie to a specific outperformer pattern" }
  ],
  "strong_tier": [
    { "title": "string", "thumbnail": "2–3 words" }
  ],
  "experimental_tier": [
    { "title": "string", "thumbnail": "2–3 words" }
  ],
  "hook_audit": {
    "pattern_interrupt": "Y/N + one specific reason",
    "viewer_promise": "string",
    "time_to_value": "string — lines or seconds before real content begins",
    "verdict": "Strong | Needs Work | Weak",
    "note": "one concrete note"
  },
  "flow_structure": {
    "sections": [ { "label": "string", "length_note": "string" } ],
    "momentum_flags": [ "string" ],
    "transition_quality": "string",
    "cta": "present and earned | absent | forced",
    "verdict": "Tight | Bloated | Uneven",
    "note": "one concrete note"
  },
  "emotional_arc": {
    "trajectory": "e.g. ↑↑↓↑↓↑",
    "flat_sections": [ { "section": "string", "issue": "string", "existing_hope_moment_to_expand": "string" } ],
    "verdict": "Good arc | Needs swings | Flat",
    "biggest_missing_swing": "string"
  },
  "top_scripts_benchmark": [
    { "pattern": "Host is a real character", "status": "Strong | Weak | Missing | N/A", "note": "one concrete note when flagged" },
    { "pattern": "Specific financial hook", "status": "...", "note": "..." },
    { "pattern": "Premise starts from audience's problem, not the product", "status": "...", "note": "..." },
    { "pattern": "Honest about costs, tradeoffs, failures", "status": "...", "note": "..." },
    { "pattern": "Self-aware conversational humor", "status": "...", "note": "..." },
    { "pattern": "Opinion is earned and stated directly", "status": "...", "note": "..." },
    { "pattern": "Real moments of discovery mid-video", "status": "...", "note": "..." },
    { "pattern": "Nerd depth with plain-language translation", "status": "...", "note": "..." },
    { "pattern": "Structural clarity — named sections or acts", "status": "...", "note": "..." },
    { "pattern": "Ends with something open — curiosity loop", "status": "...", "note": "..." }
  ],
  "jargon_audit": {
    "flags": [ { "term": "string", "status": "already explained | needs translation | safe without explanation", "note": "string" } ],
    "verdict": "Clean | Minor gaps | Needs attention"
  },
  "annotated_script": [
    {
      "section_text": "The section of the original script, verbatim. Do not edit.",
      "callouts": [
        { "emoji": "💬 | 🌊 | ⚡ | ✅ | ✂️", "note": "Direct, specific observation. No rewrites, no vague feedback." }
      ]
    }
  ],
  "summary": {
    "hook_verdict": "Strong | Needs Work | Weak",
    "hook_note": "one concrete note",
    "flow_verdict": "Tight | Bloated | Uneven",
    "flow_note": "one concrete note",
    "biggest_fix": "The single biggest fix to improve the script before filming"
  }
}

# Rules
- Generate 10–12 total title+thumbnail combos across the three tiers (2–3 top, 4–5 strong, 3–4 experimental)
- Do NOT insert a callout after every line in the annotated script — only where something meaningful needs to be said. One callout per passage; combine notes if multiple apply.
- Callout emoji key: 💬 = hook notes (first 30–60s only), 🌊 = flow/momentum/transitions, ⚡ = energy/pacing flag, ✅ = what's working + why, ✂️ = cut or compress candidate + why safe
- Direct and specific — no vague feedback like "this could be stronger"
- Respond with ONLY the JSON object. No markdown fences, no commentary.`;

module.exports = async (req, res) => {
  // ---- Request validation ----
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-auth-secret'];
  if (!authHeader || authHeader !== process.env.SHARED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { script_title, page_url, page_content } = body || {};

  if (!script_title || !page_url || !page_content) {
    return res.status(400).json({
      error: 'Missing required fields: script_title, page_url, page_content',
    });
  }

  // ---- Respond 202 immediately, keep handler alive for background work ----
  // res.json() sends the HTTP response over the wire immediately, so Zapier
  // sees 202 in <2s. We then await the analysis so Vercel doesn't freeze the
  // container before Notion + Discord calls finish. maxDuration below gives
  // us up to 300s for the full pipeline.
  res.status(202).json({ status: 'accepted', script_title });

  try {
    await processAnalysis({ script_title, page_url, page_content });
  } catch (err) {
    console.error('Background work failed:', err);
    try {
      await postDiscord({
        content: `❌ Script analysis failed for **${script_title}**\nError: ${err.message}\nSource: ${page_url}`,
      });
    } catch (discordErr) {
      console.error('Discord error notification also failed:', discordErr);
    }
  }
};

// ---- Core pipeline ----

async function processAnalysis({ script_title, page_url, page_content }) {
  console.log(`Starting analysis for: ${script_title}`);

  const analysis = await callAnthropic({ script_title, page_content });
  const analysisPageUrl = await createNotionAnalysisPage({
    script_title,
    source_url: page_url,
    analysis,
  });

  await postDiscord({
    content:
      `✅ Script analysis ready: **${script_title}**\n` +
      `📝 Analysis: ${analysisPageUrl}\n` +
      `📄 Original: ${page_url}`,
  });

  console.log(`Analysis complete: ${analysisPageUrl}`);
}

// ---- Anthropic call ----

async function callAnthropic({ script_title, page_content }) {
  const userMessage =
    `Script title: ${script_title}\n\n` +
    `Full script content (do NOT edit or summarize — analyze only):\n\n` +
    `---\n${page_content}\n---`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const text = (data.content || []).map((b) => b.text || '').join('').trim();

  // Strip code fences if Claude wrapped the JSON anyway
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Claude returned non-JSON output. First 500 chars: ${text.slice(0, 500)}`);
  }
}

// ---- Notion page creation ----

async function createNotionAnalysisPage({ script_title, source_url, analysis }) {
  const blocks = buildNotionBlocks({ source_url, analysis });

  // Notion API rejects requests with more than 100 children per call. If we
  // have more, we create the page with the first 100 then append in batches.
  const firstChunk = blocks.slice(0, 100);
  const remainingChunks = [];
  for (let i = 100; i < blocks.length; i += 100) {
    remainingChunks.push(blocks.slice(i, i + 100));
  }

  const createResp = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'notion-version': NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { page_id: ANALYSES_PARENT_PAGE_ID },
      properties: {
        title: {
          title: [{ type: 'text', text: { content: `${script_title} — Analysis` } }],
        },
      },
      children: firstChunk,
    }),
  });

  if (!createResp.ok) {
    const errText = await createResp.text();
    throw new Error(`Notion create page ${createResp.status}: ${errText}`);
  }

  const created = await createResp.json();
  const pageId = created.id;

  for (const chunk of remainingChunks) {
    const appendResp = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.NOTION_TOKEN}`,
          'notion-version': NOTION_VERSION,
        },
        body: JSON.stringify({ children: chunk }),
      }
    );

    if (!appendResp.ok) {
      const errText = await appendResp.text();
      throw new Error(`Notion append ${appendResp.status}: ${errText}`);
    }
  }

  return created.url;
}

// ---- Notion block construction ----

function buildNotionBlocks({ source_url, analysis }) {
  const blocks = [];

  // 1. Header: link to original script
  blocks.push(
    heading2('🔗 Original Script'),
    paragraph([linkText('Open original script page', source_url)]),
    divider()
  );

  // Pre-review summary (read first)
  blocks.push(
    heading2('⚡ Pre-Review Summary'),
    callout('📌', [richText(analysis.pre_review_summary || '')])
  );

  // Title + thumbnail tiers
  blocks.push(heading2('🎬 Title + Thumbnail Combos'));

  blocks.push(heading3('🥇 Top Tier'));
  for (const combo of analysis.top_tier || []) {
    blocks.push(
      bullet([
        bold(combo.title || ''),
        richText(` — thumbnail: `),
        italic(combo.thumbnail || ''),
      ])
    );
    if (combo.why) {
      blocks.push(bullet([richText(`Why: ${combo.why}`)], 'gray_background'));
    }
  }

  blocks.push(heading3('💪 Strong Tier'));
  for (const combo of analysis.strong_tier || []) {
    blocks.push(
      bullet([
        bold(combo.title || ''),
        richText(` — thumbnail: `),
        italic(combo.thumbnail || ''),
      ])
    );
  }

  blocks.push(heading3('🧪 Experimental Tier'));
  for (const combo of analysis.experimental_tier || []) {
    blocks.push(
      bullet([
        bold(combo.title || ''),
        richText(` — thumbnail: `),
        italic(combo.thumbnail || ''),
      ])
    );
  }

  blocks.push(divider());

  // 2. Emotional arc (before annotated script)
  const arc = analysis.emotional_arc || {};
  blocks.push(
    heading2('🌊 Emotional Arc'),
    paragraph([bold('Trajectory: '), richText(arc.trajectory || '—')]),
    paragraph([bold('Verdict: '), richText(arc.verdict || '—')])
  );
  if (arc.biggest_missing_swing) {
    blocks.push(
      paragraph([bold('Biggest missing swing: '), richText(arc.biggest_missing_swing)])
    );
  }
  for (const flag of arc.flat_sections || []) {
    blocks.push(
      callout('⚠️', [
        bold(`${flag.section}: `),
        richText(`${flag.issue} `),
        italic(`Hope to expand → ${flag.existing_hope_moment_to_expand || '—'}`),
      ])
    );
  }

  blocks.push(divider());

  // Secondary analysis blocks
  const hook = analysis.hook_audit || {};
  blocks.push(
    heading3('💬 Hook Audit (first 30–60s)'),
    bullet([bold('Pattern interrupt: '), richText(hook.pattern_interrupt || '—')]),
    bullet([bold('Viewer promise: '), richText(hook.viewer_promise || '—')]),
    bullet([bold('Time to value: '), richText(hook.time_to_value || '—')]),
    bullet([bold(`Verdict: ${hook.verdict || '—'} `), richText(hook.note || '')])
  );

  const flow = analysis.flow_structure || {};
  blocks.push(heading3('🌊 Flow & Structure'));
  for (const s of flow.sections || []) {
    blocks.push(bullet([bold(`${s.label}: `), richText(s.length_note || '')]));
  }
  for (const mf of flow.momentum_flags || []) {
    blocks.push(callout('⚡', [richText(mf)]));
  }
  if (flow.transition_quality) {
    blocks.push(paragraph([bold('Transitions: '), richText(flow.transition_quality)]));
  }
  blocks.push(
    paragraph([bold('CTA: '), richText(flow.cta || '—')]),
    paragraph([bold(`Verdict: ${flow.verdict || '—'} `), richText(flow.note || '')])
  );

  // Top scripts benchmark
  blocks.push(heading3('📊 Top Scripts Benchmark'));
  for (const row of analysis.top_scripts_benchmark || []) {
    if (!row.status || row.status === 'N/A') continue;
    blocks.push(
      bullet([
        bold(`${row.pattern}: `),
        richText(`${row.status}`),
        row.note ? richText(` — ${row.note}`) : richText(''),
      ])
    );
  }

  // Jargon audit
  const jargon = analysis.jargon_audit || {};
  blocks.push(
    heading3('🔤 Jargon & Technical Terms'),
    paragraph([bold(`Verdict: ${jargon.verdict || '—'}`)])
  );
  for (const flag of jargon.flags || []) {
    const statusIcon =
      flag.status === 'needs translation'
        ? '⚠️'
        : flag.status === 'already explained'
        ? '✅'
        : 'ℹ️';
    blocks.push(
      bullet([
        richText(`${statusIcon} `),
        bold(flag.term || ''),
        richText(` — ${flag.status || ''}. ${flag.note || ''}`),
      ])
    );
  }

  blocks.push(divider());

  // 3. Annotated script
  blocks.push(heading2('📄 Annotated Script'));
  for (const sec of analysis.annotated_script || []) {
    // Split section_text into paragraphs by blank line so long sections render readable
    const paragraphs = (sec.section_text || '').split(/\n\n+/).filter(Boolean);
    for (const p of paragraphs) {
      blocks.push(paragraph([richText(p)]));
    }
    for (const co of sec.callouts || []) {
      blocks.push(callout(co.emoji || '💬', [richText(co.note || '')]));
    }
  }

  blocks.push(divider());

  // 4. Summary block (bottom)
  const summary = analysis.summary || {};
  blocks.push(
    heading2('📋 Summary'),
    paragraph([
      bold(`Hook: ${summary.hook_verdict || '—'} `),
      richText(summary.hook_note || ''),
    ]),
    paragraph([
      bold(`Flow: ${summary.flow_verdict || '—'} `),
      richText(summary.flow_note || ''),
    ]),
    callout('🎯', [
      bold('Biggest fix before filming: '),
      richText(summary.biggest_fix || '—'),
    ])
  );

  return blocks;
}

// ---- Notion block helpers ----

function richText(content, annotations = {}) {
  // Notion rich_text items have a 2000-char limit per chunk. Split long strings.
  const chunks = [];
  const text = String(content || '');
  for (let i = 0; i < text.length; i += 1900) {
    chunks.push(text.slice(i, i + 1900));
  }
  if (chunks.length === 0) chunks.push('');
  return chunks.map((chunk) => ({
    type: 'text',
    text: { content: chunk },
    annotations: { bold: false, italic: false, code: false, color: 'default', ...annotations },
  }));
}

function bold(content) {
  return richText(content, { bold: true });
}

function italic(content) {
  return richText(content, { italic: true });
}

function linkText(content, url) {
  return [{
    type: 'text',
    text: { content, link: { url } },
    annotations: { bold: false, italic: false, code: false, color: 'default' },
  }];
}

function flatten(arr) {
  return arr.reduce((acc, v) => acc.concat(Array.isArray(v) ? v : [v]), []);
}

function paragraph(richTextArrays) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: flatten(richTextArrays) },
  };
}

function heading2(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: richText(text) },
  };
}

function heading3(text) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: { rich_text: richText(text) },
  };
}

function bullet(richTextArrays, color) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: flatten(richTextArrays),
      ...(color ? { color } : {}),
    },
  };
}

function callout(emoji, richTextArrays) {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji },
      rich_text: flatten(richTextArrays),
    },
  };
}

function divider() {
  return { object: 'block', type: 'divider', divider: {} };
}

// ---- Discord ----

async function postDiscord({ content }) {
  if (!process.env.DISCORD_WEBHOOK_URL) {
    console.warn('DISCORD_WEBHOOK_URL not set; skipping notification');
    return;
  }
  const resp = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`Discord webhook ${resp.status}: ${errText}`);
  }
}

module.exports.config = {
  maxDuration: 300,
};
