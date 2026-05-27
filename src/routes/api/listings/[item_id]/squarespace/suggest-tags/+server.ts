import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { getDB } from '$lib/server/db';

/**
 * POST /api/listings/<item_id>/squarespace/suggest-tags
 *
 * Reads the listing's current title + description + a few item
 * specifics, asks Claude Haiku to suggest 5–10 Squarespace tags. Tags
 * are returned ranked, lowercased, hyphenated — matching the
 * conventions on Dad's live storefront (brand-name, color-finish,
 * product-type, condition, free-shipping, etc.).
 *
 * Body (JSON, optional):
 *   {
 *     title?: string,                // override the saved title
 *     descriptionHtml?: string,      // override the saved description
 *     existingTags?: string[]        // exclude from suggestions
 *   }
 *
 * Returns:
 *   { tags: string[], usage: {...} }
 *
 * Same Claude Haiku 4.5 backend as the description suggester. Tag
 * lists are small so max_tokens stays low.
 */

const SYSTEM_PROMPT = `You suggest Squarespace product tags for Southwest Acoustics, a small guitar parts and custom builds shop selling at southwestacousticproducts.com.

Tag rules:
- Lowercase, hyphenated (e.g. "leo-jaymz", "gloss-black", "free-shipping").
- 1–3 words per tag.
- Concrete and searchable — what a customer would type when looking.
- Cover: brand (when known), product type, color/finish, key spec (gauge / pickups / wood), condition tags ONLY when meaningful (used, blemished, refurbished), and "free-shipping" when applicable.
- Do NOT include the SKU, the year, or the full title in a tag.
- Avoid generic filler like "guitar", "music", "instrument" — too broad to help search.

Return a JSON object with EXACTLY this shape and nothing else:

{
  "tags": ["tag-1", "tag-2", "tag-3", ...]
}

- 5 to 10 tags ordered most-relevant first.
- No surrounding text, no code fences, no preamble.
- The JSON must parse cleanly.`;

interface ReqBody {
	title?: string;
	descriptionHtml?: string;
	existingTags?: string[];
}

interface ItemRow {
	id: number;
	sku: string;
	title: string;
	description: string | null;
	description_html: string | null;
	condition: string;
	year_received: number;
	price_cents: number | null;
	cat_name: string;
	cat_code: string;
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

/** Strip HTML, collapse whitespace, cap length — keeps the prompt
 *  cheap when the description is huge (Squarespace imports can be). */
function stripHtml(html: string, maxLen = 1500): string {
	const stripped = html
		.replace(/<\s*br\s*\/?\s*>/gi, '\n')
		.replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return stripped.length > maxLen ? stripped.slice(0, maxLen) + '…' : stripped;
}

export const POST: RequestHandler = async (event) => {
	const apiKey = event.platform?.env?.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw error(400, 'ANTHROPIC_API_KEY is not configured.');
	}

	const itemId = parseInt(event.params.item_id, 10);
	if (!Number.isInteger(itemId)) throw error(400, 'Bad item id');

	let body: ReqBody = {};
	try {
		const ct = event.request.headers.get('content-type') ?? '';
		if (ct.includes('application/json')) {
			body = (await event.request.json()) as ReqBody;
		}
	} catch {
		body = {};
	}

	const db = getDB(event);

	const item = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.description, i.description_html,
			        i.condition, i.year_received, i.price_cents, i.model,
			        c.name AS cat_name, c.code AS cat_code,
			        b.name AS brand_name, b.code AS brand_code
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 LEFT JOIN brand b ON b.id = i.brand_id
			 WHERE i.id = ? AND i.deleted_at IS NULL`
		)
		.bind(itemId)
		.first<ItemRow>();
	if (!item) throw error(404, `Item ${itemId} not found`);

	const effectiveTitle = (body.title ?? item.title).trim();
	const rawDescription = body.descriptionHtml ?? item.description_html ?? item.description ?? '';
	const effectiveDescription = stripHtml(rawDescription);
	const existing = (body.existingTags ?? [])
		.map((t) => t.toLowerCase().trim())
		.filter((t) => t.length > 0);

	const userPrompt =
		`Generate Squarespace tags for this listing.\n\n` +
		`# Listing\n\n` +
		`Title: ${effectiveTitle}\n` +
		`Category: ${item.cat_name} (${item.cat_code})\n` +
		(item.brand_name ? `Brand: ${item.brand_name}\n` : '') +
		(item.model ? `Model code: ${item.model}\n` : '') +
		`Condition: ${CONDITION_LABEL[item.condition] ?? item.condition}\n` +
		(item.price_cents != null ? `Price: $${(item.price_cents / 100).toFixed(2)}\n` : '') +
		(effectiveDescription
			? `\nDescription (plain text):\n${effectiveDescription}\n`
			: '\n(No description provided.)\n') +
		(existing.length > 0
			? `\n# Already on the listing (don't suggest these again)\n${existing.map((t) => `- ${t}`).join('\n')}\n`
			: '') +
		`\nReturn 5–10 tags as JSON: { "tags": [...] }. Most relevant first.`;

	const anthropic = new Anthropic({ apiKey });

	try {
		const message = await anthropic.messages.create({
			model: 'claude-haiku-4-5',
			max_tokens: 512,
			cache_control: { type: 'ephemeral' },
			system: SYSTEM_PROMPT,
			messages: [{ role: 'user', content: userPrompt }]
		});

		const raw = message.content
			.filter((b): b is Anthropic.TextBlock => b.type === 'text')
			.map((b) => b.text)
			.join('')
			.trim();
		if (!raw) throw error(502, 'Claude returned an empty response.');

		// Defensive stripping of code fences / preamble before JSON parse.
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

		let parsed: { tags?: unknown };
		try {
			parsed = JSON.parse(jsonSlice) as { tags?: unknown };
		} catch (e) {
			console.error('suggest-tags: unparseable JSON', { raw, e });
			throw error(502, 'AI returned an unreadable response. Try again.');
		}

		// Normalize: lowercased, hyphenated, deduped, existing-excluded,
		// capped at 12 just in case the model goes long.
		const cleanedTags = Array.isArray(parsed.tags)
			? (parsed.tags as unknown[])
					.filter((t): t is string => typeof t === 'string')
					.map((t) =>
						t
							.toLowerCase()
							.trim()
							.replace(/\s+/g, '-')
							.replace(/[^a-z0-9-]/g, '')
							.replace(/-+/g, '-')
							.replace(/^-|-$/g, '')
					)
					.filter((t) => t.length > 0 && !existing.includes(t))
			: [];
		const finalTags = Array.from(new Set(cleanedTags)).slice(0, 12);

		return json({
			tags: finalTags,
			usage: {
				input_tokens: message.usage.input_tokens,
				output_tokens: message.usage.output_tokens,
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
