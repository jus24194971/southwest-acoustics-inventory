<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Local state for the search box — initialised from the URL so the
	// input reflects the active query when arriving via a link. untrack
	// so Svelte 5 doesn't warn about props-as-state-init; the page
	// remounts on navigation, which is how we want it to refresh.
	let searchInput = $state(untrack(() => data.filters.q));

	function formatPrice(cents: number | null): string {
		if (cents == null) return '—';
		return `$${(cents / 100).toFixed(2)}`;
	}

	const CONDITION_LABEL: Record<string, string> = {
		N: 'New',
		U: 'Used',
		R: 'Refurb',
		B: 'For parts'
	};
	const CONDITION_PILL: Record<string, string> = {
		N: 'pill-success',
		U: 'pill',
		R: 'pill-warn',
		B: 'pill-danger'
	};

	// Friendly labels for the active-filter chips. Resolve codes back
	// to "PU · Pickups" / "GAR · Garage Workshop" via the lookups
	// passed in from load.
	let categoryLabel = $derived.by(() => {
		const c = data.filters.category;
		if (!c) return '';
		const found = /^\d+$/.test(c)
			? data.categories.find((x) => x.id === parseInt(c, 10))
			: data.categories.find((x) => x.code === c.toUpperCase());
		return found ? `${found.code} · ${found.name}` : c;
	});
	let locationLabel = $derived.by(() => {
		const l = data.filters.location;
		if (!l) return '';
		const found = /^\d+$/.test(l)
			? data.locations.find((x) => x.id === parseInt(l, 10))
			: data.locations.find((x) => x.code === l.toUpperCase());
		return found ? `${found.code} · ${found.name}` : l;
	});

	/** Build a URL with one query param updated (or removed if value is empty). */
	function withParam(key: string, value: string | null): string {
		const next = new URLSearchParams(page.url.searchParams);
		if (value == null || value === '') next.delete(key);
		else next.set(key, value);
		const qs = next.toString();
		return qs ? `/items?${qs}` : '/items';
	}

	function onSearchSubmit(e: Event) {
		e.preventDefault();
		goto(withParam('q', searchInput.trim()), { keepFocus: false });
	}

	function clearAll() {
		searchInput = '';
		goto('/items');
	}
</script>

<section class="space-y-5">
	<header class="flex flex-wrap items-end justify-between gap-3">
		<div class="space-y-1">
			<p class="eyebrow">Inventory</p>
			<h1 class="headline text-3xl">Items</h1>
		</div>
		<a href="/items/new" class="btn-primary">+ Add item</a>
	</header>

	<!-- ============= Search + filter chips ============= -->
	<div class="panel space-y-3 px-4 py-3">
		<form onsubmit={onSearchSubmit} class="flex gap-2">
			<input
				type="search"
				bind:value={searchInput}
				placeholder="Search SKU, title, description, brand…"
				class="field flex-1"
				autocomplete="off"
			/>
			<button type="submit" class="btn-primary px-4 py-2 text-sm">Search</button>
			{#if data.anyFilterActive}
				<button type="button" class="btn-ghost px-3 py-2 text-sm" onclick={clearAll}>
					Clear all
				</button>
			{/if}
		</form>

		<!-- Filter dropdowns row -->
		<div class="flex flex-wrap items-center gap-2 text-xs">
			<label class="flex items-center gap-1.5">
				<span class="eyebrow">Category</span>
				<select
					value={data.filters.category}
					onchange={(e) => goto(withParam('category', e.currentTarget.value))}
					class="field max-w-[180px] py-1 text-xs"
					style="min-height: 32px"
				>
					<option value="">All</option>
					{#each data.categories as cat (cat.id)}
						<option value={cat.code}>{cat.code} · {cat.name}</option>
					{/each}
				</select>
			</label>

			<label class="flex items-center gap-1.5">
				<span class="eyebrow">Condition</span>
				<select
					value={data.filters.condition}
					onchange={(e) => goto(withParam('condition', e.currentTarget.value))}
					class="field max-w-[140px] py-1 text-xs"
					style="min-height: 32px"
				>
					<option value="">All</option>
					<option value="N">New</option>
					<option value="U">Used</option>
					<option value="R">Refurbished</option>
					<option value="B">For parts</option>
				</select>
			</label>

			<label class="flex items-center gap-1.5">
				<span class="eyebrow">Location</span>
				<select
					value={data.filters.location}
					onchange={(e) => goto(withParam('location', e.currentTarget.value))}
					class="field max-w-[180px] py-1 text-xs"
					style="min-height: 32px"
				>
					<option value="">All</option>
					{#each data.locations as loc (loc.id)}
						<option value={loc.code}>{loc.code} · {loc.name}</option>
					{/each}
				</select>
			</label>

			<label class="flex items-center gap-1.5">
				<span class="eyebrow">Tracking</span>
				<select
					value={data.filters.tracking}
					onchange={(e) => goto(withParam('tracking', e.currentTarget.value))}
					class="field max-w-[140px] py-1 text-xs"
					style="min-height: 32px"
				>
					<option value="">All</option>
					<option value="serialized">Serialized</option>
					<option value="stocked">Stocked</option>
				</select>
			</label>

			<label class="flex items-center gap-1.5">
				<input
					type="checkbox"
					checked={data.filters.has_photo}
					onchange={(e) => goto(withParam('has_photo', e.currentTarget.checked ? '1' : ''))}
					class="h-4 w-4 accent-[color:var(--color-gold)]"
					style="min-height: auto"
				/>
				<span class="text-[color:var(--color-ink-2)]">Has photo</span>
			</label>

			<label class="flex items-center gap-1.5">
				<input
					type="checkbox"
					checked={data.filters.retired}
					onchange={(e) => goto(withParam('retired', e.currentTarget.checked ? '1' : ''))}
					class="h-4 w-4 accent-[color:var(--color-gold)]"
					style="min-height: auto"
				/>
				<span class="text-[color:var(--color-ink-2)]">Show retired</span>
			</label>
		</div>

		<!-- Active filter chips (only shows when filters are actually set) -->
		{#if data.anyFilterActive}
			<div class="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line-dim)] pt-2 text-xs">
				<span class="eyebrow">{data.items.length} result{data.items.length === 1 ? '' : 's'}</span>
				{#if data.filters.q}
					<a href={withParam('q', '')} class="pill pill-warn hover:underline">
						"{data.filters.q}" ✕
					</a>
				{/if}
				{#if categoryLabel}
					<a href={withParam('category', '')} class="pill hover:underline">
						{categoryLabel} ✕
					</a>
				{/if}
				{#if data.filters.condition}
					<a href={withParam('condition', '')} class="pill hover:underline">
						{CONDITION_LABEL[data.filters.condition] ?? data.filters.condition} ✕
					</a>
				{/if}
				{#if locationLabel}
					<a href={withParam('location', '')} class="pill hover:underline">
						{locationLabel} ✕
					</a>
				{/if}
				{#if data.filters.tracking}
					<a href={withParam('tracking', '')} class="pill hover:underline">
						{data.filters.tracking} ✕
					</a>
				{/if}
				{#if data.filters.has_photo}
					<a href={withParam('has_photo', '')} class="pill hover:underline">Has photo ✕</a>
				{/if}
				{#if data.filters.retired}
					<a href={withParam('retired', '')} class="pill pill-danger hover:underline">
						Including retired ✕
					</a>
				{/if}
			</div>
		{/if}
	</div>

	<!-- ============= Items table ============= -->
	{#if data.items.length === 0}
		<div class="panel flex flex-col items-center gap-2 px-6 py-16 text-center">
			{#if data.anyFilterActive}
				<p class="headline text-xl text-[color:var(--color-ink-2)]">No matches.</p>
				<p class="text-sm text-[color:var(--color-ink-3)]">
					Try loosening the filters or
					<a href="/items" class="text-[color:var(--color-gold-bright)] underline">clear all</a>.
				</p>
			{:else}
				<p class="headline text-xl text-[color:var(--color-ink-2)]">Nothing on the bench yet.</p>
				<a href="/items/new" class="btn-primary mt-2">+ Add the first one</a>
			{/if}
		</div>
	{:else}
		<div class="panel overflow-hidden">
			<table class="w-full text-sm">
				<thead
					class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]"
				>
					<tr class="text-left">
						<th class="eyebrow w-14 px-2 py-2.5"></th>
						<th class="eyebrow px-3 py-2.5">SKU</th>
						<th class="eyebrow px-3 py-2.5">Title</th>
						<th class="eyebrow px-3 py-2.5">Condition</th>
						<th class="eyebrow px-3 py-2.5">Where</th>
						<th class="eyebrow px-3 py-2.5 text-right">Qty</th>
						<th class="eyebrow px-3 py-2.5 text-right">Price</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.items as item (item.id)}
						<tr
							class="cursor-pointer transition-colors hover:bg-[color:var(--color-hover)] {item.retired_at
								? 'text-[color:var(--color-ink-4)]'
								: ''}"
							onclick={() => (window.location.href = `/items/${encodeURIComponent(item.sku)}`)}
						>
							<!-- Thumbnail (or muted placeholder) -->
							<td class="px-2 py-1.5">
								{#if item.thumb_r2_key}
									<img
										src="/api/photos/{item.thumb_r2_key}"
										alt=""
										class="h-12 w-12 rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] object-cover"
										loading="lazy"
									/>
								{:else}
									<div
										class="flex h-12 w-12 items-center justify-center rounded border border-dashed border-[color:var(--color-line-dim)] text-[10px] italic text-[color:var(--color-ink-4)]"
									>
										no img
									</div>
								{/if}
							</td>

							<td class="px-3 py-2.5">
								<a
									href="/items/{encodeURIComponent(item.sku)}"
									class="font-mono text-xs text-[color:var(--color-gold)] hover:text-[color:var(--color-gold-bright)]"
									onclick={(e) => e.stopPropagation()}
								>
									{item.sku}
								</a>
							</td>
							<td class="px-3 py-2.5">
								<div class="font-medium text-[color:var(--color-ink)]">{item.title}</div>
								<div class="text-xs text-[color:var(--color-ink-3)]">
									{item.category_name}{item.brand_name ? ` · ${item.brand_name}` : ''}
								</div>
							</td>
							<td class="px-3 py-2.5">
								<span class={CONDITION_PILL[item.condition] ?? 'pill'}>
									{CONDITION_LABEL[item.condition] ?? item.condition}
								</span>
							</td>
							<td class="px-3 py-2.5 text-xs text-[color:var(--color-ink-2)]">
								{#if item.location_code && item.bin_code}
									<span class="font-mono">{item.location_code}</span>
									<span class="text-[color:var(--color-ink-4)]">/</span>
									<span class="font-mono">{item.bin_code}</span>
								{:else}
									<span class="italic text-[color:var(--color-ink-4)]">unassigned</span>
								{/if}
							</td>
							<td class="px-3 py-2.5 text-right font-mono text-xs text-[color:var(--color-ink-2)]">
								{item.tracking_mode === 'stocked' ? item.stock_qty : 1}
							</td>
							<td class="px-3 py-2.5 text-right font-mono text-[color:var(--color-ink)]">
								{formatPrice(item.price_cents)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
