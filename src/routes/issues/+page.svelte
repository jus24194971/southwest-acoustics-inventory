<script lang="ts">
	import { page } from '$app/state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const enc = encodeURIComponent;
	const fixed = $derived(page.url.searchParams.get('fixed'));
</script>

<section class="space-y-5">
	<header class="space-y-2">
		<p class="text-xs text-[color:var(--color-ink-3)]">Validation · self-cleaning queue</p>
		<h1 class="headline text-3xl leading-tight">Issues to resolve</h1>
		<p class="max-w-2xl text-sm text-[color:var(--color-ink-2)]">
			A live check of every inventory rule. Fix an item and it drops off here automatically —
			when this page is green, every process produced clean data. Nothing changes on its own;
			each fix is your call.
		</p>
	</header>

	{#if fixed === 'stocked'}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss-bright)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">✓ Switched to Stocked — count kept.</p>
		</div>
	{/if}

	{#if data.total === 0}
		<div class="panel space-y-2 px-6 py-10 text-center">
			<p class="text-3xl">✓</p>
			<p class="text-lg text-[color:var(--color-ink)]">All clear</p>
			<p class="text-sm text-[color:var(--color-ink-3)]">No unresolved issues. Every rule passes.</p>
		</div>
	{:else}
		<div class="panel px-4 py-3">
			<p class="text-sm text-[color:var(--color-ink-2)]">
				<strong class="text-[color:var(--color-gold-bright)]">{data.total}</strong> group(s) need attention.
			</p>
		</div>
	{/if}

	<!-- ============ Duplicate Squarespace links ============ -->
	{#if data.dupeGroups.length > 0}
		<div class="panel space-y-3 px-5 py-4">
			<h2 class="text-sm font-semibold text-[color:var(--color-ink)]">
				🔁 Duplicate Squarespace links · {data.dupeGroups.length}
			</h2>
			<p class="text-[12px] text-[color:var(--color-ink-3)]">
				Multiple inventory items point at the same Squarespace product. Merge the true
				duplicates into the keeper (the first one). A few may be legitimate variants — your call;
				skip those.
			</p>
			{#each data.dupeGroups as g (g.externalId)}
				<div class="rounded border border-[color:var(--color-line-dim)] px-3 py-2">
					<p class="mb-1 font-mono text-[10px] text-[color:var(--color-ink-4)]">
						SS product …{g.externalId.slice(-10)} · {g.items.length} items
					</p>
					{#each g.items as it, i (it.id)}
						<div class="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line-dim)] py-1.5 first:border-t-0">
							<a
								href="/items/{enc(it.sku)}"
								class="min-w-0 flex-1 truncate text-sm text-[color:var(--color-ink)] hover:text-[color:var(--color-gold-bright)]"
							>
								{it.title}
							</a>
							<span class="font-mono text-[10px] text-[color:var(--color-ink-4)]">{it.sku}</span>
							{#if i === 0}
								<span class="pill pill-success text-[10px]">keeper</span>
							{:else}
								<a
									href="/items/{enc(g.items[0].sku)}/merge/{enc(it.sku)}"
									class="btn-ghost px-2.5 py-1 text-[11px] whitespace-nowrap"
								>
									Merge into keeper →
								</a>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
		</div>
	{/if}

	<!-- ============ Stock vs tracking (review bucket) ============ -->
	{#if data.badStock.length > 0}
		<div class="panel space-y-3 px-5 py-4">
			<h2 class="text-sm font-semibold text-[color:var(--color-ink)]">
				📦 Stock doesn’t match tracking · {data.badStock.length}
			</h2>
			<p class="text-[12px] text-[color:var(--color-ink-3)]">
				Flagged one-off (serialized) but holding multiple units — these look like consumables /
				parts the import mis-flagged. Review each: <strong>Switch to Stocked</strong> keeps the count
				and clears the flag. Nothing changes until you click.
			</p>
			{#each data.badStock as it (it.id)}
				<div class="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line-dim)] pt-2 first:border-t-0">
					<a
						href="/items/{enc(it.sku)}"
						class="min-w-0 flex-1 truncate text-sm text-[color:var(--color-ink)] hover:text-[color:var(--color-gold-bright)]"
					>
						{it.title}
					</a>
					<span class="font-mono text-[10px] text-[color:var(--color-ink-4)]">{it.sku}</span>
					<span class="pill pill-warn text-[10px] whitespace-nowrap">{it.cat_code} · {it.stock_qty} on hand</span>
					<form method="POST" action="?/switchToStocked">
						<input type="hidden" name="item_id" value={it.id} />
						<button type="submit" class="btn-ghost px-2.5 py-1 text-[11px] whitespace-nowrap">
							Switch to Stocked
						</button>
					</form>
				</div>
			{/each}
		</div>
	{/if}

	<!-- ============ No description ============ -->
	{#if data.noDesc.length > 0}
		<div class="panel space-y-3 px-5 py-4">
			<h2 class="text-sm font-semibold text-[color:var(--color-ink)]">
				📝 No description · {data.noDesc.length}
			</h2>
			<p class="text-[12px] text-[color:var(--color-ink-3)]">
				Items on Squarespace fill from <a href="/listings/health" class="text-[color:var(--color-gold-bright)] hover:underline">Listing health → Pull descriptions</a>;
				the rest get the title on their next save. Open one to add copy now.
			</p>
			{#each data.noDesc as it (it.id)}
				<div class="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line-dim)] pt-2 first:border-t-0">
					<a
						href="/items/{enc(it.sku)}"
						class="min-w-0 flex-1 truncate text-sm text-[color:var(--color-ink)] hover:text-[color:var(--color-gold-bright)]"
					>
						{it.title}
					</a>
					<span class="font-mono text-[10px] text-[color:var(--color-ink-4)]">{it.sku}</span>
					{#if it.on_ss > 0}
						<span class="pill text-[10px]">on Squarespace</span>
					{:else}
						<span class="pill pill-warn text-[10px]">not listed</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- ============ Retired but sellable ============ -->
	{#if data.retiredSellable.length > 0}
		<div class="panel space-y-3 px-5 py-4">
			<h2 class="text-sm font-semibold text-[color:var(--color-ink)]">
				🚫 Retired but still sellable · {data.retiredSellable.length}
			</h2>
			<p class="text-[12px] text-[color:var(--color-ink-3)]">
				Retired yet still flagged sellable — open each and clear “sellable” (or un-retire it).
			</p>
			{#each data.retiredSellable as it (it.id)}
				<div class="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line-dim)] pt-2 first:border-t-0">
					<a
						href="/items/{enc(it.sku)}"
						class="min-w-0 flex-1 truncate text-sm text-[color:var(--color-ink)] hover:text-[color:var(--color-gold-bright)]"
					>
						{it.title}
					</a>
					<span class="font-mono text-[10px] text-[color:var(--color-ink-4)]">{it.sku}</span>
				</div>
			{/each}
		</div>
	{/if}
</section>
