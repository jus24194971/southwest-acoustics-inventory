<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Parse the JSON tag array back into a comma-separated string for the
	// tag input. Tagging UI is a basic comma-separated field for now —
	// nicer pill UI lands when this earns the screen real estate.
	function tagsFromJson(json: string | null): string {
		if (!json) return '';
		try {
			const arr = JSON.parse(json) as string[];
			return arr.join(', ');
		} catch {
			return '';
		}
	}

	const savedJustNow = $derived(page.url.searchParams.get('saved') === '1');
	const pushedJustNow = $derived(page.url.searchParams.get('pushed') === '1');

	// Initial values for the inputs — start from the listing if there is
	// one, fall back to the item. Captured once on mount via untrack so
	// the user's edits stay put even if data refetches.
	const initial = untrack(() => ({
		title: data.listing?.listing_title ?? data.item.title,
		description: data.listing?.listing_description_html ?? data.item.description_html ?? '',
		urlSlug: data.listing?.listing_url_slug ?? '',
		tags: tagsFromJson(data.listing?.listing_tags_json ?? null),
		price:
			data.listing?.listing_price_cents != null
				? (data.listing.listing_price_cents / 100).toFixed(2)
				: data.item.price_cents != null
					? (data.item.price_cents / 100).toFixed(2)
					: '',
		visible: data.listing ? data.listing.listing_visible === 1 : true,
		storefrontId: data.listing?.storefront_id ?? ''
	}));

	let visible = $state(initial.visible);

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
		live: 'Live on Squarespace',
		paused: 'Paused (hidden)',
		error: 'Last push errored'
	};

	let status = $derived(data.listing?.status ?? 'draft');
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
		<h1 class="headline text-3xl">Squarespace listing</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Listing fields here override the item's internal values when sent to Squarespace. Leave
			a field blank to fall back to the item's value.
		</p>
	</header>

	{#if savedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">Saved locally. No push happened.</p>
		</div>
	{:else if pushedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				Pushed to Squarespace successfully.
			</p>
			{#if data.listing?.external_id}
				<p class="mt-1 font-mono text-xs text-[color:var(--color-ink-3)]">
					external id: {data.listing.external_id}
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

	<!-- Context card — what we're listing -->
	<div class="panel space-y-2 px-4 py-3">
		<p class="eyebrow">Item being listed</p>
		<p class="text-sm">
			<span class="font-medium text-[color:var(--color-ink)]">{data.item.title}</span>
		</p>
		<p class="text-[11px] text-[color:var(--color-ink-3)]">
			Tracking: <span class="font-mono">{data.item.tracking_mode}</span>
			{#if data.item.tracking_mode === 'stocked'}
				· On hand <span class="font-mono">{data.item.stock_qty}</span> → will push as stock
			{/if}
			· Internal price
			<span class="font-mono">
				{data.item.price_cents != null ? `$${(data.item.price_cents / 100).toFixed(2)}` : '—'}
			</span>
		</p>
	</div>

	<!-- ============= Listing form ============= -->
	<form method="POST" class="panel space-y-5 px-6 py-6">
		<div class="space-y-1.5">
			<label for="listing_title" class="eyebrow block">Listing title</label>
			<input
				id="listing_title"
				name="listing_title"
				type="text"
				value={initial.title}
				class="field"
				placeholder={data.item.title}
			/>
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				Defaults to the item's title. Often longer / more keyword-heavy on Squarespace.
			</p>
		</div>

		<div class="space-y-1.5">
			<label for="listing_description_html" class="eyebrow block">
				Listing description <span class="lowercase text-[color:var(--color-ink-4)]">(HTML)</span>
			</label>
			<textarea
				id="listing_description_html"
				name="listing_description_html"
				rows="8"
				class="field font-mono text-xs"
				placeholder="<p>…</p>">{initial.description}</textarea>
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				Customer-facing description, HTML. Defaults to the item's description.
			</p>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="listing_url_slug" class="eyebrow block">URL slug</label>
				<input
					id="listing_url_slug"
					name="listing_url_slug"
					type="text"
					value={initial.urlSlug}
					placeholder="auto-derived from title if blank"
					class="field font-mono"
				/>
			</div>

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
			</div>
		</div>

		<div class="space-y-1.5">
			<label for="listing_tags" class="eyebrow block">
				Tags <span class="lowercase text-[color:var(--color-ink-4)]">(comma-separated)</span>
			</label>
			<input
				id="listing_tags"
				name="listing_tags"
				type="text"
				value={initial.tags}
				placeholder="telecaster, custom, hardware"
				class="field"
			/>
		</div>

		<div class="space-y-1.5">
			<label for="storefront_id" class="eyebrow block">Squarespace storefront</label>
			{#if data.storefronts.length > 0}
				<select id="storefront_id" name="storefront_id" class="field">
					<option value="">— pick a store page —</option>
					{#each data.storefronts as sp (sp.id)}
						<option value={sp.id} selected={sp.id === initial.storefrontId}>{sp.title}</option>
					{/each}
				</select>
			{:else}
				<input
					id="storefront_id"
					name="storefront_id"
					type="text"
					value={initial.storefrontId}
					placeholder="storePageId (couldn't fetch list)"
					class="field font-mono"
				/>
				{#if data.storefrontsError}
					<p class="text-[11px] italic text-[color:var(--color-rust-bright)]">
						{data.storefrontsError}
					</p>
				{/if}
			{/if}
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				Which storefront page this product belongs to. Required for new listings; updates re-use
				whatever Squarespace already has.
			</p>
		</div>

		<label class="flex items-start gap-3">
			<input
				type="checkbox"
				name="listing_visible"
				bind:checked={visible}
				class="mt-0.5 h-4 w-4 accent-[color:var(--color-gold)]"
				style="min-height: auto"
			/>
			<div class="space-y-0.5">
				<span class="text-sm font-medium text-[color:var(--color-ink)]">Visible on Squarespace</span>
				<p class="text-[11px] text-[color:var(--color-ink-3)]">
					When pushed, this controls Squarespace's <span class="font-mono">isVisible</span> flag.
					Uncheck to push as hidden / paused.
				</p>
			</div>
		</label>

		<div class="flex flex-wrap gap-2 border-t border-[color:var(--color-line-dim)] pt-5">
			<button type="submit" formaction="?/save" name="target_status" value="draft" class="btn-ghost">
				Save as draft
			</button>
			<button type="submit" formaction="?/save" name="target_status" value="ready" class="btn-ghost">
				Save as ready
			</button>
			<button type="submit" formaction="?/push" class="btn-primary ml-auto" disabled={!data.hasApiKey}>
				{data.listing?.external_id ? 'Push update to Squarespace' : 'Push to Squarespace'}
			</button>
		</div>

		{#if !data.hasApiKey}
			<p class="text-[11px] italic text-[color:var(--color-rust-bright)]">
				Push disabled: SQUARESPACE_API_KEY isn't configured for this environment.
			</p>
		{/if}
	</form>

	<!-- ============= Sync state details ============= -->
	{#if data.listing}
		<div class="panel space-y-2 px-4 py-3">
			<p class="eyebrow">Squarespace state</p>
			<dl class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Status</dt>
					<dd class="font-mono">{data.listing.status}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">External ID</dt>
					<dd class="font-mono truncate">{data.listing.external_id ?? '—'}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Last synced</dt>
					<dd class="font-mono">{data.listing.last_synced_at ?? '—'}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Last sync status</dt>
					<dd class="font-mono">{data.listing.last_sync_status ?? '—'}</dd>
				</div>
			</dl>
		</div>
	{/if}
</section>
