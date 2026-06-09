/**
 * AI prefill for the reconciliation wizard's "Have it" path.
 *
 * Given a matched group's listings (titles + prices), ask Claude to read
 * out the product's identity — category, make, model, condition, and
 * descriptive attributes (color/body style/wood/etc.) — then RESOLVE that
 * onto our own taxonomy: a real category id, brand id, and attribute-slot
 * value codes. The result drops straight into the /items/new form so Dad
 * reviews instead of typing. He can correct anything; this just removes
 * the blank-page work.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { D1Database } from '@cloudflare/workers-types';

export interface GroupPrefill {
	title: string;
	description: string;
	categoryId: number | null;
	categoryLabel: string | null;
	brandId: number | null;
	brandCode: string | null;
	brandName: string | null;
	model: string;
	condition: 'N' | 'U' | 'R' | 'B';
	priceCents: number | null;
	attrCodes: string[]; // 5 entries, '' where unmatched
	attrLabels: string[]; // 5 slot labels (for display), '' where the slot is unused
	descriptors: string; // what the AI saw, shown as a hint
}

interface AiOut {
	kind?: string; // 'guitar' | 'part'
	category?: string;
	brand?: string;
	model?: string;
	condition?: string;
	title?: string;
	descriptors?: string[];
}

const HOUSE_BRAND_RE = /south\s*west\s*acoustic|sw\s*acoustic/i;

const COND_MAP: Record<string, 'N' | 'U' | 'R' | 'B'> = {
	new: 'N',
	used: 'U',
	refurbished: 'R',
	refurb: 'R',
	broken: 'B',
	parts: 'B'
};

export async function prefillGroup(
	db: D1Database,
	apiKey: string,
	listings: Array<{ platform: string; title: string; price_cents: number | null }>,
	imageUrl: string | null = null
): Promise<GroupPrefill> {
	const titles = listings.map((l) => `[${l.platform}] ${l.title}`).join('\n');
	const maxPrice = listings.reduce<number | null>(
		(m, l) => (l.price_cents != null && (m == null || l.price_cents > m) ? l.price_cents : m),
		null
	);
	const firstTitle = listings[0]?.title ?? 'Item';

	// Reference data for resolution.
	const { results: cats } = await db
		.prepare(
			`SELECT id, code, name,
			        attr_1_label, attr_2_label, attr_3_label, attr_4_label, attr_5_label,
			        attr_1_context_key, attr_2_context_key, attr_3_context_key,
			        attr_4_context_key, attr_5_context_key
			 FROM category ORDER BY name`
		)
		.all<Record<string, string | number | null>>();
	const { results: brands } = await db
		.prepare(`SELECT id, code, name FROM brand ORDER BY name`)
		.all<{ id: number; code: string; name: string }>();

	const catList = cats.map((c) => `${c.code} = ${c.name}`).join('\n');
	const brandList = brands.map((b) => b.name).join(', ');

	const system = `You read marketplace listings for a guitar shop and extract the product's identity so it can be filed into inventory. You may be given a PHOTO of the product — use it, especially to decide what the item is. Return ONLY JSON:
{ "kind": "guitar|part", "category": "<the CODE of the best-fit category from the list>", "brand": "<make, or empty>", "model": "<model name/number>", "condition": "new|used|refurbished|broken", "title": "<clean concise product title>", "descriptors": ["color, body style, wood, pickup config, size, finish, etc. — each a short phrase"] }

FIRST decide "kind":
- Look at the photo and title. If it is a specific PART or accessory (pickup, bridge, tuner/machine head, pickguard, knob, neck, body, nut, saddle, control plate, hardware, strings, case), kind = "part".
- If you CANNOT confidently identify it as a specific part, it is almost always a COMPLETE GUITAR — set kind = "guitar" and pick a guitar category.

Pick the category CODE from this list (left side):
${catList}

Brands: ${brandList}. IMPORTANT — "Southwest Acoustics" (also written "SW Acoustics" / "Southwest Acoustic") is THIS shop's own house brand. If the item is one of their own builds (especially a complete guitar that isn't clearly another maker's model), set brand to "Southwest Acoustics". Otherwise use the closest known brand, or your own if none fit.

Rules: model is required (your best guess). condition defaults to "used" if unclear. descriptors should capture every spec a buyer cares about (color, finish, body shape, wood, pickup type, position, size). No prose, no code fences.`;

	// Build the user message — include the photo when we have one so the
	// model can classify guitar-vs-part visually.
	const userContent: Anthropic.ContentBlockParam[] = [];
	if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
		userContent.push({ type: 'image', source: { type: 'url', url: imageUrl } });
	}
	userContent.push({
		type: 'text',
		text: `Listings for one product:\n${titles}\n\nReturn the JSON.`
	});

	let ai: AiOut = {};
	try {
		const anthropic = new Anthropic({ apiKey });
		const msg = await anthropic.messages.create({
			model: 'claude-haiku-4-5',
			max_tokens: 1024,
			system,
			messages: [{ role: 'user', content: userContent }]
		});
		const raw = msg.content
			.filter((b): b is Anthropic.TextBlock => b.type === 'text')
			.map((b) => b.text)
			.join('')
			.trim();
		const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
		const fb = cleaned.indexOf('{');
		const lb = cleaned.lastIndexOf('}');
		ai = JSON.parse(fb >= 0 && lb > fb ? cleaned.slice(fb, lb + 1) : cleaned) as AiOut;
	} catch {
		ai = {};
	}

	// ---- Resolve category ----
	const aiCat = (ai.category ?? '').trim().toLowerCase();
	let category = cats.find((c) => String(c.code).toLowerCase() === aiCat) ?? null;
	if (!category && aiCat) {
		category = cats.find((c) => String(c.name).toLowerCase().includes(aiCat)) ?? null;
	}

	// ---- Resolve brand ----
	const aiBrand = (ai.brand ?? '').trim();
	// Treat it as the house brand if "Southwest Acoustics" shows up anywhere —
	// the AI's brand guess OR any of the listing titles. (Dad's rule: title
	// says Southwest Acoustics → brand is SWA.)
	const looksHouse =
		HOUSE_BRAND_RE.test(aiBrand) || listings.some((l) => HOUSE_BRAND_RE.test(l.title));
	let brandId: number | null = null;
	let brandCode: string | null = null;
	let brandName: string | null = null;
	if (looksHouse) {
		// Southwest Acoustics — Dad's own builds. Link the existing brand
		// row if there is one, else hand the form a ready code + name.
		const house = brands.find((x) => HOUSE_BRAND_RE.test(x.name));
		if (house) {
			brandId = house.id;
			brandName = house.name;
		} else {
			brandCode = 'SWA';
			brandName = 'Southwest Acoustics';
		}
	} else if (aiBrand) {
		const b =
			brands.find((x) => x.name.toLowerCase() === aiBrand.toLowerCase()) ??
			brands.find((x) => x.name.toLowerCase().includes(aiBrand.toLowerCase()));
		if (b) {
			brandId = b.id;
			brandName = b.name;
		} else {
			brandCode = aiBrand.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || null;
			brandName = aiBrand;
		}
	}

	// ---- Condition ----
	const condition = COND_MAP[(ai.condition ?? '').trim().toLowerCase()] ?? 'U';

	// ---- Attribute slots ----
	const descriptors = (ai.descriptors ?? []).join(', ');
	const searchText = `${descriptors} ${firstTitle}`.toLowerCase();
	const attrCodes = ['', '', '', '', ''];
	const attrLabels = ['', '', '', '', ''];
	if (category) {
		for (let n = 1; n <= 5; n++) {
			const label = category[`attr_${n}_label`] as string | null;
			const ctx = category[`attr_${n}_context_key`] as string | null;
			attrLabels[n - 1] = label ?? '';
			if (!ctx) continue;
			const { results: vals } = await db
				.prepare(`SELECT code, label FROM attribute_value WHERE context_key = ? AND is_active = 1`)
				.bind(ctx)
				.all<{ code: string; label: string }>();
			// Longest label first so "semi-hollow" wins over "hollow".
			const match = vals
				.slice()
				.sort((a, b) => b.label.length - a.label.length)
				.find((v) => v.label.length >= 2 && searchText.includes(v.label.toLowerCase()));
			if (match) attrCodes[n - 1] = match.code;
		}
	}

	// Seed the description with the title so onboarded items are never blank —
	// a "for now" baseline Dad (or the AI suggester) can flesh out later.
	const finalTitle = (ai.title ?? firstTitle).slice(0, 200);
	return {
		title: finalTitle,
		description: finalTitle,
		categoryId: category ? (category.id as number) : null,
		categoryLabel: category ? `${category.code} · ${category.name}` : null,
		brandId,
		brandCode,
		brandName,
		model: (ai.model ?? '').toString().trim().slice(0, 40),
		condition,
		priceCents: maxPrice,
		attrCodes,
		attrLabels,
		descriptors
	};
}
