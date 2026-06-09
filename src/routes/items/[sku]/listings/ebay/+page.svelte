<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import type { PageData, ActionData } from './$types';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import InfoTip from '$lib/components/InfoTip.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const savedJustNow = $derived(page.url.searchParams.get('saved') === '1');
	const pushedJustNow = $derived(page.url.searchParams.get('pushed') === '1');
	const publishedJustNow = $derived(page.url.searchParams.get('published') === '1');

	const extras = $derived.by(() => {
		const raw = data.listing?.platform_extras_json;
		if (!raw) return {} as Record<string, string | null>;
		try {
			return JSON.parse(raw) as Record<string, string | null>;
		} catch {
			return {};
		}
	});

	// Description seed precedence:
	//   1. eBay's own saved description (don't stomp eBay-specific edits)
	//   2. the Squarespace listing's description (the polished, AI/SEO'd
	//      customer copy — the best default for a fresh eBay listing)
	//   3. the raw item description
	// The "Pull from Squarespace" button below re-applies #2 on demand.
	const initial = untrack(() => ({
		title: data.listing?.listing_title ?? data.item.title,
		description:
			data.listing?.listing_description_html ??
			data.ssDescriptionHtml ??
			data.item.description_html ??
			'',
		price:
			data.listing?.listing_price_cents != null
				? (data.listing.listing_price_cents / 100).toFixed(2)
				: data.suggestedPriceCents > 0
					? (data.suggestedPriceCents / 100).toFixed(2)
					: data.item.price_cents != null
						? (data.item.price_cents / 100).toFixed(2)
						: '',
		categoryId:
			(data.listing?.platform_extras_json
				? (JSON.parse(data.listing.platform_extras_json) as Record<string, string | null>)
						.ebay_category_id ?? ''
				: '') || (data.categorySuggestions[0]?.categoryId ?? ''),
		condition:
			(data.listing?.platform_extras_json
				? (JSON.parse(data.listing.platform_extras_json) as Record<string, string | null>)
						.ebay_condition ?? ''
				: '') || '',
		conditionDesc: (data.listing?.platform_extras_json
			? (JSON.parse(data.listing.platform_extras_json) as Record<string, string | null>)
					.ebay_condition_description ?? ''
			: '') as string,
		brand: (data.listing?.platform_extras_json
			? (JSON.parse(data.listing.platform_extras_json) as Record<string, string | null>)
					.ebay_brand ?? ''
			: data.item.brand_name ?? '') as string,
		mpn: (data.listing?.platform_extras_json
			? (JSON.parse(data.listing.platform_extras_json) as Record<string, string | null>)
					.ebay_mpn ?? ''
			: '') as string,
		upc: (data.listing?.platform_extras_json
			? (JSON.parse(data.listing.platform_extras_json) as Record<string, string | null>)
					.ebay_upc ?? ''
			: '') as string,
		fulfillmentPolicyId: (data.listing?.platform_extras_json
			? (JSON.parse(data.listing.platform_extras_json) as Record<string, string | null>)
					.ebay_fulfillment_policy_id ?? ''
			: '') as string,
		paymentPolicyId: (data.listing?.platform_extras_json
			? (JSON.parse(data.listing.platform_extras_json) as Record<string, string | null>)
					.ebay_payment_policy_id ?? ''
			: '') as string,
		returnPolicyId: (data.listing?.platform_extras_json
			? (JSON.parse(data.listing.platform_extras_json) as Record<string, string | null>)
					.ebay_return_policy_id ?? ''
			: '') as string
	}));

	const STATUS_PILL: Record<string, string> = {
		draft: 'pill',
		ready: 'pill-warn',
		live: 'pill-success',
		paused: 'pill',
		error: 'pill-danger'
	};
	const STATUS_LABEL: Record<string, string> = {
		draft: 'Draft',
		ready: 'Ready to push',
		live: 'Live on eBay',
		paused: 'Paused',
		error: 'Last push errored'
	};

	let status = $derived(data.listing?.status ?? 'draft');
	let pushDisabled = $derived(!data.conn.user || !data.hasMerchantLocation);

	// Rich-text editor handle, so the "Pull from Squarespace" button can
	// overwrite the description on demand (setHtml bypasses the hidden
	// input round-trip). Bound on the <RichTextEditor> below.
	let editorRef: { setHtml(html: string): void } | undefined = $state();
	let ssPulled = $state(false);
	function pullSsDescription() {
		if (!data.ssDescriptionHtml) return;
		editorRef?.setHtml(data.ssDescriptionHtml);
		ssPulled = true;
		// Reset the "✓ Pulled" label after a moment so the button reads
		// as re-pullable again.
		setTimeout(() => (ssPulled = false), 2000);
	}

	// ----------------------------------------------------------------
	// Item specifics (eBay aspects) — the listing-rejection killer.
	// ----------------------------------------------------------------
	// Server pre-loads the auto-mapped aspects for the initial category.
	// When Dad changes the category, we re-fetch + re-map client-side
	// via /api/listings/<id>/ebay/aspects?category=<id>.
	//
	// Each aspect renders as a field named `aspect:<AspectName>`; the
	// server's parseFormData collects them all. The bound value lives
	// in `aspectValues` keyed by aspect name.

	type AspectMapping = {
		aspect: {
			name: string;
			required: boolean;
			usage: string;
			mode: 'FREE_TEXT' | 'SELECTION_ONLY';
			cardinality: 'SINGLE' | 'MULTI';
			dataType: string;
			allowedValues: string[];
		};
		suggestedValue: string | null;
		source: string;
		matchedAttributeLabel?: string;
		valueInAllowedList: boolean;
	};

	// Current category id, bound to the category input. Initialized from
	// the server's resolved initial category.
	let categoryId = $state(data.initialCategoryId ?? '');

	// The live aspect mappings. Starts from the server's pre-load,
	// replaced on category change.
	let aspectMappings = $state<AspectMapping[]>(
		(data.aspectMappings ?? []) as AspectMapping[]
	);
	let aspectError = $state<string | null>(data.aspectError ?? null);
	let aspectsLoading = $state(false);

	// Chosen value per aspect name. Seeded from the suggestions.
	let aspectValues = $state<Record<string, string>>({});
	$effect(() => {
		// Re-seed whenever the mapping set changes (initial + on re-fetch).
		// Only fill keys we don't already have a user edit for would be
		// ideal, but since a category change invalidates old aspects
		// entirely, a full reseed is correct here.
		const next: Record<string, string> = {};
		for (const m of aspectMappings) {
			next[m.aspect.name] = m.suggestedValue ?? '';
		}
		aspectValues = next;
	});

	// Required aspects that are still empty — drives the push-blocking
	// warning and the field highlight.
	let missingRequired = $derived(
		aspectMappings
			.filter((m) => m.aspect.required && !(aspectValues[m.aspect.name] ?? '').trim())
			.map((m) => m.aspect.name)
	);

	// Sort required-first for display so the must-fill fields are up top.
	let sortedAspects = $derived(
		[...aspectMappings].sort((a, b) => {
			if (a.aspect.required !== b.aspect.required) return a.aspect.required ? -1 : 1;
			return 0;
		})
	);

	let autoFilledCount = $derived(
		aspectMappings.filter((m) => (aspectValues[m.aspect.name] ?? '').trim()).length
	);

	async function reloadAspects(newCategoryId: string) {
		const cid = newCategoryId.trim();
		if (!cid) {
			aspectMappings = [];
			aspectError = null;
			return;
		}
		aspectsLoading = true;
		aspectError = null;
		try {
			const res = await fetch(
				`/api/listings/${data.item.id}/ebay/aspects?category=${encodeURIComponent(cid)}`
			);
			if (!res.ok) {
				const text = await res.text();
				aspectError = `${res.status}: ${text.slice(0, 200)}`;
				aspectMappings = [];
				return;
			}
			const payload = (await res.json()) as { mappings: AspectMapping[] };
			aspectMappings = payload.mappings;
		} catch (err) {
			aspectError = err instanceof Error ? err.message : String(err);
			aspectMappings = [];
		} finally {
			aspectsLoading = false;
		}
	}

	// When Dad picks a suggestion or edits the category id, re-fetch.
	// Debounced lightly so typing a multi-digit id doesn't spam the API.
	let categoryDebounce: ReturnType<typeof setTimeout> | undefined;
	function onCategoryChange(newId: string) {
		categoryId = newId;
		clearTimeout(categoryDebounce);
		categoryDebounce = setTimeout(() => reloadAspects(newId), 400);
	}
</script>

<section class="space-y-6">
	<header class="space-y-2">
		<a
			href="/items/{encodeURIComponent(data.item.sku)}"
			class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
		>
			← Back to item
		</a>
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<p class="font-mono text-sm text-[color:var(--color-gold)]">{data.item.sku}</p>
			<span class={STATUS_PILL[status] ?? 'pill'}>{STATUS_LABEL[status] ?? status}</span>
		</div>
		<h1 class="headline text-3xl inline-flex items-baseline gap-2">
			eBay listing
			<InfoTip title="How eBay listing works">
				<p>
					Lists this item on eBay via the Inventory API. Three-call flow per push:
					describe the SKU → create an offer → publish (if you want it live).
				</p>
				<p>
					<strong>Photos</strong> come from the already-pushed Squarespace listing
					(eBay accepts public URLs; our R2 bucket sits behind Cloudflare Access).
					Push to Squarespace first if you don't see any.
				</p>
			</InfoTip>
		</h1>
	</header>

	<!-- Status banners -->
	{#if savedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">Saved locally. No push happened.</p>
		</div>
	{:else if pushedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				{#if publishedJustNow}
					Pushed and published — listing is live on eBay.
				{:else}
					Pushed to eBay as an unpublished offer. Use the eBay Seller Hub to review and
					publish, or push again with "Publish live" to take it live from here.
				{/if}
			</p>
			{#if data.listing?.external_url}
				<p class="mt-1 text-xs">
					<a
						href={data.listing.external_url}
						target="_blank"
						class="text-[color:var(--color-gold-bright)] underline"
					>
						View on eBay ↗
					</a>
				</p>
			{/if}
		</div>
	{/if}

	{#if form?.pushError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.pushError}</p>
		</div>
	{/if}

	{#if data.listing?.last_sync_error && !pushedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">
				Last push error: {data.listing.last_sync_error}
			</p>
		</div>
	{/if}

	<!-- Connection state -->
	{#if !data.conn.user || !data.hasMerchantLocation}
		<div class="panel px-4 py-3" style="border-color: var(--color-gold-dim)">
			<p class="text-[11px] font-semibold text-[color:var(--color-gold-bright)]">
				⚠ eBay isn't fully set up yet — Push is disabled.
			</p>
			<ul class="mt-1.5 space-y-0.5 text-[11px] text-[color:var(--color-ink-2)]">
				<li>
					App token (taxonomy):
					{#if data.conn.app}
						<span class="text-[color:var(--color-moss-bright)]">✓ working</span>
					{:else}
						<span class="text-[color:var(--color-rust-bright)]">✗ missing</span>
						— set <code>EBAY_CLIENT_ID</code> and <code>EBAY_CLIENT_SECRET</code> as Pages
						secrets.
					{/if}
				</li>
				<li>
					User token (listings):
					{#if data.conn.user}
						<span class="text-[color:var(--color-moss-bright)]">✓ working</span>
					{:else}
						<span class="text-[color:var(--color-rust-bright)]">✗ missing</span>
						— set <code>EBAY_REFRESH_TOKEN</code> (created via eBay's OAuth consent flow
						with sell.inventory + sell.account.readonly scopes).
					{/if}
				</li>
				<li>
					Merchant location:
					{#if data.hasMerchantLocation}
						<span class="text-[color:var(--color-moss-bright)]">✓ working</span>
					{:else}
						<span class="text-[color:var(--color-rust-bright)]">✗ missing</span>
						— set <code>EBAY_MERCHANT_LOCATION_KEY</code> matching a warehouse you've
						created in eBay Seller Hub.
					{/if}
				</li>
			</ul>
			{#if data.conn.error}
				<p class="mt-2 text-[10px] italic text-[color:var(--color-ink-4)]">
					{data.conn.error}
				</p>
			{/if}
		</div>
	{/if}

	<!-- Context card -->
	<div class="panel space-y-2 px-4 py-3">
		<p class="eyebrow">Item being listed</p>
		<p class="text-sm">
			<span class="font-medium text-[color:var(--color-ink)]">{data.item.title}</span>
		</p>
		<p class="text-[11px] text-[color:var(--color-ink-3)]">
			Tracking: <span class="font-mono">{data.item.tracking_mode}</span>
			· On hand <span class="font-mono">{data.item.stock_qty}</span>
			· Internal price
			<span class="font-mono">
				{data.item.price_cents != null
					? `$${(data.item.price_cents / 100).toFixed(2)}`
					: '—'}
			</span>
		</p>
		<p class="text-[11px] text-[color:var(--color-ink-3)]">
			Photo source: {data.photoUrls.length > 0
				? `${data.photoUrls.length} from Squarespace CDN`
				: 'none (push to Squarespace first)'}
			{#if data.photoSourceError}
				<span class="ml-1 text-[color:var(--color-rust-bright)]">
					· {data.photoSourceError}
				</span>
			{/if}
		</p>
	</div>

	<!-- Listing form -->
	<form method="POST" class="panel space-y-5 px-6 py-6">
		<div class="space-y-1.5">
			<label for="listing_title" class="eyebrow block">Listing title</label>
			<input
				id="listing_title"
				name="listing_title"
				type="text"
				value={initial.title}
				maxlength="80"
				class="field"
				placeholder={data.item.title}
			/>
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				eBay caps titles at 80 characters. Keyword-dense; search ranking still
				rewards "Brand Model Type Condition" patterns.
			</p>
		</div>

		<div class="space-y-1.5">
			<div class="flex items-baseline justify-between gap-3">
				<span class="eyebrow">Listing description</span>
				{#if data.ssDescriptionHtml}
					<button
						type="button"
						class="btn-ghost px-2 py-1 text-[11px]"
						onclick={pullSsDescription}
						title="Replace the description below with the one from this item's Squarespace listing"
					>
						{ssPulled ? '✓ Pulled from Squarespace' : '↓ Pull description from Squarespace'}
					</button>
				{/if}
			</div>
			<RichTextEditor
				bind:this={editorRef}
				name="listing_description_html"
				initialHtml={initial.description}
				placeholder="Customer-facing description for the eBay listing…"
			/>
			{#if data.ssDescriptionHtml}
				<p class="text-[11px] italic text-[color:var(--color-ink-4)]">
					{#if data.listing?.listing_description_html}
						Currently showing the saved eBay description. Pull to overwrite it with the
						Squarespace copy.
					{:else}
						Pre-filled from the Squarespace listing — edit freely for eBay, or pull again
						to reset.
					{/if}
				</p>
			{/if}
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="listing_price" class="eyebrow block inline-flex items-center gap-0.5">
					Listing price ($)
					<InfoTip>
						<p>
							Pre-filled to gross up the item's base price so you net the base
							after eBay's fees. Override per listing if a specific item warrants
							different pricing.
						</p>
						<p>
							Fees applied: <code>{data.feeLabel}</code>
						</p>
					</InfoTip>
				</label>
				<input
					id="listing_price"
					name="listing_price"
					type="number"
					step="0.01"
					min="0"
					value={initial.price}
					placeholder="auto-grossed-up from item base price"
					class="field"
				/>
				{#if data.suggestedPriceCents > 0 && data.item.price_cents}
					<p class="text-[10px] italic text-[color:var(--color-ink-4)]">
						List at ${(data.suggestedPriceCents / 100).toFixed(2)} to net
						${(data.item.price_cents / 100).toFixed(2)} (the item's base price)
						after eBay's fees.
					</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<label for="ebay_condition" class="eyebrow block inline-flex items-center gap-0.5">
					Condition
					<InfoTip>
						<p>
							eBay uses its own condition enum (different from Reverb). Defaults
							mapped from your internal condition code, but you can override per
							listing.
						</p>
					</InfoTip>
				</label>
				<select
					id="ebay_condition"
					name="ebay_condition"
					value={initial.condition}
					class="field"
				>
					<option value="">— auto from item condition —</option>
					<option value="NEW">New</option>
					<option value="NEW_OTHER">New (other — open box, etc.)</option>
					<option value="NEW_WITH_DEFECTS">New with defects</option>
					<option value="USED_EXCELLENT">Used — Excellent</option>
					<option value="USED_VERY_GOOD">Used — Very Good</option>
					<option value="USED_GOOD">Used — Good</option>
					<option value="USED_ACCEPTABLE">Used — Acceptable</option>
					<option value="FOR_PARTS_OR_NOT_WORKING">For parts / not working</option>
				</select>
			</div>
		</div>

		<div class="space-y-1.5">
			<label for="ebay_condition_description" class="eyebrow block">
				Condition description <span class="lowercase">(optional)</span>
			</label>
			<input
				id="ebay_condition_description"
				name="ebay_condition_description"
				type="text"
				value={initial.conditionDesc}
				maxlength="1000"
				placeholder="Specifics buyers should know — wear, modifications, included accessories…"
				class="field"
			/>
		</div>

		<!-- Category -->
		<div class="space-y-1.5">
			<label for="ebay_category_id" class="eyebrow block inline-flex items-center gap-0.5">
				eBay category
				<InfoTip>
					<p>
						eBay categories use numeric IDs (~24,000 of them). The suggestions
						below come from eBay's taxonomy lookup against this item's title.
					</p>
					<p>
						If none of the suggestions are right, paste a category ID manually —
						you can find one by searching the same item on eBay and pulling
						the ID from the URL.
					</p>
				</InfoTip>
			</label>
			<input
				id="ebay_category_id"
				name="ebay_category_id"
				type="text"
				value={categoryId}
				oninput={(e) => onCategoryChange(e.currentTarget.value)}
				placeholder="e.g. 33034 (Guitars & Basses)"
				class="field font-mono"
			/>
			{#if data.categorySuggestions.length > 0}
				<div class="mt-2 space-y-1 text-[11px]">
					<p class="text-[color:var(--color-gold-dim)]">
						✨ Suggestions for "{data.item.title}":
					</p>
					<ul class="space-y-0.5">
						{#each data.categorySuggestions.slice(0, 5) as c (c.categoryId)}
							<li>
								<button
									type="button"
									class="text-left text-[color:var(--color-ink-2)] hover:text-[color:var(--color-gold-bright)]"
									class:text-[color:var(--color-gold-bright)]={categoryId === c.categoryId}
									onclick={() => onCategoryChange(c.categoryId)}
								>
									<code class="font-mono text-[color:var(--color-gold)]">{c.categoryId}</code>
									·
									{c.categoryName}
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{:else if data.conn.app}
				<p class="text-[10px] italic text-[color:var(--color-ink-4)]">
					No category suggestions returned for this title. Refine the title or
					paste an ID manually.
				</p>
			{/if}
		</div>

		<!-- ============= Item specifics (eBay aspects) ============= -->
		<fieldset class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
			<legend class="eyebrow px-2 inline-flex items-center gap-0.5">
				Item specifics
				<InfoTip title="Item specifics (why eBay rejects listings)">
					<p>
						eBay's <strong>required</strong> structured fields for this category.
						A listing <strong>won't publish</strong> if a required specific is
						blank — this is the #1 reason eBay rejects listings.
					</p>
					<p>
						We auto-fill these from the item's make / model / color / wood and
						other attributes. Anything we couldn't map (or where the value isn't
						one of eBay's allowed options) is left for you to pick.
					</p>
					<p>
						Fields update when you change the category above.
					</p>
				</InfoTip>
			</legend>

			{#if !data.conn.app}
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					Connect eBay (set <code>EBAY_CLIENT_ID</code> + <code>EBAY_CLIENT_SECRET</code>)
					to load item specifics for the chosen category.
				</p>
			{:else if aspectsLoading}
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					Loading specifics for category {categoryId}…
				</p>
			{:else if aspectError}
				<p class="text-[11px] text-[color:var(--color-rust-bright)]">{aspectError}</p>
			{:else if aspectMappings.length === 0}
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					{categoryId
						? 'No item specifics returned for this category.'
						: 'Pick a category above to load its required item specifics.'}
				</p>
			{:else}
				<div
					class="rounded border border-[color:var(--color-gold-dim)] bg-[color:var(--color-input)] px-3 py-2 text-[11px]"
				>
					<p class="text-[color:var(--color-gold-bright)]">
						✨ Auto-filled {autoFilledCount} of {aspectMappings.length} from this item's
						attributes.
						{#if missingRequired.length > 0}
							<span class="text-[color:var(--color-rust-bright)]">
								{missingRequired.length} required still need a value.
							</span>
						{:else}
							<span class="text-[color:var(--color-moss-bright)]">
								All required specifics are filled. ✓
							</span>
						{/if}
					</p>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					{#each sortedAspects as m (m.aspect.name)}
						{@const filled = (aspectValues[m.aspect.name] ?? '').trim().length > 0}
						<div class="space-y-1">
							<label
								for="aspect-{m.aspect.name}"
								class="eyebrow block text-[10px]"
							>
								{m.aspect.name}
								{#if m.aspect.required}
									<span
										class="ml-0.5"
										class:text-[color:var(--color-rust-bright)]={!filled}
										class:text-[color:var(--color-moss-bright)]={filled}
										title="Required by eBay">*</span
									>
								{/if}
								{#if m.matchedAttributeLabel}
									<span
										class="ml-1 font-normal lowercase text-[color:var(--color-ink-4)]"
										title="Auto-filled from this item's {m.matchedAttributeLabel} attribute"
									>
										· from {m.matchedAttributeLabel}
									</span>
								{/if}
							</label>

							{#if m.aspect.mode === 'SELECTION_ONLY' && m.aspect.allowedValues.length > 0}
								<!-- Constrained aspect: dropdown of eBay's allowed
									 values. If our auto-mapped value isn't in the
									 list, it's prepended as a flagged option so the
									 user sees what we guessed. -->
								<select
									id="aspect-{m.aspect.name}"
									name="aspect:{m.aspect.name}"
									bind:value={aspectValues[m.aspect.name]}
									class="field py-1 text-xs"
									style:border-color={m.aspect.required && !filled
										? 'var(--color-rust)'
										: undefined}
								>
									<option value="">— pick —</option>
									{#if (aspectValues[m.aspect.name] ?? '') && !m.aspect.allowedValues.some((v) => v === aspectValues[m.aspect.name])}
										<option value={aspectValues[m.aspect.name]}>
											{aspectValues[m.aspect.name]} (our guess — not in eBay's list)
										</option>
									{/if}
									{#each m.aspect.allowedValues as v (v)}
										<option value={v}>{v}</option>
									{/each}
								</select>
							{:else}
								<!-- FREE_TEXT aspect: plain input. -->
								<input
									id="aspect-{m.aspect.name}"
									name="aspect:{m.aspect.name}"
									type="text"
									bind:value={aspectValues[m.aspect.name]}
									class="field py-1 text-xs"
									style:border-color={m.aspect.required && !filled
										? 'var(--color-rust)'
										: undefined}
									placeholder={m.aspect.required ? 'required' : 'optional'}
								/>
							{/if}
						</div>
					{/each}
				</div>

				{#if missingRequired.length > 0}
					<p class="text-[11px] text-[color:var(--color-rust-bright)]">
						⚠ Fill these required specifics before publishing:
						{missingRequired.join(', ')}
					</p>
				{/if}
			{/if}
		</fieldset>

		<!-- Identifiers -->
		<fieldset class="grid gap-3 rounded border border-[color:var(--color-line-dim)] p-4 sm:grid-cols-3">
			<legend class="eyebrow px-2 inline-flex items-center gap-0.5">
				Identifiers
				<InfoTip title="Brand / MPN / UPC">
					<p>
						eBay requires a <strong>Brand + MPN</strong> pair to publish in most
						categories. Fill them in when you can — it helps eBay match your
						listing to its catalog.
					</p>
					<p>
						For custom builds or used gear with no manufacturer part number, just
						leave MPN blank: we automatically send <code>Does Not Apply</code> (and
						<code>Unbranded</code> if there's no brand), which is eBay's accepted
						convention. So a blank MPN no longer blocks publishing.
					</p>
				</InfoTip>
			</legend>
			<div class="space-y-1.5">
				<label for="ebay_brand" class="eyebrow block">Brand</label>
				<input
					id="ebay_brand"
					name="ebay_brand"
					type="text"
					value={initial.brand}
					placeholder="e.g. Ivy, Leo Jaymz"
					class="field"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="ebay_mpn" class="eyebrow block">MPN</label>
				<input
					id="ebay_mpn"
					name="ebay_mpn"
					type="text"
					value={initial.mpn}
					placeholder="Manufacturer part #"
					class="field font-mono"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="ebay_upc" class="eyebrow block">UPC</label>
				<input
					id="ebay_upc"
					name="ebay_upc"
					type="text"
					value={initial.upc}
					placeholder="12-digit barcode"
					class="field font-mono"
				/>
			</div>
		</fieldset>

		<!-- Seller policies -->
		<fieldset class="grid gap-3 rounded border border-[color:var(--color-line-dim)] p-4 sm:grid-cols-3">
			<legend class="eyebrow px-2 inline-flex items-center gap-0.5">
				Seller policies
				<InfoTip>
					<p>
						Every eBay offer references three policies set up in Seller Hub:
						<strong>fulfillment</strong> (shipping options),
						<strong>payment</strong> (allowed payment methods), and
						<strong>return</strong> (return window + restock rules).
					</p>
					<p>
						If the dropdowns are empty, the user token isn't yet able to read
						policies — make sure the refresh token includes the
						<code>sell.account.readonly</code> scope.
					</p>
				</InfoTip>
			</legend>
			<div class="space-y-1.5">
				<label for="ebay_fulfillment_policy_id" class="eyebrow block">Fulfillment</label>
				<select
					id="ebay_fulfillment_policy_id"
					name="ebay_fulfillment_policy_id"
					value={initial.fulfillmentPolicyId}
					class="field text-xs"
				>
					<option value="">— pick one —</option>
					{#each data.fulfillmentPolicies as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-1.5">
				<label for="ebay_payment_policy_id" class="eyebrow block">Payment</label>
				<select
					id="ebay_payment_policy_id"
					name="ebay_payment_policy_id"
					value={initial.paymentPolicyId}
					class="field text-xs"
				>
					<option value="">— pick one —</option>
					{#each data.paymentPolicies as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-1.5">
				<label for="ebay_return_policy_id" class="eyebrow block">Return</label>
				<select
					id="ebay_return_policy_id"
					name="ebay_return_policy_id"
					value={initial.returnPolicyId}
					class="field text-xs"
				>
					<option value="">— pick one —</option>
					{#each data.returnPolicies as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</div>
		</fieldset>

		<div class="flex flex-wrap gap-2 border-t border-[color:var(--color-line-dim)] pt-5">
			<button
				type="submit"
				formaction="?/save"
				name="target_status"
				value="draft"
				class="btn-ghost"
			>
				Save as draft
			</button>
			<button
				type="submit"
				formaction="?/save"
				name="target_status"
				value="ready"
				class="btn-ghost"
			>
				Save as ready
			</button>
			<!--
				Unpublished-offer push removed: an unpublished Inventory-API
				offer doesn't surface in Seller Hub anywhere, so it was a
				dead end. eBay listings publish straight to live (reversible
				via End listing). Dad's happy with that.
			-->
			<button
				type="submit"
				formaction="?/push"
				name="target_status"
				value="live"
				class="btn-primary ml-auto"
				disabled={pushDisabled || missingRequired.length > 0}
				title={pushDisabled
					? 'eBay not fully configured — see notice above'
					: missingRequired.length > 0
						? `Fill required item specifics first: ${missingRequired.join(', ')}`
						: ''}
			>
				{data.listing?.external_id ? 'Update & publish on eBay' : 'Publish to eBay'}
			</button>
		</div>
		{#if missingRequired.length > 0 && !pushDisabled}
			<p class="text-[11px] italic text-[color:var(--color-rust-bright)]">
				Push is blocked until the {missingRequired.length} required item specific{missingRequired.length ===
				1
					? ''
					: 's'} above {missingRequired.length === 1 ? 'is' : 'are'} filled.
			</p>
		{/if}
	</form>

	<!-- Sync state -->
	{#if data.listing}
		<div class="panel space-y-2 px-4 py-3">
			<p class="eyebrow">eBay state</p>
			<dl class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Status</dt>
					<dd class="font-mono">{data.listing.status}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Offer ID</dt>
					<dd class="font-mono truncate">{data.listing.external_id ?? '—'}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Listing ID</dt>
					<dd class="font-mono truncate">{data.listing.external_variant_id ?? '—'}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Last synced</dt>
					<dd class="font-mono">{data.listing.last_synced_at ?? '—'}</dd>
				</div>
			</dl>
		</div>
	{/if}
</section>
