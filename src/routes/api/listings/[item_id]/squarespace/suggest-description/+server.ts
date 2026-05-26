import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { getDB } from '$lib/server/db';

/**
 * POST /api/listings/<item_id>/squarespace/suggest-description
 *
 * Generates a Squarespace-ready HTML product description for one item
 * using Claude Haiku 4.5 (cheap + fast — descriptions are short, no
 * need for the Opus tier).
 *
 * Returns `{ html: string }` — pure HTML, no markdown, no code fences,
 * no document-wrapping elements. The client pastes the result into the
 * rich text editor or appends it to whatever's already there.
 *
 * The system prompt is marked `cache_control: ephemeral` so when it
 * grows past the ~2K-token cache minimum we'll start getting cache
 * hits on subsequent requests for free. Today it's short enough that
 * caching is a no-op, but the marker is correct future-proofing.
 */

const SYSTEM_PROMPT = `You are writing customer-facing product descriptions for Southwest Acoustics, a small guitar parts and custom builds shop. The descriptions appear on the shop's Squarespace storefront.

Voice and tone:
- Friendly, expert, plainspoken — like a knowledgeable luthier talking to a customer at the bench
- Focus on what the part does, what guitars it fits, what kind of player or build it suits, and why a buyer should care
- Be specific and concrete about the attributes you're given. Don't invent specs.
- Avoid hype, marketing fluff, exclamation points, or AI-sounding phrases like "Elevate your sound", "Take your tone to the next level", "Unleash", "Whether you're..."
- Don't restate the title verbatim in the first sentence

Output format:
- Return PURE HTML only — no markdown, no code fences (no \`\`\`), no preamble, no closing remarks, no explanations
- Use <p> for paragraphs, <ul><li> for spec lists, <strong> only sparingly for genuinely key terms
- Aim for 100-200 words total
- Suggested structure: one hook paragraph (what it is and why it matters), one spec block (the attributes), optional brief use-case paragraph
- Never include <html>, <head>, <body>, <!DOCTYPE>, or any document-wrapping elements — output only inner body HTML
- Never wrap the HTML in any kind of quote or backtick — emit the raw markup`;

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

	// Build the per-attribute lines for the user prompt. Skip empty (XXX)
	// and any unlabeled slots (e.g. MS items with no per-category schema).
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
			const friendly = contextKey
				? valueLabel.get(`${contextKey}::${code}`)
				: null;
			attrLines.push(friendly ? `- ${label}: ${friendly} (${code})` : `- ${label}: ${code}`);
		}
	}

	const priceLine =
		item.price_cents != null
			? `$${(item.price_cents / 100).toFixed(2)}`
			: '(no price set)';

	const userPrompt =
		`Generate a Squarespace product description for this item.\n\n` +
		`Title: ${item.title}\n` +
		`Category: ${item.cat_name}\n` +
		(item.brand_name ? `Brand: ${item.brand_name}\n` : '') +
		(item.model ? `Model code: ${item.model}\n` : '') +
		`Condition: ${CONDITION_LABEL[item.condition] ?? item.condition}\n` +
		`Year received: ${item.year_received}\n` +
		`Price: ${priceLine}\n` +
		`Photos available: ${photoCount}\n` +
		(attrLines.length > 0
			? `\nAttributes:\n${attrLines.join('\n')}\n`
			: '\n(No structured attributes set on this item yet.)\n') +
		`\nWrite the description now. Return only HTML — no other text.`;

	const anthropic = new Anthropic({ apiKey });

	try {
		const message = await anthropic.messages.create({
			model: 'claude-haiku-4-5',
			max_tokens: 1024,
			// Auto-cache the last cacheable block — system prompt today,
			// will be more impactful once it grows past 2K tokens.
			cache_control: { type: 'ephemeral' },
			system: SYSTEM_PROMPT,
			messages: [{ role: 'user', content: userPrompt }]
		});

		// Pull the first text block. Other block types shouldn't appear
		// since we didn't ask for tool use or thinking, but be defensive.
		const html = message.content
			.filter((b): b is Anthropic.TextBlock => b.type === 'text')
			.map((b) => b.text)
			.join('')
			.trim();

		if (!html) {
			throw error(502, 'Claude returned an empty response.');
		}

		return json({
			html,
			usage: {
				input_tokens: message.usage.input_tokens,
				output_tokens: message.usage.output_tokens,
				cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
				cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0
			}
		});
	} catch (err) {
		// SvelteKit redirects/throws bubble up.
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) throw err;

		// Anthropic typed errors — map to useful HTTP statuses.
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
