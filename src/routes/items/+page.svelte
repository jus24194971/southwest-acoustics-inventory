<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import InfoTip from '$lib/components/InfoTip.svelte';

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

	/**
	 * Format an ISO-ish timestamp (SQLite's `YYYY-MM-DD HH:MM:SS` UTC)
	 * as a human-friendly relative + absolute string. Recent edits
	 * read "2h ago", older ones drop back to the date. Tooltip shows
	 * the full date for hover.
	 */
	function formatModified(ts: string | null): { label: string; tooltip: string } {
		if (!ts) return { label: '—', tooltip: '' };
		// SQLite returns "YYYY-MM-DD HH:MM:SS" in UTC. Browsers parse
		// that as local-time unless we glue a 'Z' on.
		const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return { label: ts, tooltip: ts };
		const now = Date.now();
		const diffMs = now - d.getTime();
		const sec = Math.floor(diffMs / 1000);
		const min = Math.floor(sec / 60);
		const hr = Math.floor(min / 60);
		const day = Math.floor(hr / 24);

		let label: string;
		if (sec < 45) label = 'just now';
		else if (min < 60) label = `${min}m ago`;
		else if (hr < 24) label = `${hr}h ago`;
		else if (day < 7) label = `${day}d ago`;
		else if (day < 30) label = `${Math.floor(day / 7)}w ago`;
		else
			label = d.toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			});
		const tooltip = d.toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
		return { label, tooltip };
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

	/**
	 * Build a header URL that sorts by `key`. Clicking the column
	 * that's already the active sort toggles the direction. Clicking
	 * a different column resets to that column's natural default
	 * direction (the server picks asc vs desc per column).
	 *
	 * For the default-sort case (no explicit `dir` in URL), we don't
	 * set `dir` on the link — keeps the URL clean. Subsequent toggle
	 * clicks force the explicit dir param.
	 */
	function sortHref(key: string): string {
		const next = new URLSearchParams(page.url.searchParams);
		const currentKey = data.sort.key;
		const currentDir = data.sort.dir;
		if (currentKey === key) {
			// Toggling current column — flip the direction explicitly.
			next.set('sort', key);
			next.set('dir', currentDir === 'asc' ? 'desc' : 'asc');
		} else {
			// New column — use its natural default direction by not
			// passing dir at all (server reads the column's defaultDir).
			next.set('sort', key);
			next.delete('dir');
		}
		const qs = next.toString();
		return qs ? `/items?${qs}` : '/items';
	}

	/** Arrow glyph next to the active-sort header. */
	function sortIndicator(key: string): string {
		if (data.sort.key !== key) return '';
		return data.sort.dir === 'asc' ? ' ▲' : ' ▼';
	}

	// Tailwind class string for every sortable header link. Hoisted
	// out of the markup so we don't repeat it eight times in the
	// table head. (Svelte's {@const} can only live inside #if/#each/
	// snippet/component scopes, not as a direct child of <div>.)
	const sortLinkClass =
		'inline-flex items-baseline gap-1 hover:text-[color:var(--color-gold-bright)] transition-colors';

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
				<span class="eyebrow inline-flex items-center gap-0.5">
					Tracking
					<InfoTip title="Serialized vs Stocked">
						<p>
							<strong>Serialized</strong> = one specific physical unit (a used guitar with
							its own story). Stays at 0 or 1; the listing is preserved as "out of stock"
							when sold.
						</p>
						<p>
							<strong>Stocked</strong> = interchangeable inventory (strings, picks, new
							parts). Any non-negative quantity.
						</p>
					</InfoTip>
				</span>
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
			<!-- Sortable header cells: every column with a meaningful order is
				 a link. Active-sort column shows a ▲/▼ glyph and a brighter
				 color so it stands out. Click the same column to flip
				 direction; click a different column to switch to its natural
				 default direction (text → asc, numeric/date → desc).
				 `sortLinkClass` lives in the <script> block above. -->
			<table class="w-full text-sm">
				<thead
					class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]"
				>
					<tr class="text-left">
						<th class="eyebrow w-14 px-2 py-2.5"></th>
						<th class="eyebrow px-3 py-2.5">
							<a
								href={sortHref('sku')}
								class={sortLinkClass}
								class:text-[color:var(--color-gold-bright)]={data.sort.key === 'sku'}
							>
								SKU{sortIndicator('sku')}
							</a>
						</th>
						<th class="eyebrow px-3 py-2.5">
							<a
								href={sortHref('title')}
								class={sortLinkClass}
								class:text-[color:var(--color-gold-bright)]={data.sort.key === 'title'}
							>
								Title{sortIndicator('title')}
							</a>
							<span class="ml-2 normal-case text-[color:var(--color-ink-4)]">
								·
								<a
									href={sortHref('category')}
									class="hover:text-[color:var(--color-gold-bright)] transition-colors"
									class:text-[color:var(--color-gold-bright)]={data.sort.key === 'category'}
								>
									Category{sortIndicator('category')}
								</a>
							</span>
						</th>
						<th class="eyebrow px-3 py-2.5">
							<a
								href={sortHref('condition')}
								class={sortLinkClass}
								class:text-[color:var(--color-gold-bright)]={data.sort.key === 'condition'}
							>
								Condition{sortIndicator('condition')}
							</a>
						</th>
						<th class="eyebrow px-3 py-2.5">
							<a
								href={sortHref('location')}
								class={sortLinkClass}
								class:text-[color:var(--color-gold-bright)]={data.sort.key === 'location'}
							>
								Where{sortIndicator('location')}
							</a>
						</th>
						<th class="eyebrow px-3 py-2.5 text-right">
							<a
								href={sortHref('qty')}
								class="{sortLinkClass} justify-end"
								class:text-[color:var(--color-gold-bright)]={data.sort.key === 'qty'}
							>
								Qty{sortIndicator('qty')}
							</a>
						</th>
						<th class="eyebrow px-3 py-2.5 text-right">
							<a
								href={sortHref('price')}
								class="{sortLinkClass} justify-end"
								class:text-[color:var(--color-gold-bright)]={data.sort.key === 'price'}
							>
								Price{sortIndicator('price')}
							</a>
						</th>
						<th class="eyebrow px-3 py-2.5 text-right">
							<a
								href={sortHref('modified')}
								class="{sortLinkClass} justify-end"
								class:text-[color:var(--color-gold-bright)]={data.sort.key === 'modified'}
								title="Last time this item's record was edited"
							>
								Modified{sortIndicator('modified')}
							</a>
						</th>
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
								<!-- stock_qty drives both modes now — serialized listings
								     with qty=0 are "out of stock, restock pending" and get
								     a gold tint so they stand out in scans. -->
								<span class={item.stock_qty === 0 ? 'text-[color:var(--color-gold-bright)]' : ''}>
									{item.stock_qty}
								</span>
							</td>
							<td class="px-3 py-2.5 text-right font-mono text-[color:var(--color-ink)]">
								{formatPrice(item.price_cents)}
							</td>
							<!-- Modified: relative for fresh edits ("2h ago"), absolute
								 for anything beyond a month. Tooltip carries the full
								 timestamp for hover. Inlining formatModified() twice
								 here is cheaper than restructuring around {@const} —
								 the helper is O(1) (single Date construction). -->
							<td
								class="px-3 py-2.5 text-right font-mono text-xs text-[color:var(--color-ink-3)] whitespace-nowrap"
								title={formatModified(item.updated_at).tooltip}
							>
								{formatModified(item.updated_at).label}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
