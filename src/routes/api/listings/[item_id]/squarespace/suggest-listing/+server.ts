import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { getDB } from '$lib/server/db';
import { buildStyleHint, VOICE_RULES } from '$lib/squarespace_style_guide';

/**
 * POST /api/listings/<item_id>/squarespace/suggest-listing
 *
 * Generates a Squarespace listing — title AND description in one call.
 * Replaces the older suggest-description endpoint. Driven by the modal
 * on the listing edit page, which can also send refinement instructions
 * to iterate on a draft.
 *
 * Body (optional, JSON):
 *   {
 *     instructions?:           string,  // freeform "make these changes"
 *     currentTitle?:           string,  // the title we're refining
 *     currentDescriptionHtml?: string,  // the description we're refining
 *   }
 *
 * Returns:
 *   { title: string, descriptionHtml: string, usage: {...} }
 *
 * Model: Claude Haiku 4.5 — cheap, fast, and plenty smart for product
 * copy at this scale.
 *
 * Output discipline: we ask the model to return JSON. We don't use the
 * formal output_format constraint because Haiku 4.5 hits the JSON shape
 * reliably from prompting alone, and JSON-mode would force every error
 * mode through schema-validation rather than letting us emit a useful
 * 502. We do defensive stripping of code fences / preamble before
 * parsing so the common "Here is the listing: ```json…" failure mode
 * still works.
 */

const SYSTEM_PROMPT = `You are writing customer-facing listings for Southwest Acoustics — a small guitar parts and custom builds shop that sells on its Squarespace storefront at southwestacousticproducts.com. Generate BOTH a title and a customer-facing HTML description that match the conventions on that live site exactly.

# Voice rules

${VOICE_RULES.map((r) => `- ${r}`).join('\n')}

# Title rules

- Match the per-collection title pattern shown in the user prompt. The pattern is a shape, not a fill-in-the-blank — use it as guidance for separators, ordering, and what to include.
- Use slashes (/) and em-dashes (–) as separators where the example titles use them.
- Include "Free Shipping" or similar in the title only where the live site does for that collection (almost always for parts, often for Leo Jaymz, sometimes for builds).
- Use Title Case (each significant word capitalized).
- House builds get the "Southwest Acoustics™" trademark suffix per the existing site.
- Keep under 120 characters where possible.

# Description rules

- Pure inner-body HTML only — no <html>, <head>, <body>, <!DOCTYPE>, no markdown, no code fences.
- Allowed tags: <p>, <strong>, <em>, <ul>, <li>, <br>. Nothing else.
- STRUCTURED shape (Leo Jaymz collection — see the style hint):
    <p>opening hook paragraph</p>
    <p><strong>Sound That Speaks Up</strong></p>
    <p>tone / pickups / playability paragraph</p>
    <p><strong>Designed to Play — and Be Seen</strong></p>
    <p>looks / finish / hardware paragraph</p>
    <p><strong>Built to Go the Distance</strong></p>
    <p>build quality / materials / setup work paragraph</p>
    <p><strong>Tech Specs</strong></p>
    <ul>
      <li><strong>Body & Neck:</strong> ...</li>
      <li><strong>Fretboard:</strong> ...</li>
      <li><strong>Pickups:</strong> ...</li>
      <li><strong>Controls:</strong> ...</li>
      <li><strong>Finish:</strong> ...</li>
    </ul>
    <p>closing one-liner that names the product in <strong>bold</strong></p>
- NARRATIVE shape (everything else): 2-4 flowing <p> paragraphs with <strong> only on a few key specs.
- Word count: 100-200 for parts/strings/accessories; 150-300 for bodies/necks; 200-400 for full guitars.

# Output format

Return a single JSON object with EXACTLY this shape and nothing else:

{
  "title": "the listing title as a plain string",
  "descriptionHtml": "<p>the inner-body HTML</p>"
}

- No surrounding text. No code fences. No preamble like "Here is the listing".
- The descriptionHtml value is a JSON string — escape any internal double-quotes per JSON rules.
- The JSON must parse cleanly. If you can't comply, emit minimal valid JSON with what you have rather than commentary.`;

interface ReqBody {
	instructions?: string;
	currentTitle?: string;
	currentDescriptionHtml?: string;
}

interface ItemRow {
	id: number;
	sku: string;
	title: string;
	condition: string;
	price_cents: number | null;
	year_received: number;
	attr_1: string;
	attr_2: string;
	attr_3: string;
	attr_4: string;
	attr_5: string;
	attr_1_unique_desc: string | null;
	attr_2_unique_desc: string | null;
	attr_3_unique_desc: string | null;
	attr_4_unique_desc: string | null;
	attr_5_unique_desc: string | null;
	cat_name: string;
	cat_code: string;
	cat_attr_1_label: string | null;
	cat_attr_2_label: string | null;
	cat_attr_3_label: string | null;
	cat_attr_4_label: string | null;
	cat_attr_5_label: string | null;
	cat_attr_1_context_key: string | null;
	cat_attr_2_context_key: string | null;
	cat_attr_3_context_key: string | null;
	cat_attr_4_context_key: string | null;
	cat_attr_5_context_key: string | null;
	brand_name: string | null;
	brand_code: string | null;
	model: string | null;
}

const CONDITION_LABEL: Record<string, string> = {
	N: 'New',
	U: 'Used',
	R: 'Refurbished',
	B: 'For parts / broken'
};

export const POST: RequestHandler = async (event) => {
	const apiKey = event.platform?.env?.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw error(
			400,
			'ANTHROPIC_API_KEY is not configured. Run `wrangler pages secret put ANTHROPIC_API_KEY` and add it to .dev.vars for local development.'
		);
	}

	const itemId = parseInt(event.params.item_id, 10);
	if (!Number.isInteger(itemId)) throw error(400, 'Bad item id');

	// Body is optional — empty POST = initial generation.
	let body: ReqBody = {};
	try {
		const ct = event.request.headers.get('content-type') ?? '';
		if (ct.includes('application/json')) {
			body = (await event.request.json()) as ReqBody;
		}
	} catch {
		// Bad/empty JSON — treat as initial generation.
		body = {};
	}

	const db = getDB(event);

	const item = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.condition, i.price_cents, i.year_received,
			        i.attr_1, i.attr_2, i.attr_3, i.attr_4, i.attr_5,
			        i.attr_1_unique_desc, i.attr_2_unique_desc, i.attr_3_unique_desc,
			        i.attr_4_unique_desc, i.attr_5_unique_desc,
			        i.model,
			        c.name AS cat_name, c.code AS cat_code,
			        c.attr_1_label AS cat_attr_1_label, c.attr_2_label AS cat_attr_2_label,
			        c.attr_3_label AS cat_attr_3_label, c.attr_4_label AS cat_attr_4_label,
			        c.attr_5_label AS cat_attr_5_label,
			        c.attr_1_context_key AS cat_attr_1_context_key,
			        c.attr_2_context_key AS cat_attr_2_context_key,
			        c.attr_3_context_key AS cat_attr_3_context_key,
			        c.attr_4_context_key AS cat_attr_4_context_key,
			        c.attr_5_context_key AS cat_attr_5_context_key,
			        br.name AS brand_name, br.code AS brand_code
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 LEFT JOIN brand br ON br.id = i.brand_id
			 WHERE i.id = ? AND i.deleted_at IS NULL`
		)
		.bind(itemId)
		.first<ItemRow>();
	if (!item) throw error(404, `Item ${itemId} not found`);

	// Resolve attribute codes → friendly labels via attribute_value lookup.
	const { results: attrValues } = await db
		.prepare(`SELECT context_key, code, label FROM attribute_value WHERE is_active = 1`)
		.all<{ context_key: string; code: string; label: string }>();
	const valueLabel = new Map<string, string>();
	for (const v of attrValues) {
		valueLabel.set(`${v.context_key}::${v.code}`, v.label);
	}

	const photoRow = await db
		.prepare(`SELECT COUNT(*) AS n FROM item_photo WHERE item_id = ? AND deleted_at IS NULL`)
		.bind(itemId)
		.first<{ n: number }>();
	const photoCount = photoRow?.n ?? 0;

	const attrLines: string[] = [];
	for (let i = 1; i <= 5; i++) {
		const label = item[`cat_attr_${i}_label` as keyof ItemRow] as string | null;
		const code = item[`attr_${i}` as keyof ItemRow] as string;
		const uniqueDesc = item[`attr_${i}_unique_desc` as keyof ItemRow] as string | null;
		const contextKey = item[`cat_attr_${i}_context_key` as keyof ItemRow] as string | null;
		if (!label || code === 'XXX') continue;

		if (code === 'UNQ' && uniqueDesc) {
			attrLines.push(`- ${label}: ${uniqueDesc} (one-of-a-kind)`);
		} else {
			const friendly = contextKey ? valueLabel.get(`${contextKey}::${code}`) : null;
			attrLines.push(friendly ? `- ${label}: ${friendly} (${code})` : `- ${label}: ${code}`);
		}
	}

	const priceLine =
		item.price_cents != null ? `$${(item.price_cents / 100).toFixed(2)}` : '(no price set)';

	const styleHint = buildStyleHint(item.cat_code);

	// Optional refinement block — appended only when the user has hit
	// "Regenerate with these changes" on an existing draft.
	let refinementBlock = '';
	const hasInstructions = (body.instructions ?? '').trim().length > 0;
	const hasPrev = (body.currentTitle || body.currentDescriptionHtml) && hasInstructions;
	if (hasPrev) {
		refinementBlock = '\n\n# Previous draft (to refine)\n\n';
		if (body.currentTitle) {
			refinementBlock += `Title: ${body.currentTitle}\n\n`;
		}
		if (body.currentDescriptionHtml) {
			refinementBlock += `Description HTML:\n${body.currentDescriptionHtml}\n\n`;
		}
		refinementBlock +=
			'# Changes the user wants\n\n' +
			body.instructions!.trim() +
			'\n\nProduce a refined draft that incorporates these changes. Keep what works in the previous draft; rework only what the user asked about.';
	} else if (hasInstructions) {
		// User typed instructions but there's no prior draft to lean on —
		// treat the instructions as steering for a fresh generation.
		refinementBlock =
			'\n\n# Extra steering from the user\n\n' +
			body.instructions!.trim();
	}

	const userPrompt =
		`Generate a Squarespace listing (title + HTML description) for this item.\n\n` +
		`# Item\n\n` +
		`Internal title: ${item.title}\n` +
		`Category: ${item.cat_name} (${item.cat_code})\n` +
		(item.brand_name ? `Brand: ${item.brand_name}\n` : '') +
		(item.model ? `Model code: ${item.model}\n` : '') +
		`Condition: ${CONDITION_LABEL[item.condition] ?? item.condition}\n` +
		`Year received: ${item.year_received}\n` +
		`Price: ${priceLine}\n` +
		`Photos available: ${photoCount}\n` +
		(attrLines.length > 0
			? `\nAttributes:\n${attrLines.join('\n')}\n`
			: '\n(No structured attributes set on this item yet.)\n') +
		`\n# Style for this listing\n\n` +
		styleHint +
		refinementBlock +
		`\n\nReturn the JSON object now with "title" and "descriptionHtml" keys. No code fences, no preamble.`;

	const anthropic = new Anthropic({ apiKey });

	try {
		const message = await anthropic.messages.create({
			model: 'claude-haiku-4-5',
			max_tokens: 2048,
			// Auto-cache the system prompt — same prompt every call once
			// the module loads, so subsequent calls land cache hits.
			cache_control: { type: 'ephemeral' },
			system: SYSTEM_PROMPT,
			messages: [{ role: 'user', content: userPrompt }]
		});

		const raw = message.content
			.filter((b): b is Anthropic.TextBlock => b.type === 'text')
			.map((b) => b.text)
			.join('')
			.trim();

		if (!raw) {
			throw error(502, 'Claude returned an empty response.');
		}

		// Strip code-fence and preamble noise the model occasionally
		// emits despite the system prompt. Order matters — strip the
		// fence wrapper first, then any "Here is…" preamble before {.
		const cleaned = raw
			.replace(/^```(?:json|JSON)?\s*\n?/m, '')
			.replace(/\n?```\s*$/m, '')
			.trim();
		const firstBrace = cleaned.indexOf('{');
		const lastBrace = cleaned.lastIndexOf('}');
		const jsonSlice =
			firstBrace >= 0 && lastBrace > firstBrace
				? cleaned.slice(firstBrace, lastBrace + 1)
				: cleaned;

		let parsed: { title?: string; descriptionHtml?: string };
		try {
			parsed = JSON.parse(jsonSlice) as { title?: string; descriptionHtml?: string };
		} catch (e) {
			console.error('suggest-listing: model returned unparseable JSON', { raw, jsonSlice, e });
			throw error(502, 'AI returned an unreadable response. Try again — usually a one-off.');
		}

		const title = (parsed.title ?? '').trim();
		const descriptionHtml = (parsed.descriptionHtml ?? '').trim();
		if (!title || !descriptionHtml) {
			throw error(502, 'AI response was missing title or descriptionHtml. Try again.');
		}

		return json({
			title,
			descriptionHtml,
			usage: {
				input_tokens: message.usage.input_tokens,
				output_tokens: message.usage.output_tokens,
				cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
				cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0
			}
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) throw err;

		if (err instanceof Anthropic.RateLimitError) {
			throw error(429, 'Anthropic rate-limited the request. Try again in a minute.');
		}
		if (err instanceof Anthropic.AuthenticationError) {
			throw error(401, 'ANTHROPIC_API_KEY rejected by Anthropic.');
		}
		if (err instanceof Anthropic.APIError) {
			throw error(err.status ?? 500, `Anthropic API error: ${err.message}`);
		}
		throw error(500, err instanceof Error ? err.message : String(err));
	}
};
