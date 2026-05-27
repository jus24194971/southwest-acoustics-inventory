<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import type { PageData, ActionData } from './$types';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Pull the platform_extras_json blob (Reverb-specific fields) into
	// a typed shape for the form prefills.
	interface ReverbExtras {
		reverb_make?: string | null;
		reverb_model?: string | null;
		reverb_year?: string | null;
		reverb_finish?: string | null;
		reverb_category_uuid?: string | null;
		reverb_condition_uuid?: string | null;
		reverb_shipping_amount?: string | null;
		reverb_free_shipping?: boolean | null;
		reverb_upc?: string | null;
		reverb_upc_does_not_apply?: boolean | null;
	}

	function parseExtras(json: string | null | undefined): ReverbExtras {
		if (!json) return {};
		try {
			return JSON.parse(json) as ReverbExtras;
		} catch {
			return {};
		}
	}

	const savedJustNow = $derived(page.url.searchParams.get('saved') === '1');
	const pushedJustNow = $derived(page.url.searchParams.get('pushed') === '1');
	const unlinkedJustNow = $derived(page.url.searchParams.get('unlinked') === '1');

	// Initial values: prefer the existing Reverb listing if any; else
	// pull from the SS listing (Dad typically pushes SS first); else
	// derive from the item.
	const initial = untrack(() => {
		const extras = parseExtras(data.reverbListing?.platform_extras_json);
		const reverbTitle = data.reverbListing?.listing_title;
		const ssTitle = data.ssListing?.listing_title;
		const reverbDesc = data.reverbListing?.listing_description_html;
		const ssDesc = data.ssListing?.listing_description_html;
		const reverbPriceCents = data.reverbListing?.listing_price_cents;
		const ssPriceCents = data.ssListing?.listing_price_cents;

		return {
			title: reverbTitle ?? ssTitle ?? data.item.title,
			description: reverbDesc ?? ssDesc ?? data.item.description_html ?? '',
			// Price prefill priority:
			//   1. Existing Reverb listing override (Dad set it before)
			//   2. Fee-grossed-up base price so the seller nets the
			//      inventory base after Reverb fees
			//   3. Item base price as-is (fallback when fees can't be
			//      computed)
			//   4. Blank
			price:
				reverbPriceCents != null
					? (reverbPriceCents / 100).toFixed(2)
					: data.suggestedPriceCents != null
						? (data.suggestedPriceCents / 100).toFixed(2)
						: ssPriceCents != null
							? (ssPriceCents / 100).toFixed(2)
							: data.item.price_cents != null
								? (data.item.price_cents / 100).toFixed(2)
								: '',
			make: extras.reverb_make ?? data.item.brand_name ?? '',
			model: extras.reverb_model ?? data.item.model ?? '',
			year: extras.reverb_year ?? String(data.item.year_received),
			// Finish auto-fills from the item's "body finish" / "color"
			// attribute slot resolved server-side. Dad can still override
			// per listing, but the default is usually right.
			finish: extras.reverb_finish ?? data.resolvedFinish ?? '',
			categoryUuid: extras.reverb_category_uuid ?? '',
			conditionUuid: extras.reverb_condition_uuid ?? '',
			shippingAmount: extras.reverb_shipping_amount ?? '',
			freeShipping: extras.reverb_free_shipping ?? false,
			publish: data.reverbListing ? data.reverbListing.listing_visible === 1 : false,
			upc: extras.reverb_upc ?? '',
			// Default ON when no extras saved yet — Dad's catalog is mostly
			// custom builds and one-off / used items that don't carry
			// manufacturer UPCs. Easy to uncheck when needed.
			upcDoesNotApply:
				extras.reverb_upc_does_not_apply !== undefined && extras.reverb_upc_does_not_apply !== null
					? !!extras.reverb_upc_does_not_apply
					: true
		};
	});

	let listingTitle = $state(initial.title);
	let freeShipping = $state(initial.freeShipping);
	let publish = $state(initial.publish);
	let categoryUuid = $state(initial.categoryUuid);
	let conditionUuid = $state(initial.conditionUuid);
	let upcDoesNotApply = $state(initial.upcDoesNotApply);

	// Title char count — same thresholds as the SS editor since Reverb
	// title display also truncates around 80 chars on listing cards.
	const TITLE_GOOD_MAX = 80;
	const TITLE_WARN_MAX = 120;
	let titleLength = $derived(listingTitle.length);
	let titleCounterColor = $derived(
		titleLength <= TITLE_GOOD_MAX
			? 'var(--color-moss-bright)'
			: titleLength <= TITLE_WARN_MAX
				? 'var(--color-gold-bright)'
				: 'var(--color-rust-bright)'
	);

	// Category search — ~700 entries is fine in a <select>, but a
	// search box on top lets Dad type to narrow without scrolling.
	let categorySearch = $state('');
	const filteredCategories = $derived(
		categorySearch.trim()
			? data.categories.filter((c) =>
					(c.full_path ?? c.name).toLowerCase().includes(categorySearch.toLowerCase())
				)
			: data.categories
	);

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
		live: 'Live on Reverb',
		paused: 'Paused',
		error: 'Last push errored'
	};
	let status = $derived(data.reverbListing?.status ?? 'draft');
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
		<h1 class="headline text-3xl">Reverb listing</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Push this item to Reverb. Photos come from the Squarespace product
			{#if data.hasSquarespacePhotos}
				(already pushed — Reverb will fetch the SS CDN URLs)
			{:else}
				— <strong class="text-[color:var(--color-gold-bright)]">push to Squarespace first</strong>
				so the photos are publicly hostable
			{/if}.
		</p>
	</header>

	{#if savedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">Saved locally. No push happened.</p>
		</div>
	{:else if unlinkedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-gold-dim)">
			<p class="text-sm text-[color:var(--color-gold-bright)]">
				Unlinked from Reverb. The listing on Reverb's side wasn't touched — the next Push will
				create a fresh one.
			</p>
		</div>
	{:else if pushedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				Pushed to Reverb successfully.
				{#if page.url.searchParams.get('photos')}
					{page.url.searchParams.get('photos')} photo URL(s) sent.
				{/if}
			</p>
			{#if data.reverbListing?.external_url}
				<p class="mt-1 text-xs">
					<a
						href={data.reverbListing.external_url}
						target="_blank"
						rel="noopener"
						class="text-[color:var(--color-gold-bright)] underline"
					>
						Open on Reverb ↗
					</a>
				</p>
			{/if}
			{#if data.reverbListing?.external_id}
				<p class="mt-1 font-mono text-xs text-[color:var(--color-ink-3)]">
					reverb id: {data.reverbListing.external_id}
				</p>
			{/if}
		</div>
	{/if}

	{#if form?.pushError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.pushError}</p>
		</div>
	{/if}

	{#if data.reverbListing?.last_sync_error && !pushedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">
				Last sync: {data.reverbListing.last_sync_error}
			</p>
		</div>
	{/if}

	{#if !data.hasApiKey}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">
				REVERB_API_KEY isn't configured. Set it via
				<span class="font-mono">wrangler pages secret put REVERB_API_KEY</span>
				and redeploy.
			</p>
		</div>
	{:else if data.taxonomyError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">
				Couldn't load Reverb taxonomy: {data.taxonomyError}
			</p>
			<p class="mt-1 text-[11px] italic text-[color:var(--color-ink-3)]">
				Try reloading. If it persists, the API key may not have the right scopes for
				/categories/flat or /listing_conditions.
			</p>
		</div>
	{/if}

	<!-- Context card -->
	<div class="panel space-y-2 px-4 py-3">
		<p class="eyebrow">Item being listed</p>
		<p class="text-sm">
			<span class="font-medium text-[color:var(--color-ink)]">{data.item.title}</span>
		</p>
		<p class="text-[11px] text-[color:var(--color-ink-3)]">
			Category: <span class="font-mono">{data.item.cat_code} · {data.item.cat_name}</span>
			· Tracking: <span class="font-mono">{data.item.tracking_mode}</span>
			· On hand: <span class="font-mono">{data.item.stock_qty}</span>
			· Internal price:
			<span class="font-mono"
				>{data.item.price_cents != null
					? `$${(data.item.price_cents / 100).toFixed(2)}`
					: '—'}</span
			>
		</p>
		{#if data.ssListing?.external_id}
			<p class="text-[11px] text-[color:var(--color-moss-bright)]">
				✓ Squarespace listing exists. Title, description, price, and photo URLs prefill from
				there.
			</p>
		{:else}
			<p class="text-[11px] text-[color:var(--color-gold-bright)]">
				⚠ No Squarespace listing yet. Reverb won't have photos. Push to Squarespace first for
				a complete listing.
			</p>
		{/if}
	</div>

	<!-- ============= Listing form ============= -->
	<form method="POST" class="panel space-y-5 px-6 py-6">
		<div class="space-y-1.5">
			<div class="flex items-baseline justify-between gap-3">
				<label for="listing_title" class="eyebrow block">Listing title</label>
				<span class="font-mono text-[10px]" style:color={titleCounterColor}>
					{titleLength} chars
					{#if titleLength > TITLE_WARN_MAX}· too long{:else if titleLength > TITLE_GOOD_MAX}· long{/if}
				</span>
			</div>
			<input
				id="listing_title"
				name="listing_title"
				type="text"
				bind:value={listingTitle}
				class="field"
				placeholder={data.item.title}
			/>
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				Pulled from Squarespace if it's been pushed. Reverb cards truncate around 80 chars.
			</p>
		</div>

		<div class="space-y-1.5">
			<span class="eyebrow">Listing description</span>
			<RichTextEditor
				name="listing_description_html"
				initialHtml={initial.description}
				placeholder="Customer-facing description. Same content as the Squarespace listing usually works…"
			/>
		</div>

		<!-- Make / Model / Year / Finish — Reverb requires these -->
		<fieldset class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
			<legend class="eyebrow px-2">Required by Reverb</legend>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="space-y-1.5">
					<label for="reverb_make" class="eyebrow block">Make</label>
					<input
						id="reverb_make"
						name="reverb_make"
						type="text"
						value={initial.make}
						required
						placeholder="Leo Jaymz"
						class="field"
					/>
				</div>
				<div class="space-y-1.5">
					<label for="reverb_model" class="eyebrow block">Model</label>
					<input
						id="reverb_model"
						name="reverb_model"
						type="text"
						value={initial.model}
						required
						placeholder="IJZ-300"
						class="field"
					/>
				</div>
				<div class="space-y-1.5">
					<label for="reverb_year" class="eyebrow block">Year</label>
					<input
						id="reverb_year"
						name="reverb_year"
						type="text"
						value={initial.year}
						placeholder="2024 — or fuzzy like '1960s'"
						class="field"
					/>
				</div>
				<div class="space-y-1.5">
					<label for="reverb_finish" class="eyebrow block">Finish</label>
					<input
						id="reverb_finish"
						name="reverb_finish"
						type="text"
						value={initial.finish}
						placeholder="Sunburst, Gloss Black, …"
						class="field"
					/>
				</div>
			</div>
		</fieldset>

		<!-- UPC / EAN — Reverb requires either a value OR
		     upc_does_not_apply=true for Brand New items. Most of Dad's
		     catalog (custom builds, used / refurb, vintage) doesn't
		     have UPCs, so the checkbox defaults to ON. -->
		<fieldset class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
			<legend class="eyebrow px-2">UPC / EAN</legend>

			<label class="flex items-start gap-3">
				<input
					type="checkbox"
					name="reverb_upc_does_not_apply"
					bind:checked={upcDoesNotApply}
					class="mt-0.5 h-4 w-4 accent-[color:var(--color-gold)]"
					style="min-height: auto"
				/>
				<div class="space-y-0.5">
					<span class="text-sm font-medium text-[color:var(--color-ink)]">UPC does not apply</span>
					<p class="text-[11px] text-[color:var(--color-ink-3)]">
						Default ON. Custom builds, used / refurb, and vintage items don't carry
						manufacturer UPCs. Reverb requires either this or a real UPC for Brand New
						items — leave checked unless this specific product has one printed on it.
					</p>
				</div>
			</label>

			<div class="space-y-1.5" class:opacity-50={upcDoesNotApply}>
				<label for="reverb_upc" class="eyebrow block">
					UPC / EAN
					{#if upcDoesNotApply}
						<span class="lowercase text-[color:var(--color-ink-4)]">— disabled while "does not apply" is checked</span>
					{/if}
				</label>
				<input
					id="reverb_upc"
					name="reverb_upc"
					type="text"
					value={initial.upc}
					placeholder="e.g. 885978110803"
					class="field font-mono"
					disabled={upcDoesNotApply}
				/>
			</div>
		</fieldset>

		<!-- Category picker -->
		<div class="space-y-1.5">
			<label for="reverb_category_uuid" class="eyebrow block">Reverb category</label>
			<input
				type="text"
				bind:value={categorySearch}
				placeholder="Search categories — e.g. 'semi-hollow', 'tele'…"
				class="field py-1.5 text-sm"
			/>
			<select
				id="reverb_category_uuid"
				name="reverb_category_uuid"
				required
				bind:value={categoryUuid}
				class="field"
				size="6"
			>
				{#each filteredCategories.slice(0, 200) as cat (cat.uuid)}
					<option value={cat.uuid}>
						{cat.full_path ?? cat.name}
					</option>
				{/each}
			</select>
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				{data.categories.length} total. Showing {Math.min(filteredCategories.length, 200)} matching.
				Reverb categories are strict — pick the most specific one that fits.
			</p>
		</div>

		<!-- Condition picker -->
		<div class="space-y-1.5">
			<label for="reverb_condition_uuid" class="eyebrow block">Reverb condition</label>
			<select
				id="reverb_condition_uuid"
				name="reverb_condition_uuid"
				required
				bind:value={conditionUuid}
				class="field"
			>
				<option value="">— pick a condition —</option>
				{#each data.conditions as cond (cond.uuid)}
					<option value={cond.uuid}>{cond.display_name}</option>
				{/each}
			</select>
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				Item condition is
				<span class="font-mono">{data.item.condition}</span>
				internally — but Reverb's options are more granular.
			</p>
		</div>

		<!-- Price -->
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="listing_price" class="eyebrow block">Listing price ($)</label>
				<input
					id="listing_price"
					name="listing_price"
					type="number"
					step="0.01"
					min="0"
					value={initial.price}
					placeholder="inherits item price"
					class="field"
				/>
				<!-- Fee gross-up explainer: shows the base price, the
				     auto-calculated listing price, and the breakdown
				     so Dad can see WHY the suggested price is higher
				     than the inventory base. He can still override. -->
				{#if data.item.price_cents != null && data.suggestedPriceCents != null}
					<div
						class="rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] px-2.5 py-1.5 text-[11px] leading-snug"
					>
						<p class="text-[color:var(--color-ink-2)]">
							Inventory base:
							<span class="font-mono text-[color:var(--color-ink)]"
								>${(data.item.price_cents / 100).toFixed(2)}</span
							>
							→ Suggested listing:
							<span class="font-mono text-[color:var(--color-gold-bright)]"
								>${(data.suggestedPriceCents / 100).toFixed(2)}</span
							>
						</p>
						<p class="mt-0.5 text-[color:var(--color-ink-3)]">
							Adds {(data.feeBreakdown.percent * 100).toFixed(2)}% + ${data.feeBreakdown.fixed.toFixed(2)}
							so Dad nets the inventory base after Reverb's cut.
							<a
								href={'https://reverb.com/selling/selling-fees'}
								target="_blank"
								rel="noopener"
								class="text-[color:var(--color-gold-bright)] hover:underline"
								>Reverb fees ↗</a
							>
						</p>
					</div>
				{:else}
					<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
						Sent to Reverb as the asking price. Leave blank to use the item's internal price.
					</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<label for="reverb_shipping_amount" class="eyebrow block">Flat-rate shipping ($)</label>
				<input
					id="reverb_shipping_amount"
					name="reverb_shipping_amount"
					type="number"
					step="0.01"
					min="0"
					value={initial.shippingAmount}
					placeholder="e.g. 25.00"
					class="field"
					disabled={freeShipping}
				/>
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					Flat rate to continental US. Disable when "Free shipping" is checked.
				</p>
			</div>
		</div>

		<!-- Shipping + publish toggles -->
		<div class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
			<label class="flex items-start gap-3">
				<input
					type="checkbox"
					name="reverb_free_shipping"
					bind:checked={freeShipping}
					class="mt-0.5 h-4 w-4 accent-[color:var(--color-gold)]"
					style="min-height: auto"
				/>
				<div class="space-y-0.5">
					<span class="text-sm font-medium text-[color:var(--color-ink)]">Free shipping</span>
					<p class="text-[11px] text-[color:var(--color-ink-3)]">
						Sets the shipping rate to $0.00 to the continental US.
					</p>
				</div>
			</label>

			<label class="flex items-start gap-3">
				<input
					type="checkbox"
					name="reverb_publish"
					bind:checked={publish}
					class="mt-0.5 h-4 w-4 accent-[color:var(--color-gold)]"
					style="min-height: auto"
				/>
				<div class="space-y-0.5">
					<span class="text-sm font-medium text-[color:var(--color-ink)]"
						>Publish immediately</span
					>
					<p class="text-[11px] text-[color:var(--color-ink-3)]">
						When checked, Reverb makes the listing live on push. Otherwise it lands as a draft
						in Dad's Reverb seller dashboard for review.
					</p>
				</div>
			</label>
		</div>

		<div class="flex flex-wrap gap-2 border-t border-[color:var(--color-line-dim)] pt-5">
			<button type="submit" formaction="?/save" name="target_status" value="draft" class="btn-ghost">
				Save as draft
			</button>
			<button type="submit" formaction="?/save" name="target_status" value="ready" class="btn-ghost">
				Save as ready
			</button>
			<button
				type="submit"
				formaction="?/push"
				class="btn-primary ml-auto"
				disabled={!data.hasApiKey}
			>
				{data.reverbListing?.external_id ? 'Push update to Reverb' : 'Push to Reverb'}
			</button>
		</div>
	</form>

	<!-- Unlink panel -->
	{#if data.reverbListing?.external_id}
		<form
			method="POST"
			action="?/unlinkFromReverb"
			class="panel space-y-3 px-6 py-4"
			onsubmit={(e) => {
				if (
					!confirm(
						'Forget the Reverb listing link for this item. The listing on ' +
							"Reverb's side is NOT touched. Next Push will create a fresh one. Continue?"
					)
				) {
					e.preventDefault();
				}
			}}
		>
			<div class="flex items-baseline justify-between gap-3">
				<div>
					<p class="eyebrow" style="color: var(--color-rust-bright)">Unlink from Reverb</p>
					<p class="mt-1 text-[11px] italic text-[color:var(--color-ink-3)]">
						Clears the local link (id <span class="font-mono">{data.reverbListing.external_id}</span>)
						without touching the Reverb side. Use after deleting on Reverb, or to relink.
					</p>
				</div>
				<button
					type="submit"
					class="btn-ghost px-4 py-2 text-sm"
					style="color: var(--color-rust-bright)"
				>
					Unlink
				</button>
			</div>
		</form>
	{/if}

	<!-- Sync state -->
	{#if data.reverbListing}
		<div class="panel space-y-2 px-4 py-3">
			<p class="eyebrow">Reverb sync state</p>
			<dl class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Status</dt>
					<dd class="font-mono">{data.reverbListing.status}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">External ID</dt>
					<dd class="font-mono truncate">{data.reverbListing.external_id ?? '—'}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Last synced</dt>
					<dd class="font-mono">{data.reverbListing.last_synced_at ?? '—'}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Last sync status</dt>
					<dd class="font-mono">{data.reverbListing.last_sync_status ?? '—'}</dd>
				</div>
			</dl>
		</div>
	{/if}
</section>
