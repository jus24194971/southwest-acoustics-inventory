import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';

/**
 * POST /api/inbound/parse
 *
 * Extracts purchase-order line items from an Alibaba (or any supplier)
 * order — given either pasted text OR a screenshot. Claude reads it and
 * returns structured lines the receiving flow can map to inventory.
 *
 * Body (JSON):
 *   {
 *     text?: string,            // pasted order text
 *     imageBase64?: string,     // screenshot, base64 (no data: prefix)
 *     imageMediaType?: string   // e.g. "image/png" | "image/jpeg"
 *   }
 *
 * Returns:
 *   {
 *     supplier?: string,
 *     orderRef?: string,
 *     lines: [{ description, quantity, unitCostCents, supplierSku }],
 *     usage: {...}
 *   }
 *
 * Model: Claude Haiku 4.5 — vision-capable, cheap, fine for reading an
 * order screenshot or block of text. We prompt for strict JSON and
 * defensively strip fences before parsing (same pattern as the listing
 * suggesters).
 */

const SYSTEM_PROMPT = `You extract purchase-order line items from a supplier order (often Alibaba) for a guitar-parts shop. The input is either pasted order text or a screenshot of an order/invoice.

Pull out every distinct product line. For each line capture:
- description: the product name/title as written (keep it specific — include color, size, material, model if shown).
- quantity: the number of units ordered (integer; default 1 if unclear).
- unitCost: the per-unit price as a number in the order's currency, or null if not shown. (If only a line total + qty are shown, divide to get unit cost.)
- supplierSku: the seller's model number / SKU / item code if present, else null.

Also capture, if visible:
- supplier: the seller / store / company name.
- orderRef: the order number / order ID.

Rules:
- One object per distinct product. Combine obvious duplicates only if they're truly the same line.
- Ignore shipping fees, taxes, discounts, totals — those are NOT product lines.
- Prices are numbers only (no currency symbols). Use the unit price, not the line total.
- If the image/text isn't an order or has no products, return an empty lines array.

Return a single JSON object, nothing else:

{
  "supplier": "string or null",
  "orderRef": "string or null",
  "lines": [
    { "description": "string", "quantity": 1, "unitCost": 12.5, "supplierSku": "string or null" }
  ]
}

No surrounding text, no code fences, no commentary. The JSON must parse cleanly.`;

interface ReqBody {
	text?: string;
	imageBase64?: string;
	imageMediaType?: string;
}

interface ParsedLine {
	description?: string;
	quantity?: number;
	unitCost?: number | null;
	supplierSku?: string | null;
}

export const POST: RequestHandler = async (event) => {
	const apiKey = event.platform?.env?.ANTHROPIC_API_KEY;
	if (!apiKey) throw error(400, 'ANTHROPIC_API_KEY is not configured.');

	let body: ReqBody = {};
	try {
		body = (await event.request.json()) as ReqBody;
	} catch {
		throw error(400, 'Expected a JSON body with text or imageBase64.');
	}

	const text = (body.text ?? '').trim();
	const hasImage = !!body.imageBase64;
	if (!text && !hasImage) {
		throw error(400, 'Provide either pasted order text or a screenshot.');
	}

	// Build the user message — image block + instruction, or text.
	const content: Anthropic.ContentBlockParam[] = [];
	if (hasImage) {
		const mediaType = (body.imageMediaType ?? 'image/png') as
			| 'image/png'
			| 'image/jpeg'
			| 'image/gif'
			| 'image/webp';
		content.push({
			type: 'image',
			source: { type: 'base64', media_type: mediaType, data: body.imageBase64! }
		});
		content.push({
			type: 'text',
			text:
				'Extract the purchase-order line items from this order screenshot. Return the JSON object only.' +
				(text ? `\n\nExtra context from the user:\n${text}` : '')
		});
	} else {
		content.push({
			type: 'text',
			text: `Extract the purchase-order line items from this order text:\n\n${text}\n\nReturn the JSON object only.`
		});
	}

	const anthropic = new Anthropic({ apiKey });

	try {
		const message = await anthropic.messages.create({
			model: 'claude-haiku-4-5',
			max_tokens: 2048,
			cache_control: { type: 'ephemeral' },
			system: SYSTEM_PROMPT,
			messages: [{ role: 'user', content }]
		});

		const raw = message.content
			.filter((b): b is Anthropic.TextBlock => b.type === 'text')
			.map((b) => b.text)
			.join('')
			.trim();
		if (!raw) throw error(502, 'Claude returned an empty response.');

		const cleaned = raw
			.replace(/^```(?:json|JSON)?\s*\n?/m, '')
			.replace(/\n?```\s*$/m, '')
			.trim();
		const firstBrace = cleaned.indexOf('{');
		const lastBrace = cleaned.lastIndexOf('}');
		const jsonSlice =
			firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;

		let parsed: { supplier?: string | null; orderRef?: string | null; lines?: ParsedLine[] };
		try {
			parsed = JSON.parse(jsonSlice);
		} catch (e) {
			console.error('inbound/parse: unparseable JSON', { raw, e });
			throw error(502, 'AI returned an unreadable response. Try again, or use manual entry.');
		}

		const lines = (parsed.lines ?? [])
			.map((l) => {
				const description = (l.description ?? '').trim();
				if (!description) return null;
				const quantity =
					typeof l.quantity === 'number' && l.quantity > 0 ? Math.round(l.quantity) : 1;
				const unitCostCents =
					typeof l.unitCost === 'number' && l.unitCost >= 0
						? Math.round(l.unitCost * 100)
						: null;
				const supplierSku =
					typeof l.supplierSku === 'string' && l.supplierSku.trim()
						? l.supplierSku.trim()
						: null;
				return { description, quantity, unitCostCents, supplierSku };
			})
			.filter((l): l is NonNullable<typeof l> => l !== null);

		return json({
			supplier: typeof parsed.supplier === 'string' ? parsed.supplier.trim() : null,
			orderRef: typeof parsed.orderRef === 'string' ? parsed.orderRef.trim() : null,
			lines,
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
