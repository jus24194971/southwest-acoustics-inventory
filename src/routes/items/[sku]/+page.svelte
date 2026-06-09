<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import type { PageData, ActionData } from './$types';
	import AttributeValueSelect from '$lib/components/AttributeValueSelect.svelte';
	import InfoTip from '$lib/components/InfoTip.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Local UI state for the inline editors. Each section toggles into
	// edit mode in place rather than opening a modal — fewer clicks,
	// less spatial dislocation for Dad.
	let editingDetails = $state(false);
	let showingTransfer = $state(false);
	let showingRetire = $state(false);

	// Per-item label print: which printer / label size to use. Defaults to
	// the template flagged default in the DB (falls back to the DYMO).
	let labelTemplate = $state(
		data.templates.find((t) => t.is_default)?.code ??
			data.templates[0]?.code ??
			'LW_DURABLE_19x64'
	);

	// After a clone we redirect to the new item with ?cloned=1 — open the
	// edit form so Dad can change the variation (colour, style, qty…) right
	// away. afterNavigate, not a $state initializer, because this route
	// reuses its component instance across item→item navigations.
	afterNavigate(() => {
		if (page.url.searchParams.get('cloned') === '1') editingDetails = true;
	});

	const CONDITION_LABEL: Record<string, string> = {
		N: 'New',
		U: 'Used',
		R: 'Refurbished',
		B: 'For parts'
	};
	const CONDITION_PILL: Record<string, string> = {
		N: 'pill-success',
		U: 'pill',
		R: 'pill-warn',
		B: 'pill-danger'
	};
	const KIND_LABEL: Record<string, string> = {
		receive: 'Received',
		transfer: 'Transfer',
		sale: 'Sold',
		scrap: 'Scrapped',
		adjust: 'Adjusted',
		build_consume: 'Used in build',
		build_produce: 'Built'
	};
	const KIND_PILL: Record<string, string> = {
		receive: 'pill-success',
		transfer: 'pill',
		sale: 'pill-warn',
		scrap: 'pill-danger',
		adjust: 'pill',
		build_consume: 'pill-warn',
		build_produce: 'pill-success'
	};

	function formatPrice(cents: number | null): string {
		if (cents == null) return '—';
		return `$${(cents / 100).toFixed(2)}`;
	}

	function shortWhen(iso: string): string {
		const t = new Date(iso.replace(' ', 'T') + 'Z');
		const diffMin = Math.round((Date.now() - t.getTime()) / 60000);
		if (diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.round(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		const diffDay = Math.round(diffHr / 24);
		if (diffDay < 30) return `${diffDay}d ago`;
		return t.toLocaleDateString();
	}

	function locBin(loc: string | null, bin: string | null): string {
		if (!loc || !bin) return '—';
		return `${loc}/${bin}`;
	}

	let primaryPhoto = $derived(data.photos[0]);
	let extraPhotos = $derived(data.photos.slice(1));
	// Active thumbnail index. Initialized from the URL's photo_active
	// param when present (set by the reorder action so the just-moved
	// photo stays highlighted) and bounded to the actual photo count.
	let activePhotoIndex = $state(
		untrack(() => {
			const raw = page.url.searchParams.get('photo_active');
			const idx = raw ? parseInt(raw, 10) : 0;
			if (!Number.isInteger(idx) || idx < 0) return 0;
			return Math.min(idx, Math.max(0, data.photos.length - 1));
		})
	);
	let activePhoto = $derived(data.photos[activePhotoIndex] ?? null);

	// Five-slot attribute display. Each slot is rendered only if the item's
	// category defines a label for it. The contextKey tells the dropdown
	// component which subset of attribute_values to show.
	let attrSlots = $derived(
		[1, 2, 3, 4, 5].map((n) => {
			const label = data.item[`cat_attr_${n}_label` as keyof typeof data.item] as
				| string
				| null;
			const contextKey = data.item[
				`cat_attr_${n}_context_key` as keyof typeof data.item
			] as string | null;
			const value = data.item[`attr_${n}` as keyof typeof data.item] as string;
			const uniqueDesc = data.item[`attr_${n}_unique_desc` as keyof typeof data.item] as
				| string
				| null;
			const values = contextKey
				? data.attrValues
						.filter((v) => v.context_key === contextKey)
						.map((v) => ({ id: v.id, code: v.code, label: v.label }))
				: [];
			// Look up the friendly label for the current code (for display mode).
			const valueLabel =
				value !== 'XXX' && value !== 'UNQ'
					? values.find((v) => v.code === value)?.label
					: null;
			return { n, label, contextKey, value, valueLabel, uniqueDesc, values };
		})
	);

	// While editing, mirror form state locally so the UNQ-description
	// textarea can appear conditionally per slot. `untrack` so Svelte 5
	// doesn't warn that we're capturing data's initial value — that IS
	// the intent; the form resets on navigation because the whole page
	// remounts with new data.
	let editAttrValues = $state<string[]>(
		untrack(() => [
			data.item.attr_1,
			data.item.attr_2,
			data.item.attr_3,
			data.item.attr_4,
			data.item.attr_5
		])
	);
	let editTrackingMode = $state<'serialized' | 'stocked'>(
		untrack(() => data.item.tracking_mode)
	);
	let editStockQty = $state(untrack(() => data.item.stock_qty));

	// Adjust-quantity UI state. Sidebar panel for stocked items —
	// collapsed by default, opens with current qty pre-filled so Dad
	// just types over it.
	let showingAdjust = $state(false);
	let adjustNewQty = $state(0);
	$effect(() => {
		// Re-sync when the page data changes (after a successful adjust
		// redirect, stock_qty has moved).
		adjustNewQty = data.item.stock_qty;
	});

	// Split-off variant UI state. Only relevant when this item is
	// stocked + has qty > 0. Opens an inline form below the On hand
	// panel rather than a modal so the surrounding context stays
	// visible.
	let showingSplitOff = $state(false);

	// Recategorize: while the edit form is open the user can pick a
	// different category. The form-local categoryId drives the
	// attribute slots' labels/contexts (independently from the saved
	// item's category). If the user changes category, the SKU
	// regenerates on submit unless they tick "Keep current SKU".
	let editCategoryId = $state(untrack(() => data.item.category_id));
	let keepSku = $state(false);

	let editActiveCategory = $derived(
		data.categories.find((c) => c.id === editCategoryId) ?? null
	);
	let editAttrSlots = $derived(
		[1, 2, 3, 4, 5].map((n) => {
			const cat = editActiveCategory;
			const label = cat
				? (cat[`attr_${n}_label` as keyof typeof cat] as string | null)
				: null;
			const contextKey = cat
				? (cat[`attr_${n}_context_key` as keyof typeof cat] as string | null)
				: null;
			const values = contextKey
				? data.attrValues
						.filter((v) => v.context_key === contextKey)
						.map((v) => ({ id: v.id, code: v.code, label: v.label }))
				: [];
			return { n, label, contextKey, values };
		})
	);
	let categoryWillChange = $derived(editCategoryId !== data.item.category_id);

	function isUnq(value: string): boolean {
		return value.trim().toUpperCase() === 'UNQ';
	}

	// Currently-active Squarespace listing for the sidebar pill /
	// "Open on Squarespace" link. Derived rather than recomputed in
	// the template so we can use it from anywhere.
	let ssListing = $derived(data.listings.find((l) => l.platform === 'squarespace') ?? null);
	let reverbListing = $derived(data.listings.find((l) => l.platform === 'reverb') ?? null);
	let ebayListing = $derived(data.listings.find((l) => l.platform === 'ebay') ?? null);
	// Any marketplace the item is linked to → there's a photo source to pull from.
	let hasPhotoSource = $derived(data.listings.some((l) => Boolean(l.external_id || l.external_url)));

	// Post-action status banner, driven by the redirect query params the
	// item server actions set (qty adjust, retire, sellable toggle). Each
	// can carry an `ss_sync` result describing what happened on Squarespace
	// so Dad gets immediate, plain-English feedback that the live store
	// was (or wasn't) updated.
	let actionBanner = $derived.by((): { tone: 'good' | 'warn' | 'neutral'; text: string } | null => {
		const sp = page.url.searchParams;
		const ss = sp.get('ss_sync');
		const msg = sp.get('ss_msg');
		if (sp.get('cloned')) {
			const from = sp.get('from');
			const pn = sp.get('photo_note');
			return {
				tone: 'good',
				text:
					`Cloned${from ? ` from ${from}` : ''} — this is a brand-new item. ` +
					`Change the attributes that differ (colour, style, title, quantity) below and Save; ` +
					`the SKU updates to match automatically.` +
					(pn ? ` (Copied ${pn} photos — add or pull the rest if you need them.)` : '')
			};
		}
		if (sp.get('adjusted')) {
			if (ss === 'ok')
				return { tone: 'good', text: 'Quantity updated — new stock synced to Squarespace.' };
			if (ss === 'err')
				return {
					tone: 'warn',
					text: `Quantity updated, but the Squarespace sync failed: ${msg ?? 'unknown error'}. You can re-push from the Squarespace editor.`
				};
			return { tone: 'good', text: 'Quantity updated.' };
		}
		if (sp.get('retired')) {
			if (ss === 'deleted')
				return { tone: 'good', text: 'Item retired and its Squarespace listing was deleted.' };
			if (ss === 'err')
				return {
					tone: 'warn',
					text: `Item retired, but deleting the Squarespace listing failed: ${msg ?? 'unknown error'}. Remove it manually in Squarespace.`
				};
			return { tone: 'good', text: 'Item retired.' };
		}
		if (sp.get('sellable') === 'on') {
			if (ss === 'ok')
				return {
					tone: 'good',
					text: 'Marked sellable — current details pushed to Squarespace. Edits (title, price, SKU), quantity, and retire changes now sync automatically.'
				};
			if (ss === 'err')
				return {
					tone: 'warn',
					text: `Marked sellable, but the initial Squarespace sync failed: ${msg ?? 'unknown error'}.`
				};
			return {
				tone: 'good',
				text: 'Marked sellable — once it’s listed on Squarespace, quantity and retire changes will sync automatically.'
			};
		}
		if (sp.get('sellable') === 'off') {
			return {
				tone: 'neutral',
				text: 'No longer sellable — automatic Squarespace sync is off. The existing listing was left untouched.'
			};
		}
		if (sp.get('edited')) {
			if (ss === 'ok')
				return {
					tone: 'good',
					text: 'Saved — your changes (title, price, SKU and stock) were pushed live to Squarespace.'
				};
			if (ss === 'err')
				return {
					tone: 'warn',
					text: `Saved, but pushing the changes to Squarespace failed: ${msg ?? 'unknown error'}. You can re-push from the Squarespace editor.`
				};
			return null; // plain edit with no SS-worthy change (or not sellable/listed)
		}
		return null;
	});
</script>

<section class="space-y-6">
	<!-- ============= Header / crumb ============= -->
	<header class="space-y-2">
		<a
			href="/items"
			class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
		>
			← All items
		</a>
		<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
			<p class="font-mono text-sm text-[color:var(--color-gold)]">
				{data.item.sku}
				<InfoTip title="What the SKU means">
					<p>
						<strong>SKU format</strong> — 32 characters, structured so a glance tells
						you what it is.
					</p>
					<p>
						<code>CAT</code> · <code>BRD</code> · <code>YR</code> · <code>SEQ</code> ·
						<code>ATTR1-5</code>
					</p>
					<p>
						e.g. <code>GTR-IVY-25-001-SH-MAH-RWD-SUN</code> = Guitar / Ivy / 2025
						/ unit #001 / semi-hollow / mahogany / rosewood / sunburst.
					</p>
					<p>
						SKUs auto-regenerate if you change the category or brand. Existing
						labels with the old code keep working — the scan view resolves either.
					</p>
				</InfoTip>
			</p>
			{#if data.item.retired_at}
				<span class="pill pill-danger">Retired · {data.item.retired_reason}</span>
			{/if}
		</div>
		{#if page.url.searchParams.get('merged_from')}
			<!-- Banner shown after a successful merge — the duplicate's
				 SKU is now soft-deleted with merged_into_item_id = this
				 item's id. Banner is dismissible by reloading without
				 the query param (or just navigating away). -->
			<div
				class="panel px-4 py-2"
				style="border-color: var(--color-moss-bright)"
			>
				<p class="text-sm text-[color:var(--color-moss-bright)]">
					✓ Absorbed
					<span class="font-mono">{page.url.searchParams.get('merged_from')}</span> into
					this item. Photos, movements, and listings moved over; the duplicate is
					soft-deleted (still accessible by direct URL).
				</p>
			</div>
		{/if}
		{#if actionBanner}
			<!-- Result of the last item action (qty adjust / retire / sellable
				 toggle) incl. what happened on Squarespace. -->
			<div
				class="panel px-4 py-2"
				style="border-color: {actionBanner.tone === 'good'
					? 'var(--color-moss-bright)'
					: actionBanner.tone === 'warn'
						? 'var(--color-gold-bright)'
						: 'var(--color-line)'}"
			>
				<p
					class="text-sm {actionBanner.tone === 'good'
						? 'text-[color:var(--color-moss-bright)]'
						: actionBanner.tone === 'warn'
							? 'text-[color:var(--color-gold-bright)]'
							: 'text-[color:var(--color-ink-2)]'}"
				>
					{actionBanner.text}
				</p>
			</div>
		{/if}
		<h1 class="headline text-3xl leading-tight">{data.item.title}</h1>
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<span class={CONDITION_PILL[data.item.condition] ?? 'pill'}>
				{CONDITION_LABEL[data.item.condition] ?? data.item.condition}
			</span>
			<span class="pill">{data.item.cat_code} · {data.item.cat_name}</span>
			{#if data.item.brand_code}
				<span class="pill">{data.item.brand_code}</span>
			{/if}
			{#if data.item.tracking_mode === 'stocked'}
				<span class="pill pill-warn">
					Stocked · {data.item.stock_qty} on hand
				</span>
			{/if}
			{#if data.item.sellable && !data.item.retired_at}
				<span class="pill pill-success" title="Quantity + retire changes sync to Squarespace automatically">
					Sellable
				</span>
			{/if}
			<span class="text-xs text-[color:var(--color-ink-3)]">
				Received {data.item.year_received}
			</span>
			<div class="ml-auto flex items-center gap-1.5">
				<form method="POST" action="?/cloneItem" class="contents">
					<button
						type="submit"
						class="btn-ghost px-3 py-1 text-xs"
						title="Create a new item from this one — copies its details and photos, then opens it so you can change the variation (colour, style, etc.)"
					>
						⧉ Clone item
					</button>
				</form>
				<label for="label_tpl" class="sr-only">Label size / printer</label>
				<select
					id="label_tpl"
					bind:value={labelTemplate}
					class="field !w-auto max-w-[14rem] py-1 text-xs"
					title="Choose the printer / label size"
				>
					{#each data.templates as t (t.code)}
						<option value={t.code}>{t.display_name}</option>
					{/each}
				</select>
				<a
					href="/api/labels/item/{encodeURIComponent(data.item.sku)}?template={labelTemplate}"
					target="_blank"
					class="btn-ghost px-3 py-1 text-xs"
					title="Open the printable label in a new tab"
				>
					Print label
				</a>
			</div>
		</div>

		{#if data.parent}
			<p class="text-xs text-[color:var(--color-ink-3)]">
				Variant of
				<a
					href="/items/{encodeURIComponent(data.parent.sku)}"
					class="font-mono text-[color:var(--color-gold-bright)] hover:underline"
				>
					{data.parent.sku}
				</a>
				<span class="text-[color:var(--color-ink-4)]">·</span>
				{data.parent.title}
			</p>
		{/if}
	</header>

	{#if form?.actionError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.actionError}</p>
		</div>
	{/if}

	<!-- ============= Photos + sidebar ============= -->
	<div class="grid gap-6 lg:grid-cols-[2fr_1fr]">
		<!-- Photos -->
		<div class="space-y-3">
			{#if data.photos.length === 0}
				<div
					class="panel flex aspect-square items-center justify-center text-sm italic text-[color:var(--color-ink-4)]"
				>
					No photos yet
				</div>
			{:else}
				<div class="panel relative overflow-hidden">
					<img
						src="/api/photos/{activePhoto?.r2_key ?? primaryPhoto.r2_key}"
						alt={activePhoto?.alt_text ?? data.item.title}
						class="aspect-square w-full bg-[color:var(--color-input)] object-contain"
					/>
					{#if activePhotoIndex === 0}
						<span
							class="absolute left-2 top-2 rounded bg-[color:var(--color-gold)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-bg)]"
						>
							Primary
						</span>
					{/if}
				</div>
				{#if extraPhotos.length > 0 || data.photos.length > 1}
					<div class="grid grid-cols-6 gap-2">
						{#each data.photos as photo, i (photo.id)}
							<button
								type="button"
								onclick={() => (activePhotoIndex = i)}
								class="relative aspect-square overflow-hidden rounded border bg-[color:var(--color-input)] transition-colors {i ===
								activePhotoIndex
									? 'border-[color:var(--color-gold)]'
									: 'border-[color:var(--color-line-dim)] hover:border-[color:var(--color-line-bright)]'}"
							>
								<img
									src="/api/photos/{photo.r2_key}"
									alt=""
									class="h-full w-full object-cover"
									loading="lazy"
								/>
								{#if i === 0}
									<span
										class="absolute right-0.5 top-0.5 rounded bg-[color:var(--color-gold)] px-1 text-[8px] font-bold uppercase text-[color:var(--color-bg)]"
									>
										★
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			{/if}

			<!-- Photo management — upload, set primary, delete -->
			<div class="panel space-y-3 px-4 py-3">
				<p class="eyebrow">Manage photos</p>

				{#if form?.photoError}
					<p class="text-xs text-[color:var(--color-rust-bright)]">{form.photoError}</p>
				{/if}
				{#if page.url.searchParams.get('photo_warn')}
					<p class="text-xs text-[color:var(--color-gold-bright)]">
						{page.url.searchParams.get('photo_warn')}
					</p>
				{/if}
				{#if page.url.searchParams.get('pulled_photos')}
					{#if Number(page.url.searchParams.get('pulled_photos')) > 0}
						<p class="text-xs text-[color:var(--color-moss-bright)]">
							Pulled {page.url.searchParams.get('pulled_photos')} photo(s){#if page.url.searchParams.get('pull_src')}
								from {page.url.searchParams.get('pull_src')}{/if}.
						</p>
					{:else}
						<p class="text-xs text-[color:var(--color-gold-bright)]">
							{#if page.url.searchParams.get('pull_err')}
								Couldn’t pull photos: {page.url.searchParams.get('pull_err')}
							{:else}
								No new photos found on the linked listings — they’re already here, or the source has
								none. Add some below if needed.
							{/if}
						</p>
					{/if}
					{#if page.url.searchParams.get('pull_log')}
						<p class="text-[10px] text-[color:var(--color-ink-4)]">
							Tried: {page.url.searchParams.get('pull_log')}
						</p>
					{/if}
				{/if}

				<form
					method="POST"
					action="?/uploadPhotos"
					enctype="multipart/form-data"
					class="space-y-2"
				>
					<label
						for="photo_upload"
						class="block cursor-pointer rounded border border-dashed border-[color:var(--color-line)] bg-[color:var(--color-input)] px-3 py-4 text-center text-xs text-[color:var(--color-ink-2)] transition-colors hover:border-[color:var(--color-gold-dim)] hover:text-[color:var(--color-ink)]"
					>
						<span class="block font-medium">📷 Choose photos to upload</span>
						<span class="mt-1 block text-[10px] italic text-[color:var(--color-ink-3)]">
							JPG / PNG / WEBP · up to 15MB each · 20 at a time
						</span>
					</label>
					<input
						id="photo_upload"
						type="file"
						name="photos"
						accept="image/jpeg,image/png,image/webp,image/gif"
						multiple
						required
						class="hidden"
						onchange={(e) => {
							const target = e.currentTarget as HTMLInputElement;
							if (target.files && target.files.length > 0) {
								target.form?.requestSubmit();
							}
						}}
					/>
					<noscript>
						<button type="submit" class="btn-primary w-full px-3 py-1.5 text-xs">
							Upload selected
						</button>
					</noscript>
				</form>

				{#if hasPhotoSource}
					<form method="POST" action="?/pullPhotos">
						<button
							type="submit"
							class="btn-ghost mt-2 w-full px-3 py-1.5 text-xs"
							title="Download photos from this item's marketplace listing — tries Squarespace, then Reverb, then eBay"
						>
							⬇ Pull photos from source
						</button>
					</form>
				{/if}

				{#if data.photos.length > 0}
					<div class="space-y-1.5 border-t border-[color:var(--color-line-dim)] pt-3">
						<p class="text-[10px] uppercase tracking-wide text-[color:var(--color-ink-4)]">
							Selected: photo {activePhotoIndex + 1} of {data.photos.length}
						</p>

						<!-- Reorder row — up/down by one position. Position drives
						     the order on the item list thumb, the SS push image
						     order, and the Reverb URL list. -->
						{#if data.photos.length > 1}
							<div class="flex gap-2">
								<form method="POST" action="?/reorderPhoto" class="flex-1">
									<input
										type="hidden"
										name="photo_id"
										value={activePhoto?.id ?? data.photos[0].id}
									/>
									<input type="hidden" name="direction" value="up" />
									<button
										type="submit"
										class="btn-ghost w-full px-3 py-1.5 text-xs"
										disabled={activePhotoIndex === 0}
										title="Move this photo one position earlier"
									>
										↑ Up
									</button>
								</form>
								<form method="POST" action="?/reorderPhoto" class="flex-1">
									<input
										type="hidden"
										name="photo_id"
										value={activePhoto?.id ?? data.photos[0].id}
									/>
									<input type="hidden" name="direction" value="down" />
									<button
										type="submit"
										class="btn-ghost w-full px-3 py-1.5 text-xs"
										disabled={activePhotoIndex === data.photos.length - 1}
										title="Move this photo one position later"
									>
										↓ Down
									</button>
								</form>
							</div>
						{/if}

						<!-- Make-primary + delete row -->
						<div class="flex gap-2">
							{#if activePhotoIndex !== 0}
								<form method="POST" action="?/makePrimaryPhoto" class="flex-1">
									<input
										type="hidden"
										name="photo_id"
										value={activePhoto?.id ?? data.photos[0].id}
									/>
									<button type="submit" class="btn-ghost w-full px-3 py-1.5 text-xs">
										★ Make primary
									</button>
								</form>
							{/if}
							<form
								method="POST"
								action="?/deletePhoto"
								class="flex-1"
								onsubmit={(e) => {
									if (!confirm('Delete this photo?')) e.preventDefault();
								}}
							>
								<input
									type="hidden"
									name="photo_id"
									value={activePhoto?.id ?? data.photos[0].id}
								/>
								<button
									type="submit"
									class="btn-ghost w-full px-3 py-1.5 text-xs"
									style="color: var(--color-rust-bright)"
								>
									✕ Delete
								</button>
							</form>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Sidebar: location, pricing, category, actions -->
		<aside class="space-y-3">
			<!-- LOCATION ------------------------------------------ -->
			<div class="panel px-4 py-3">
				<p class="eyebrow mb-2">Location</p>
				{#if showingTransfer}
					<form method="POST" action="?/transfer" class="space-y-2">
						<select name="bin_id" class="field text-sm">
							<option value="">— unassigned —</option>
							{#each data.bins as b (b.id)}
								<option value={b.id} selected={b.id === data.item.current_bin_id}>
									{b.path}
								</option>
							{/each}
						</select>
						<input
							name="note"
							type="text"
							placeholder="Note (optional)"
							class="field text-xs"
						/>
						<div class="flex gap-2">
							<button type="submit" class="btn-primary px-3 py-1.5 text-xs">Save</button>
							<button
								type="button"
								class="btn-ghost px-3 py-1.5 text-xs"
								onclick={() => (showingTransfer = false)}
							>
								Cancel
							</button>
						</div>
					</form>
				{:else}
					<p class="font-mono text-lg text-[color:var(--color-ink)]">
						{#if data.item.bin_code && data.item.loc_code}
							{data.item.loc_code} / {data.item.bin_code}
						{:else}
							<span class="italic text-[color:var(--color-ink-4)]">unassigned</span>
						{/if}
					</p>
					{#if data.item.loc_name}
						<p class="text-xs text-[color:var(--color-ink-3)]">{data.item.loc_name}</p>
					{/if}
					{#if !data.item.retired_at}
						<button
							type="button"
							class="btn-ghost mt-2 w-full px-3 py-1.5 text-xs"
							onclick={() => (showingTransfer = true)}
						>
							{data.item.current_bin_id ? 'Transfer' : 'Assign bin'}
						</button>
					{/if}
				{/if}
			</div>

			<!-- PRICING ------------------------------------------- -->
			<div class="panel px-4 py-3">
				<p class="eyebrow mb-2">Pricing</p>
				<div class="space-y-1 text-sm">
					<div class="flex items-baseline justify-between">
						<span class="text-[color:var(--color-ink-3)]">Cost</span>
						<span class="font-mono">{formatPrice(data.item.cost_cents)}</span>
					</div>
					<div class="flex items-baseline justify-between">
						<span class="text-[color:var(--color-ink-3)]">Price</span>
						<span class="font-mono text-lg text-[color:var(--color-ink)]">
							{formatPrice(data.item.price_cents)}
						</span>
					</div>
				</div>
			</div>

			<!-- ON-HAND PANEL ------------------------------------- -->
			<!--
				Works for both tracking modes. Serialized items live in
				the 0..1 range — qty 0 means "out of stock, listing
				preserved, re-stock when another comes in" (distinct
				from the explicit Retire flow which means "discontinued
				forever"). Stocked items live in 0..N.

				Hidden for retired items because the Retire panel below
				owns that flow — bring it back first, then adjust.
			-->
			{#if !data.item.retired_at}
				<div class="panel px-4 py-3">
					<div class="flex items-baseline justify-between">
						<p class="eyebrow inline-flex items-center gap-0.5">
							On hand
							<InfoTip title="On-hand quantity">
								<p>
									How many of this exact item you currently have. For serialized
									listings (one specific guitar), this stays at 0 or 1. For stocked
									items (parts, strings, picks), any non-negative number.
								</p>
								<p>
									<strong>Adjust</strong> for off-platform sales, miscounts, breakage,
									or restocks — pick a reason and it writes a movement to the audit
									ledger.
								</p>
							</InfoTip>
						</p>
						{#if !showingAdjust}
							<button
								type="button"
								class="text-[10px] text-[color:var(--color-gold-bright)] hover:underline"
								onclick={() => {
									adjustNewQty = data.item.stock_qty;
									showingAdjust = true;
								}}
							>
								Adjust
							</button>
						{/if}
					</div>

					{#if !showingAdjust}
						<div class="flex items-baseline gap-2">
							<p class="font-mono text-2xl text-[color:var(--color-ink)]">
								{data.item.stock_qty}
							</p>
							{#if data.item.stock_qty === 0}
								<span class="pill pill-warn text-[10px]">Out of stock</span>
							{/if}
						</div>
						{#if data.item.tracking_mode === 'serialized'}
							<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
								{#if data.item.stock_qty === 0}
									Listing preserved — adjust to 1 when another one comes in.
								{:else}
									One specific unit. Adjust to 0 when it sells; the listing stays
									searchable for restocks.
								{/if}
							</p>
						{:else}
							<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
								Off-platform sale, miscount, or breakage — click Adjust to fix.
							</p>
						{/if}
					{:else}
						<form method="POST" action="?/adjustQty" class="space-y-2">
							{#if form?.adjustError}
								<p class="text-xs text-[color:var(--color-rust-bright)]">
									{form.adjustError}
								</p>
							{/if}

							<div class="space-y-1">
								<p class="text-[11px] text-[color:var(--color-ink-3)]">
									Currently <span class="font-mono">{data.item.stock_qty}</span>
								</p>
								<label for="new_qty" class="eyebrow block text-[10px]">New quantity</label>
								<div class="flex gap-1.5">
									<!--
										No `max` constraint on serialized anymore.
										Going past 1 used to be blocked by both the
										browser (clamped typing at 1) and the server.
										New behavior: setting a serialized listing
										to >1 auto-promotes it to Stocked tracking,
										since the listing now represents inventory
										rather than one specific unit. Server flips
										the mode in the same transaction with a note
										on the movement.
									-->
									<input
										id="new_qty"
										name="new_qty"
										type="number"
										min="0"
										required
										bind:value={adjustNewQty}
										class="field py-1 text-sm"
									/>
									<button
										type="button"
										class="btn-ghost px-2 py-1 text-xs"
										title="Set to zero"
										onclick={() => (adjustNewQty = 0)}
									>
										0
									</button>
									{#if data.item.tracking_mode === 'serialized'}
										<button
											type="button"
											class="btn-ghost px-2 py-1 text-xs"
											title="Set to one (restock)"
											onclick={() => (adjustNewQty = 1)}
										>
											1
										</button>
									{/if}
								</div>
								{#if data.item.tracking_mode === 'serialized'}
									<p class="text-[10px] italic text-[color:var(--color-ink-4)]">
										Serialized listing — 0 or 1 keeps it as a single unit.
										Going above 1 auto-switches this to Stocked tracking
										(the listing keeps its photos, description, and history).
									</p>
								{/if}
							</div>

							<div class="space-y-1">
								<label for="reason" class="eyebrow block text-[10px]">Reason</label>
								<select id="reason" name="reason" required class="field py-1 text-xs">
									<option value="">— pick one —</option>
									<option value="sold_external">Sold off-platform (eBay / cash / etc.)</option>
									<option value="restocked">Restocked (another one came in)</option>
									<option value="count_correction">Count correction</option>
									<option value="damaged">Damaged / discarded</option>
									<option value="found_extra">Found extra</option>
									<option value="other">Other</option>
								</select>
							</div>

							<div class="space-y-1">
								<label for="adjust_note" class="eyebrow block text-[10px]">Note (optional)</label>
								<input
									id="adjust_note"
									name="note"
									type="text"
									placeholder="Order #, buyer, where it went…"
									class="field py-1 text-xs"
								/>
							</div>

							<div class="flex gap-2 pt-1">
								<button type="submit" class="btn-primary px-3 py-1.5 text-xs">
									Save adjustment
								</button>
								<button
									type="button"
									class="btn-ghost px-3 py-1.5 text-xs"
									onclick={() => (showingAdjust = false)}
								>
									Cancel
								</button>
							</div>
						</form>
					{/if}
				</div>
			{/if}

			<!-- SELLABLE / GO-LIVE TOGGLE -------------------------------- -->
			<!--
				The switch that takes an item live. When ON, quantity changes
				and retirement auto-propagate to the item's Squarespace
				listing (server: ?/setSellable + ss_auto_sync). Hidden for
				retired items — "sellable" is moot once retired.
			-->
			{#if !data.item.retired_at}
				<div
					class="panel px-4 py-3"
					style={data.item.sellable ? 'border-color: var(--color-moss-bright)' : ''}
				>
					<div class="flex items-start justify-between gap-3">
						<div>
							<p class="eyebrow inline-flex items-center gap-0.5">
								Sellable
								<InfoTip title="Sellable — auto-sync to Squarespace">
									<p>
										Turn this on once the item is listed and ready to sell. While it's on,
										the app keeps Squarespace in sync for you:
									</p>
									<ul class="ml-4 list-disc space-y-0.5">
										<li>
											Change the quantity here → the Squarespace listing's stock updates (0
											shows as “Sold Out”, the listing stays visible).
										</li>
										<li>Retire the item → its Squarespace listing is deleted.</li>
									</ul>
									<p>
										Turning it off just stops the automatic syncing — it doesn't change or
										remove the existing listing.
									</p>
								</InfoTip>
							</p>
							<p class="mt-0.5 text-[11px] text-[color:var(--color-ink-3)]">
								{#if data.item.sellable}
									{#if ssListing?.external_id}
										Live — quantity and retire changes sync to Squarespace automatically.
									{:else}
										On, but not on Squarespace yet. Push it from the Squarespace editor
										below; syncing begins once it's listed.
									{/if}
								{:else}
									Off — changes here stay local until you mark it sellable.
								{/if}
							</p>
						</div>
						<form method="POST" action="?/setSellable">
							<input type="hidden" name="sellable" value={data.item.sellable ? '0' : '1'} />
							<button
								type="submit"
								class={data.item.sellable
									? 'btn-ghost px-3 py-1.5 text-xs whitespace-nowrap'
									: 'btn-primary px-3 py-1.5 text-xs whitespace-nowrap'}
							>
								{data.item.sellable ? 'Turn off' : 'Mark sellable'}
							</button>
						</form>
					</div>
				</div>
			{/if}

			<!-- PULL ONE OFF AS VARIANT (stocked items with qty > 0) ---- -->
			<!--
				The "blemished part" workflow. Pulls 1 unit out of the
				stocked parent and creates a serialized variant with its
				own SKU, photos, listings, and price. Draft listings are
				auto-created for every platform so when eBay / Reverb /
				Etsy come online, the variant is one click from push.
			-->
			{#if data.item.tracking_mode === 'stocked' && data.item.stock_qty > 0 && !data.item.retired_at}
				<div class="panel px-4 py-3">
					<div class="flex items-baseline justify-between">
						<p class="eyebrow">Pull one off</p>
						{#if !showingSplitOff}
							<button
								type="button"
								class="text-[10px] text-[color:var(--color-gold-bright)] hover:underline"
								onclick={() => (showingSplitOff = true)}
							>
								Start
							</button>
						{/if}
					</div>

					{#if !showingSplitOff}
						<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
							One unit is different (blemished, demo, B-stock)? Pull it out into its
							own variant with its own listing.
						</p>
					{:else}
						<form method="POST" action="?/splitOff" class="space-y-2">
							{#if form?.splitError}
								<p class="text-xs text-[color:var(--color-rust-bright)]">{form.splitError}</p>
							{/if}

							<div class="space-y-1">
								<label for="variant_reason" class="eyebrow block text-[10px]">
									What's different?
								</label>
								<select
									id="variant_reason"
									name="variant_reason"
									required
									class="field py-1 text-xs"
								>
									<option value="">— pick a label —</option>
									<option value="Blemished">Blemished (cosmetic damage)</option>
									<option value="Demo">Demo / Display</option>
									<option value="Open Box">Open Box</option>
									<option value="B-Stock">B-Stock</option>
									<option value="Refurbished">Refurbished</option>
									<option value="Used">Used</option>
									<option value="Vintage">Vintage</option>
									<option value="One of a Kind">One of a Kind</option>
								</select>
								<p class="text-[10px] italic text-[color:var(--color-ink-4)]">
									Becomes the title prefix and a listing tag.
								</p>
							</div>

							<div class="space-y-1">
								<label for="new_condition" class="eyebrow block text-[10px]">
									Condition
								</label>
								<select
									id="new_condition"
									name="new_condition"
									required
									class="field py-1 text-xs"
								>
									<option value={data.item.condition} selected>
										Same as parent ({data.item.condition === 'N'
											? 'New'
											: data.item.condition === 'U'
												? 'Used'
												: data.item.condition === 'R'
													? 'Refurbished'
													: 'For parts'})
									</option>
									<option value="N">New</option>
									<option value="U">Used</option>
									<option value="R">Refurbished</option>
									<option value="B">For parts / broken</option>
								</select>
							</div>

							<div class="space-y-1">
								<label for="variant_note" class="eyebrow block text-[10px]">
									Note (what's the story?)
								</label>
								<textarea
									id="variant_note"
									name="variant_note"
									rows="2"
									placeholder="e.g. Small paint chip on lower bout, visible in photo 3"
									class="field py-1 text-xs"
								></textarea>
							</div>

							<div class="space-y-1">
								<label for="variant_price" class="eyebrow block text-[10px]">
									Price override ($) <span class="lowercase">— optional</span>
								</label>
								<input
									id="variant_price"
									name="variant_price"
									type="number"
									step="0.01"
									min="0"
									placeholder={data.item.price_cents != null
										? (data.item.price_cents / 100).toFixed(2)
										: ''}
									class="field py-1 text-xs"
								/>
								<p class="text-[10px] italic text-[color:var(--color-ink-4)]">
									Blank = inherits parent's price. Drop it to mark as a discount.
								</p>
							</div>

							<div class="flex gap-2 pt-1">
								<button type="submit" class="btn-primary px-3 py-1.5 text-xs">
									Pull one off
								</button>
								<button
									type="button"
									class="btn-ghost px-3 py-1.5 text-xs"
									onclick={() => (showingSplitOff = false)}
								>
									Cancel
								</button>
							</div>
						</form>
					{/if}
				</div>
			{/if}

			<!-- CATEGORY ------------------------------------------ -->
			<div class="panel px-4 py-3">
				<p class="eyebrow mb-2">Category</p>
				<p class="text-sm">
					<span class="font-mono text-[color:var(--color-gold)]">{data.item.cat_code}</span>
					<span class="ml-2 text-[color:var(--color-ink)]">{data.item.cat_name}</span>
				</p>
				<p class="mt-2 text-[11px] italic text-[color:var(--color-ink-3)]">
					To change category, use the Edit button below — it lets you pick the new
					category's attributes at the same time and regenerates the SKU cleanly.
				</p>
			</div>

			<!-- LISTINGS ------------------------------------------ -->
			<div class="panel space-y-2 px-4 py-3">
				<p class="eyebrow inline-flex items-center gap-0.5">
					Listings
					<InfoTip title="Marketplace listings">
						<p>
							Where this item is for sale. Each platform has its own editor with
							platform-specific fields (SS has SEO, Reverb has finish + UPC, etc.).
						</p>
						<p>
							<strong>Status pills</strong>:
							<code>draft</code> = local only,
							<code>ready</code> = saved, not yet pushed,
							<code>live</code> = live on the platform,
							<code>paused</code> = hidden,
							<code>error</code> = last push failed.
						</p>
					</InfoTip>
				</p>

				<!-- Squarespace row -->
				<a
					href="/items/{encodeURIComponent(data.item.sku)}/listings/squarespace"
					class="flex items-baseline gap-2 rounded px-1 py-1 transition-colors hover:bg-[color:var(--color-hover)]"
				>
					<span class="text-sm font-medium text-[color:var(--color-ink)]">Squarespace</span>
					{#if ssListing}
						<span
							class={ssListing.status === 'live'
								? 'pill pill-success'
								: ssListing.status === 'ready'
									? 'pill pill-warn'
									: ssListing.status === 'error'
										? 'pill pill-danger'
										: 'pill'}
						>
							{ssListing.status}
						</span>
					{:else}
						<span class="pill text-[10px] text-[color:var(--color-ink-3)]">Not listed</span>
					{/if}
					<span class="ml-auto text-[10px] text-[color:var(--color-ink-3)]">Edit →</span>
				</a>
				{#if ssListing?.last_synced_at}
					<p class="px-1 text-[10px] italic text-[color:var(--color-ink-4)]">
						last synced {shortWhen(ssListing.last_synced_at)}
					</p>
				{/if}
				{#if ssListing?.external_url}
					<a
						href={ssListing.external_url}
						target="_blank"
						class="px-1 text-[11px] text-[color:var(--color-gold-bright)] hover:underline"
					>
						Open on Squarespace ↗
					</a>
				{/if}

				<a
					href="/items/{encodeURIComponent(data.item.sku)}/listings/reverb"
					class="flex items-baseline gap-2 rounded px-1 py-1 transition-colors hover:bg-[color:var(--color-hover)]"
				>
					<span class="text-sm font-medium text-[color:var(--color-ink)]">Reverb</span>
					{#if reverbListing}
						<span
							class={reverbListing.status === 'live'
								? 'pill pill-success'
								: reverbListing.status === 'ready'
									? 'pill pill-warn'
									: reverbListing.status === 'error'
										? 'pill pill-danger'
										: 'pill'}
						>
							{reverbListing.status}
						</span>
					{:else}
						<span class="pill text-[10px] text-[color:var(--color-ink-3)]">Not listed</span>
					{/if}
					<span class="ml-auto text-[10px] text-[color:var(--color-ink-3)]">Edit →</span>
				</a>
				{#if reverbListing?.external_url}
					<a
						href={reverbListing.external_url}
						target="_blank"
						class="px-1 text-[11px] text-[color:var(--color-gold-bright)] hover:underline"
					>
						Open on Reverb ↗
					</a>
				{/if}

				<!-- eBay row -->
				<a
					href="/items/{encodeURIComponent(data.item.sku)}/listings/ebay"
					class="flex items-baseline gap-2 rounded px-1 py-1 transition-colors hover:bg-[color:var(--color-hover)]"
				>
					<span class="text-sm font-medium text-[color:var(--color-ink)]">eBay</span>
					{#if ebayListing}
						<span
							class={ebayListing.status === 'live'
								? 'pill pill-success'
								: ebayListing.status === 'ready'
									? 'pill pill-warn'
									: ebayListing.status === 'error'
										? 'pill pill-danger'
										: 'pill'}
						>
							{ebayListing.status}
						</span>
					{:else}
						<span class="pill text-[10px] text-[color:var(--color-ink-3)]">Not listed</span>
					{/if}
					<span class="ml-auto text-[10px] text-[color:var(--color-ink-3)]">Edit →</span>
				</a>
				{#if ebayListing?.last_synced_at}
					<p class="px-1 text-[10px] italic text-[color:var(--color-ink-4)]">
						last synced {shortWhen(ebayListing.last_synced_at)}
					</p>
				{/if}
				{#if ebayListing?.external_url}
					<a
						href={ebayListing.external_url}
						target="_blank"
						class="px-1 text-[11px] text-[color:var(--color-gold-bright)] hover:underline"
					>
						Open on eBay ↗
					</a>
				{/if}
			</div>

			<!-- RETIRE / UNRETIRE --------------------------------- -->
			{#if data.item.retired_at}
				<form method="POST" action="?/unretire" class="panel px-4 py-3">
					<p class="eyebrow mb-2 text-[color:var(--color-rust-bright)]">Retired</p>
					<p class="text-xs text-[color:var(--color-ink-3)]">
						{data.item.retired_reason} · {shortWhen(data.item.retired_at)}
					</p>
					<button type="submit" class="btn-ghost mt-2 w-full px-3 py-1.5 text-xs">
						Bring back
					</button>
				</form>
			{:else if showingRetire}
				<form method="POST" action="?/retire" class="panel space-y-2 px-4 py-3">
					<p class="eyebrow">Retire item</p>
					<select name="reason" required class="field text-sm">
						<option value="">— pick a reason —</option>
						<option value="sold">Sold</option>
						<option value="scrap">Scrap / discarded</option>
						<option value="used_in_build">Used in a build</option>
					</select>
					<input name="note" type="text" placeholder="Note (e.g. order ref)" class="field text-xs" />
					<div class="flex gap-2">
						<button type="submit" class="btn-primary px-3 py-1.5 text-xs">Retire</button>
						<button
							type="button"
							class="btn-ghost px-3 py-1.5 text-xs"
							onclick={() => (showingRetire = false)}
						>
							Cancel
						</button>
					</div>
				</form>
			{:else}
				<!-- Merge: route to the duplicate picker. Separated from
					 Retire visually because they're opposite moves —
					 Merge folds another listing INTO this one; Retire
					 takes this one out of circulation. -->
				<a
					href="/items/{encodeURIComponent(data.item.sku)}/merge"
					class="btn-ghost block w-full px-4 py-2 text-center text-xs"
					title="Find items that might be the same as this one (Dad relisted things sometimes)"
				>
					🔗 Find duplicates to merge in
				</a>
				<button
					type="button"
					class="btn-ghost w-full px-4 py-2 text-xs"
					onclick={() => (showingRetire = true)}
				>
					Retire item
				</button>
			{/if}
		</aside>
	</div>

	<!-- ============= Variants (if this item has children) ============= -->
	{#if data.variants.length > 0}
		<section class="panel space-y-3 px-6 py-5">
			<p class="eyebrow">{data.variants.length} variant{data.variants.length === 1 ? '' : 's'}</p>
			<ul class="space-y-1">
				{#each data.variants as v (v.id)}
					<li class="flex items-baseline gap-3 text-sm">
						<a
							href="/items/{encodeURIComponent(v.sku)}"
							class="font-mono text-xs text-[color:var(--color-gold)] hover:text-[color:var(--color-gold-bright)]"
						>
							{v.sku}
						</a>
						<span class="flex-1 truncate text-[color:var(--color-ink-2)]">{v.title}</span>
						{#if v.stock_qty !== 1}
							<span class="font-mono text-xs text-[color:var(--color-ink-3)]">
								qty {v.stock_qty}
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- ============= Description + edit ============= -->
	<section class="panel space-y-3 px-6 py-5">
		<div class="flex items-center justify-between">
			<p class="eyebrow">Attributes &amp; Description</p>
			{#if !editingDetails}
				<button
					type="button"
					class="btn-ghost px-3 py-1.5 text-xs"
					onclick={() => (editingDetails = true)}
				>
					Edit
				</button>
			{/if}
		</div>

		<!-- Attributes (view) — sit above the description in the same box so a
		     single Edit button governs both. The edit form below also covers
		     attributes, so only show this read-only grid when not editing. -->
		{#if !editingDetails && attrSlots.some((s) => s.label != null)}
			<dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each attrSlots as slot (slot.n)}
					{#if slot.label}
						<div class="space-y-0.5">
							<dt class="eyebrow text-[10px]">{slot.label}</dt>
							<dd>
								{#if slot.value === 'XXX'}
									<span class="font-mono text-sm italic text-[color:var(--color-ink-4)]">—</span>
								{:else if slot.value === 'UNQ'}
									<span class="font-mono text-sm text-[color:var(--color-gold-bright)]">UNQ</span>
								{:else if slot.valueLabel}
									<span class="text-sm text-[color:var(--color-ink)]">{slot.valueLabel}</span>
									<span class="ml-1 font-mono text-xs text-[color:var(--color-gold-dim)]"
										>({slot.value})</span
									>
								{:else}
									<span class="font-mono text-sm text-[color:var(--color-ink)]">{slot.value}</span>
								{/if}
							</dd>
							{#if slot.value === 'UNQ' && slot.uniqueDesc}
								<p class="text-xs italic text-[color:var(--color-ink-2)]">{slot.uniqueDesc}</p>
							{/if}
						</div>
					{/if}
				{/each}
			</dl>
			<div class="border-t border-[color:var(--color-line-dim)]"></div>
		{/if}

		{#if editingDetails}
			<form method="POST" action="?/edit" class="space-y-3">
				<!-- Category + condition: side by side at the top. Changing
				     category rewires the attribute fieldset below. -->
				<div class="grid gap-3 md:grid-cols-2">
					<div class="space-y-1.5">
						<label for="edit_category_id" class="eyebrow block">Category</label>
						<select
							id="edit_category_id"
							name="category_id"
							required
							bind:value={editCategoryId}
							class="field"
						>
							{#each data.categories as cat (cat.id)}
								<option value={cat.id}>{cat.code} · {cat.name}</option>
							{/each}
						</select>
						{#if form?.editErrors?.category_id}
							<p class="text-xs text-[color:var(--color-rust-bright)]">
								{form.editErrors.category_id}
							</p>
						{/if}
					</div>

					<div class="space-y-1.5">
						<label for="condition" class="eyebrow block">Condition</label>
						<select id="condition" name="condition" required class="field">
							<option value="N" selected={data.item.condition === 'N'}>New</option>
							<option value="U" selected={data.item.condition === 'U'}>Used</option>
							<option value="R" selected={data.item.condition === 'R'}>Refurbished</option>
							<option value="B" selected={data.item.condition === 'B'}>Broken / parts</option>
						</select>
					</div>

					<div class="space-y-1.5 md:col-span-2">
						<label for="title" class="eyebrow block">Title</label>
						<input
							id="title"
							name="title"
							type="text"
							required
							value={data.item.title}
							class="field"
						/>
						{#if form?.editErrors?.title}
							<p class="text-xs text-[color:var(--color-rust-bright)]">{form.editErrors.title}</p>
						{/if}
					</div>

					<div class="grid grid-cols-2 gap-2">
						<div class="space-y-1.5">
							<label for="cost" class="eyebrow block">Cost ($)</label>
							<input
								id="cost"
								name="cost"
								type="number"
								step="0.01"
								min="0"
								value={data.item.cost_cents != null ? (data.item.cost_cents / 100).toFixed(2) : ''}
								class="field"
							/>
						</div>
						<div class="space-y-1.5">
							<label for="price" class="eyebrow block">Price ($)</label>
							<input
								id="price"
								name="price"
								type="number"
								step="0.01"
								min="0"
								value={data.item.price_cents != null ? (data.item.price_cents / 100).toFixed(2) : ''}
								class="field"
							/>
						</div>
					</div>
				</div>

				<!-- Tracking -->
				<fieldset class="grid gap-3 rounded border border-[color:var(--color-line-dim)] p-4 sm:grid-cols-2">
					<legend class="eyebrow px-2 inline-flex items-center gap-0.5">
						Tracking
						<InfoTip title="Serialized vs Stocked">
							<p>
								<strong>Serialized</strong> = the listing represents one specific
								physical unit (used guitars, one-of-a-kind builds). Stays at 0 or 1.
								When it sells, the listing is preserved at qty=0 so the URL keeps
								working.
							</p>
							<p>
								<strong>Stocked</strong> = interchangeable inventory (strings, picks,
								new parts). Any non-negative quantity. Used when "we have X of this
								exact thing".
							</p>
						</InfoTip>
					</legend>
					<div class="space-y-1.5">
						<label for="tracking_mode" class="eyebrow block">Mode</label>
						<select
							id="tracking_mode"
							name="tracking_mode"
							bind:value={editTrackingMode}
							class="field"
						>
							<option value="serialized">Serialized (one object)</option>
							<option value="stocked">Stocked (count by qty)</option>
						</select>
					</div>
					{#if editTrackingMode === 'stocked'}
						<div class="space-y-1.5">
							<label for="stock_qty" class="eyebrow block">On-hand quantity</label>
							<input
								id="stock_qty"
								name="stock_qty"
								type="number"
								min="0"
								bind:value={editStockQty}
								class="field"
							/>
							{#if form?.editErrors?.stock_qty}
								<p class="text-xs text-[color:var(--color-rust-bright)]">
									{form.editErrors.stock_qty}
								</p>
							{/if}
						</div>
					{:else}
						<input type="hidden" name="stock_qty" value="1" />
					{/if}
				</fieldset>

				<!-- Attributes — react to the chosen category, not the
				     item's current category, so changing category in the
				     dropdown above swaps the slot labels immediately. -->
				{#if editAttrSlots.some((s) => s.label != null)}
					<fieldset class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
						<legend class="eyebrow px-2">Attributes</legend>
						{#if categoryWillChange}
							<p class="text-[11px] text-[color:var(--color-gold-bright)]">
								Category change — pick fresh values for the new category's slots.
							</p>
						{:else}
							<p class="text-[11px] text-[color:var(--color-ink-3)]">
								Editing attributes without changing category leaves the SKU as-is.
							</p>
						{/if}
						<div class="grid gap-3 sm:grid-cols-2">
							{#each editAttrSlots as slot, i (slot.n)}
								{#if slot.label}
									<div class="space-y-1.5">
										<label for="attr_{slot.n}" class="eyebrow block">{slot.label}</label>
										<AttributeValueSelect
											contextKey={slot.contextKey}
											name="attr_{slot.n}"
											bind:value={editAttrValues[i]}
											initialValues={slot.values}
											placeholder="— no value —"
										/>
										{#if isUnq(editAttrValues[i])}
											<textarea
												name="attr_{slot.n}_unique_desc"
												rows="2"
												placeholder="Describe this one-of-a-kind {slot.label.toLowerCase()}…"
												class="field text-sm"
											></textarea>
										{/if}
									</div>
								{/if}
							{/each}
						</div>

						<!-- Keep-SKU opt-out, only relevant when category is changing. -->
						{#if categoryWillChange}
							<label
								class="flex items-start gap-3 rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] p-3"
							>
								<input
									type="checkbox"
									name="keep_sku"
									bind:checked={keepSku}
									class="mt-0.5 h-4 w-4 accent-[color:var(--color-gold)]"
									style="min-height: auto"
								/>
								<div class="space-y-0.5">
									<span class="text-sm font-medium text-[color:var(--color-ink)]">
										Keep current SKU
									</span>
									<p class="text-[11px] text-[color:var(--color-ink-3)]">
										By default, recategorizing regenerates the SKU under the new
										category's prefix
										<span class="font-mono">({editActiveCategory?.code ?? '??'}-…)</span>.
										Check this if you've already printed a label and need the SKU
										<span class="font-mono">{data.item.sku}</span> to stick.
									</p>
								</div>
							</label>
						{/if}
					</fieldset>
				{/if}

				<div class="space-y-1.5">
					<label for="description" class="eyebrow block">Description (plain text)</label>
					<textarea id="description" name="description" rows="3" class="field">{data.item.description ?? ''}</textarea>
				</div>

				<div class="space-y-1.5">
					<label for="description_html" class="eyebrow block">
						Description (HTML — shown on Squarespace)
					</label>
					<textarea
						id="description_html"
						name="description_html"
						rows="6"
						class="field font-mono text-xs"
					>{data.item.description_html ?? ''}</textarea>
				</div>

				<div class="flex gap-2 border-t border-[color:var(--color-line-dim)] pt-3">
					<button type="submit" class="btn-primary">Save changes</button>
					<button
						type="button"
						class="btn-ghost"
						onclick={() => (editingDetails = false)}
					>
						Cancel
					</button>
				</div>
			</form>
		{:else if data.item.description_html}
			<!-- HTML descriptions come from Squarespace (trusted source).
				 The .description-body class neutralises any inline color
				 styles SS embedded so it reads against the dark theme. -->
			<div class="description-body max-w-none text-sm">
				{@html data.item.description_html}
			</div>
		{:else if data.item.description}
			<p class="whitespace-pre-wrap text-sm text-[color:var(--color-ink-2)]">{data.item.description}</p>
		{:else}
			<p class="text-sm italic text-[color:var(--color-ink-4)]">No description yet.</p>
		{/if}
	</section>

	<!-- ============= Movement history ============= -->
	<section class="space-y-3">
		<div class="flex items-end justify-between">
			<p class="eyebrow">Provenance</p>
			<p class="text-xs text-[color:var(--color-ink-4)]">
				{data.movements.length} entr{data.movements.length === 1 ? 'y' : 'ies'}
			</p>
		</div>

		<div class="panel overflow-hidden">
			<table class="w-full text-sm">
				<thead
					class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]"
				>
					<tr class="text-left">
						<th class="eyebrow px-3 py-2.5">Kind</th>
						<th class="eyebrow px-3 py-2.5">From</th>
						<th class="eyebrow px-3 py-2.5">To</th>
						<th class="eyebrow px-3 py-2.5">Note</th>
						<th class="eyebrow px-3 py-2.5">By</th>
						<th class="eyebrow px-3 py-2.5 text-right">When</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.movements as m (m.id)}
						<tr>
							<td class="px-3 py-2.5">
								<span class={KIND_PILL[m.kind] ?? 'pill'}>
									{KIND_LABEL[m.kind] ?? m.kind}
								</span>
							</td>
							<td class="px-3 py-2.5 font-mono text-xs text-[color:var(--color-ink-3)]">
								{locBin(m.from_loc, m.from_bin)}
							</td>
							<td class="px-3 py-2.5 font-mono text-xs text-[color:var(--color-ink-2)]">
								{locBin(m.to_loc, m.to_bin)}
							</td>
							<td class="px-3 py-2.5 text-xs italic text-[color:var(--color-ink-3)]">
								{m.note ?? ''}
							</td>
							<td class="px-3 py-2.5 text-xs text-[color:var(--color-ink-3)]">
								{m.actor ?? '—'}
							</td>
							<td
								class="px-3 py-2.5 text-right font-mono text-xs text-[color:var(--color-ink-3)]"
								title={m.created_at}
							>
								{shortWhen(m.created_at)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</section>
