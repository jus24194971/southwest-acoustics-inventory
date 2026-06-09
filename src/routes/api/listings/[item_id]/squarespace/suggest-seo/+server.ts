import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { getDB } from '$lib/server/db';

/**
 * POST /api/listings/<item_id>/squarespace/suggest-seo
 *
 * Generates an SEO TITLE + meta DESCRIPTION pair tuned for Google's
 * SERP display, based on the listing's current title + description +
 * a few item specifics (brand, model, condition, attributes).
 *
 * Body (JSON, optional):
 *   {
 *     title?: string,            // override the saved/in-progress title
 *     descriptionHtml?: string,  // override the saved description
 *     existingSeoTitle?: string, // refine an existing draft
 *     existingSeoDescription?: string,
 *     instructions?: string      // freeform refinement steering
 *   }
 *
 * Returns:
 *   { seoTitle: string, seoDescription: string, usage: {...} }
 *
 * Model: Claude Haiku 4.5 — same backend as the listing + tag
 * suggesters. SEO copy is short, so max_tokens stays tiny.
 *
 * SEO target lengths (Google SERP, late 2025):
 *   - Title: ~50–60 chars, hard wall around 60 (mobile) / 70 (desktop)
 *     before SERP truncation. SS allows up to 100, but we recommend
 *     a 60-char target so search-result snippets stay intact.
 *   - Meta description: ~140–160 chars. SS allows up to 400, but
 *     Google truncates around 160 on most queries. We aim 150–160
 *     so the snippet reads complete on the SERP.
 */

const SEO_TITLE_TARGET_MAX = 60;
const SEO_TITLE_HARD_CAP = 100; // SS admin limit; truncate beyond
const SEO_DESC_TARGET_MAX = 160;
const SEO_DESC_HARD_CAP = 400; // SS admin limit

const SYSTEM_PROMPT = `You write SEO metadata for product listings at southwestacousticproducts.com — Southwest Acoustics, a small guitar parts and custom builds shop. The output is the page-title tag and meta description that show up in Google's search results for one product page.

# SEO TITLE rules

- Aim for 50–60 characters. Hard wall at 60 chars (Google truncates mobile SERPs around there).
- Lead with the most-searched terms first — brand, model, then product type. People scan SERPs left-to-right.
- Include the brand if known. Include the model if there is one. Include the product type (guitar, pickups, bridge, etc.).
- Include ONE differentiator only when it earns the space: color/finish, key spec, or "Used"/"New".
- Skip filler like "for sale", "buy now", "best", "amazing", "great deal" — Google penalizes promotional language.
- DON'T pad with the brand name "Southwest Acoustics" unless it's a house build. The site domain already signals that.
- Use Title Case. No emojis. No pipes/dashes/colons unless they help readability.

# META DESCRIPTION rules

- Aim for 140–160 characters. Hard wall at 160 (Google truncates beyond that on most queries).
- One or two complete sentences. Sound like a human, not a sales pitch.
- Lead with what the product IS (e.g. "Semi-hollow jazz guitar with rosewood fretboard…"), then ONE selling point.
- Mention price ONLY if it's a clear differentiator. Don't say "for sale" or "available now".
- DO include a soft CTA at the end ("Free shipping included.", "Set up and ready to play.", "Ships from Florida.") if it fits the budget.
- DON'T duplicate the SEO title word-for-word — the SERP shows both.
- Avoid stop-words at the start: "The…", "A…", "An…" eat character budget.
- No HTML, no markdown, no emojis. Plain text.

# Output format

Return a single JSON object with EXACTLY this shape and nothing else:

{
  "seoTitle": "the SEO title string",
  "seoDescription": "the meta description string"
}

- No surrounding text. No code fences. No preamble like "Here is the SEO".
- Both values are JSON strings — escape internal double-quotes per JSON.
- The JSON must parse cleanly.`;

interface ReqBody {
	title?: string;
	descriptionHtml?: string;
	existingSeoTitle?: string;
	existingSeoDescription?: string;
	instructions?: string;
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
	model: string | null;
	cat_name: string;
	cat_code: string;
	brand_name: string | null;
	brand_code: string | null;
}

const CONDITION_LABEL: Record<string, string> = {
	N: 'New',
	U: 'Used',
	R: 'Refurbished',
	B: 'For parts / broken'
};

/** Strip HTML, collapse whitespace, cap length. Same helper pattern
 *  as suggest-tags — keeps the prompt cheap when descriptions are
 *  long (imported SS bodies can be huge). */
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

	// Refinement block — only when the user passed instructions plus
	// the existing draft they want to refine. Matches the pattern in
	// suggest-listing for consistency.
	let refinementBlock = '';
	const hasInstructions = (body.instructions ?? '').trim().length > 0;
	const hasExisting =
		(body.existingSeoTitle || body.existingSeoDescription) && hasInstructions;
	if (hasExisting) {
		refinementBlock = '\n\n# Previous draft (to refine)\n\n';
		if (body.existingSeoTitle) {
			refinementBlock += `SEO Title: ${body.existingSeoTitle}\n\n`;
		}
		if (body.existingSeoDescription) {
			refinementBlock += `SEO Description: ${body.existingSeoDescription}\n\n`;
		}
		refinementBlock +=
			'# Changes the user wants\n\n' +
			body.instructions!.trim() +
			'\n\nProduce a refined SEO pair that incorporates these changes. Keep what works; rework only what was asked about.';
	} else if (hasInstructions) {
		refinementBlock =
			'\n\n# Extra steering from the user\n\n' + body.instructions!.trim();
	}

	const userPrompt =
		`Generate the SEO title + meta description for this product page.\n\n` +
		`# Listing\n\n` +
		`Title (the customer-facing product name): ${effectiveTitle}\n` +
		`Internal title: ${item.title}\n` +
		`Category: ${item.cat_name} (${item.cat_code})\n` +
		(item.brand_name ? `Brand: ${item.brand_name}\n` : '') +
		(item.model ? `Model: ${item.model}\n` : '') +
		`Condition: ${CONDITION_LABEL[item.condition] ?? item.condition}\n` +
		(item.price_cents != null
			? `Price: $${(item.price_cents / 100).toFixed(2)}\n`
			: '') +
		(effectiveDescription
			? `\nDescription (plain text — what the customer reads on the page):\n${effectiveDescription}\n`
			: '\n(No description provided.)\n') +
		refinementBlock +
		`\nReturn ONLY the JSON object with "seoTitle" (≤60 chars target) and "seoDescription" (≤160 chars target).`;

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

		// Defensive code-fence / preamble stripping. Same pattern as the
		// other suggesters — Haiku usually returns clean JSON, but the
		// occasional "Here is the SEO:" prefix slips through.
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

		let parsed: { seoTitle?: string; seoDescription?: string };
		try {
			parsed = JSON.parse(jsonSlice) as {
				seoTitle?: string;
				seoDescription?: string;
			};
		} catch (e) {
			console.error('suggest-seo: unparseable JSON', { raw, e });
			throw error(502, 'AI returned an unreadable response. Try again.');
		}

		// Trim + hard-cap to SS admin limits. The system prompt aims
		// at the tighter Google-SERP targets, but the SS API will
		// reject anything over 100 / 400 chars on push, so enforce
		// that here regardless.
		const seoTitle = (parsed.seoTitle ?? '').trim().slice(0, SEO_TITLE_HARD_CAP);
		const seoDescription = (parsed.seoDescription ?? '')
			.trim()
			.slice(0, SEO_DESC_HARD_CAP);

		if (!seoTitle || !seoDescription) {
			throw error(502, 'AI response was missing seoTitle or seoDescription. Try again.');
		}

		return json({
			seoTitle,
			seoDescription,
			// Echo the targets so the UI can flag if the model went over
			// (rare but possible — Haiku has a soft tendency to round up).
			targets: {
				titleMax: SEO_TITLE_TARGET_MAX,
				descriptionMax: SEO_DESC_TARGET_MAX
			},
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
