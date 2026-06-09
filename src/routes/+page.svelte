<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function formatMoney(cents: number): string {
		const dollars = cents / 100;
		if (dollars >= 10000) return `$${(dollars / 1000).toFixed(1)}k`;
		return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
	}

	function shortWhen(iso: string): string {
		const t = new Date(iso.replace(' ', 'T') + 'Z');
		const diffMin = Math.round((Date.now() - t.getTime()) / 60000);
		if (diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m`;
		const diffHr = Math.round(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h`;
		const diffDay = Math.round(diffHr / 24);
		if (diffDay < 30) return `${diffDay}d`;
		return t.toLocaleDateString();
	}

	// Movement kind → display + colour. The dot in the timeline picks up
	// the colour; same vocabulary as the audit ledger so Dad sees
	// consistent meaning across the app.
	const KIND_META: Record<string, { label: string; dot: string }> = {
		receive: { label: 'Received', dot: 'bg-[color:var(--color-moss-bright)]' },
		transfer: { label: 'Transferred', dot: 'bg-[color:var(--color-ink-3)]' },
		sale: { label: 'Sold', dot: 'bg-[color:var(--color-gold-bright)]' },
		scrap: { label: 'Scrapped', dot: 'bg-[color:var(--color-rust-bright)]' },
		adjust: { label: 'Adjusted', dot: 'bg-[color:var(--color-ink-3)]' },
		build_consume: { label: 'Used in build', dot: 'bg-[color:var(--color-gold)]' },
		build_produce: { label: 'Built', dot: 'bg-[color:var(--color-moss-bright)]' }
	};

	// Derived: max count across top categories, used as the bar denominator.
	let topMax = $derived(Math.max(1, ...data.topCategories.map((c) => c.n)));
</script>

<section class="space-y-8">
	<!-- ============= Hero band ============= -->
	<header
		class="panel relative overflow-hidden px-6 py-6 sm:px-8 sm:py-8"
		style="background: radial-gradient(circle at 20% 10%, rgba(178,147,91,0.10) 0%, transparent 60%), var(--color-panel);"
	>
		<!-- Decorative scan-line glow on the right edge -->
		<div
			class="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-30"
			style="background: radial-gradient(ellipse at 90% 50%, rgba(214,176,116,0.15) 0%, transparent 70%);"
		></div>

		<div class="relative space-y-2">
			<p class="eyebrow">Shop floor</p>
			<h1 class="headline text-3xl sm:text-4xl">
				{data.stats.weekActivity > 0
					? `${data.stats.weekActivity} ${data.stats.weekActivity === 1 ? 'movement' : 'movements'} this week.`
					: 'Quiet week.'}
			</h1>
			<p class="max-w-xl text-sm text-[color:var(--color-ink-3)]">
				One row per part, one source of truth. Squarespace mirrors what lives here — never the other way around.
			</p>
		</div>
	</header>

	<!-- ============= KPI tiles ============= -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<a
			href="/items"
			class="panel group flex flex-col gap-1.5 px-5 py-5 transition-all hover:-translate-y-0.5 hover:border-[color:var(--color-gold-dim)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
		>
			<span class="eyebrow">Items on hand</span>
			<span
				class="headline text-4xl text-[color:var(--color-ink)] transition-colors group-hover:text-[color:var(--color-gold-bright)]"
			>
				{data.stats.itemsOnHand}
			</span>
			<span class="font-mono text-[10px] text-[color:var(--color-ink-3)]">
				{data.stats.onHandQty.toLocaleString()} units · {data.stats.activeCategories} categories
			</span>
		</a>

		<div class="panel flex flex-col gap-1.5 px-5 py-5">
			<span class="eyebrow">Inventory value</span>
			<span class="headline text-4xl text-[color:var(--color-gold-bright)]">
				{formatMoney(data.stats.inventoryValueCents)}
			</span>
			<span class="font-mono text-[10px] text-[color:var(--color-ink-3)]">
				priced × on-hand qty
			</span>
		</div>

		<a
			href="/movements"
			class="panel group flex flex-col gap-1.5 px-5 py-5 transition-all hover:-translate-y-0.5 hover:border-[color:var(--color-gold-dim)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
		>
			<span class="eyebrow">Activity · 7d</span>
			<span
				class="headline text-4xl text-[color:var(--color-ink)] transition-colors group-hover:text-[color:var(--color-gold-bright)]"
			>
				{data.stats.weekActivity}
			</span>
			<span class="font-mono text-[10px] text-[color:var(--color-ink-3)]">
				of {data.stats.movements.toLocaleString()} total
			</span>
		</a>

		<a
			href="/locations"
			class="panel group flex flex-col gap-1.5 px-5 py-5 transition-all hover:-translate-y-0.5 hover:border-[color:var(--color-gold-dim)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
		>
			<span class="eyebrow">Locations</span>
			<span
				class="headline text-4xl text-[color:var(--color-ink)] transition-colors group-hover:text-[color:var(--color-gold-bright)]"
			>
				{data.stats.locations}
			</span>
			<span class="font-mono text-[10px] text-[color:var(--color-ink-3)]">
				bins inside each
			</span>
		</a>
	</div>

	<!-- ============= Quick actions ============= -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<a
			href="/labels"
			class="quick-action group"
			style="--accent: var(--color-gold-bright)"
		>
			<span class="quick-emoji">⊕</span>
			<span class="quick-label">Receive stock</span>
			<span class="quick-sub">+ print labels</span>
		</a>
		<a
			href="/scan"
			class="quick-action group"
			style="--accent: var(--color-moss-bright)"
		>
			<span class="quick-emoji">⚆</span>
			<span class="quick-label">Scan</span>
			<span class="quick-sub">picking · stock-take</span>
		</a>
		<a
			href="/items/new"
			class="quick-action group"
			style="--accent: var(--color-ink)"
		>
			<span class="quick-emoji">＋</span>
			<span class="quick-label">Add item</span>
			<span class="quick-sub">manual entry</span>
		</a>
		<a
			href="/import/squarespace"
			class="quick-action group"
			style="--accent: var(--color-terra)"
		>
			<span class="quick-emoji">↻</span>
			<span class="quick-label">Sync</span>
			<span class="quick-sub">Squarespace import</span>
		</a>
	</div>

	<!-- ============= Activity + Top categories ============= -->
	<div class="grid gap-4 lg:grid-cols-[3fr_2fr]">
		<!-- Recent activity timeline -->
		<section class="panel space-y-3 px-5 py-5">
			<div class="flex items-baseline justify-between">
				<p class="eyebrow">Recent activity</p>
				<a
					href="/movements"
					class="text-xs text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
				>
					See all →
				</a>
			</div>

			{#if data.recentMovements.length === 0}
				<p class="py-6 text-center text-sm italic text-[color:var(--color-ink-4)]">
					No movements yet — receive an item to break the ice.
				</p>
			{:else}
				<ol class="relative space-y-3 pl-4">
					<!-- Vertical line behind the dots -->
					<span
						aria-hidden="true"
						class="absolute left-1.5 top-2 bottom-2 w-px bg-[color:var(--color-line-dim)]"
					></span>

					{#each data.recentMovements as m (m.id)}
						{@const meta = KIND_META[m.kind] ?? { label: m.kind, dot: 'bg-[color:var(--color-ink-3)]' }}
						<li class="relative flex items-start gap-3">
							<!-- Timeline dot -->
							<span
								class="absolute -left-2.5 mt-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-[color:var(--color-panel)] {meta.dot}"
							></span>

							<div class="min-w-0 flex-1 pl-2">
								<div class="flex items-baseline justify-between gap-2">
									<span class="text-sm font-medium text-[color:var(--color-ink)]">
										{meta.label}
										{#if m.quantity > 1}
											<span class="font-mono text-xs text-[color:var(--color-ink-3)]">
												× {m.quantity}
											</span>
										{/if}
									</span>
									<span class="font-mono text-[10px] text-[color:var(--color-ink-4)]" title={m.created_at}>
										{shortWhen(m.created_at)}
									</span>
								</div>
								<a
									href="/items/{encodeURIComponent(m.sku)}"
									class="block font-mono text-[10px] text-[color:var(--color-gold)] hover:text-[color:var(--color-gold-bright)]"
								>
									{m.sku}
								</a>
								<p class="truncate text-xs text-[color:var(--color-ink-2)]">{m.title}</p>
								{#if m.note}
									<p class="truncate text-[11px] italic text-[color:var(--color-ink-3)]">{m.note}</p>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<!-- Top categories bar chart -->
		<section class="panel space-y-3 px-5 py-5">
			<div class="flex items-baseline justify-between">
				<p class="eyebrow">Top categories</p>
				<a
					href="/categories"
					class="text-xs text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
				>
					All →
				</a>
			</div>

			{#if data.topCategories.length === 0}
				<p class="py-6 text-center text-sm italic text-[color:var(--color-ink-4)]">
					No categories with stock yet.
				</p>
			{:else}
				<ul class="space-y-2.5">
					{#each data.topCategories as cat (cat.code)}
						{@const pct = (cat.n / topMax) * 100}
						<li>
							<a
								href="/items?category={encodeURIComponent(cat.code)}"
								class="group block"
							>
								<div class="flex items-baseline justify-between gap-2 text-xs">
									<span class="text-[color:var(--color-ink-2)] transition-colors group-hover:text-[color:var(--color-ink)]">
										<span class="font-mono text-[10px] text-[color:var(--color-gold)]">{cat.code}</span>
										<span class="ml-1.5">{cat.name}</span>
									</span>
									<span class="font-mono text-[color:var(--color-ink-3)]">{cat.n}</span>
								</div>
								<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[color:var(--color-input)]">
									<div
										class="h-full rounded-full transition-all duration-300 group-hover:brightness-110"
										style="width: {pct}%; background: linear-gradient(90deg, var(--color-gold-dim), var(--color-gold-bright));"
									></div>
								</div>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<!-- ============= Recently added items grid ============= -->
	{#if data.recentItems.length > 0}
		<section class="space-y-3">
			<div class="flex items-baseline justify-between">
				<p class="eyebrow">Recently added</p>
				<a
					href="/items"
					class="text-xs text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
				>
					Browse all →
				</a>
			</div>

			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
				{#each data.recentItems as item (item.id)}
					<a
						href="/items/{encodeURIComponent(item.sku)}"
						class="panel group flex flex-col gap-2 overflow-hidden p-2 transition-all hover:-translate-y-0.5 hover:border-[color:var(--color-gold-dim)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
					>
						<div class="aspect-square overflow-hidden rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)]">
							{#if item.thumb_r2_key}
								<img
									src="/api/photos/{item.thumb_r2_key}"
									alt={item.title}
									class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
									loading="lazy"
								/>
							{:else}
								<div
									class="flex h-full w-full items-center justify-center text-[10px] italic text-[color:var(--color-ink-4)]"
								>
									no image
								</div>
							{/if}
						</div>
						<div class="min-w-0 px-1">
							<p class="truncate font-mono text-[10px] text-[color:var(--color-gold)]">
								{item.cat_code}
							</p>
							<p
								class="truncate text-xs text-[color:var(--color-ink-2)] transition-colors group-hover:text-[color:var(--color-ink)]"
								title={item.title}
							>
								{item.title}
							</p>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}
</section>

<style>
	.quick-action {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		padding: 1rem 1.25rem;
		background: var(--color-panel);
		border: 1px solid var(--color-line-dim);
		border-radius: 6px;
		text-decoration: none;
		transition: all 0.18s ease;
		position: relative;
		overflow: hidden;
	}
	.quick-action::before {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at 100% 0%, var(--accent) 0%, transparent 70%);
		opacity: 0;
		transition: opacity 0.2s ease;
		pointer-events: none;
	}
	.quick-action:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
	}
	.quick-action:hover::before {
		opacity: 0.08;
	}
	.quick-emoji {
		font-size: 1.5rem;
		line-height: 1;
		color: var(--accent);
		text-shadow: 0 0 16px var(--accent);
	}
	.quick-label {
		font-family: var(--font-display);
		font-style: italic;
		font-weight: 500;
		font-size: 1.05rem;
		color: var(--color-ink);
	}
	.quick-sub {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		letter-spacing: 0.04em;
		color: var(--color-ink-3);
		text-transform: uppercase;
	}
</style>
