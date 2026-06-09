<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let checking = $state(false);
	let relinking = $state(false);
	let pullingDesc = $state(false);

	// These actions redirect back to THIS page, so the global form interceptor
	// re-runs the load and reuses this component instance — which means these
	// in-flight flags would otherwise stay `true` and leave the buttons frozen
	// at "…ing" even though the work finished (the real cause of the "seems
	// stuck / didn't refresh" feeling). Clear them once navigation lands.
	afterNavigate(() => {
		checking = false;
		relinking = false;
		pullingDesc = false;
	});

	const descFilled = $derived(parseInt(page.url.searchParams.get('desc_filled') ?? '', 10));
	const descHad = $derived(page.url.searchParams.get('desc_had'));
	const descNoSrc = $derived(page.url.searchParams.get('desc_nosrc'));
	const descItems = $derived(page.url.searchParams.get('desc_items'));

	const relinked = $derived(parseInt(page.url.searchParams.get('relinked') ?? '', 10));
	const relinkAi = $derived(page.url.searchParams.get('aimatched'));
	const relinkAlready = $derived(page.url.searchParams.get('already'));
	const relinkUnmatched = $derived(page.url.searchParams.get('unmatched'));
	const relinkScanned = $derived(page.url.searchParams.get('scanned'));
	const checked = $derived(parseInt(page.url.searchParams.get('checked') ?? '', 10));
	const live = $derived(page.url.searchParams.get('live'));
	const orphaned = $derived(page.url.searchParams.get('orphaned'));
	const errors = $derived(page.url.searchParams.get('errors'));

	function rowStatus(r: PageData['rows'][number]): { label: string; cls: string } {
		if (!r.external_id) return { label: 'not listed', cls: 'pill' };
		if (r.last_sync_status === 'error') return { label: 'error', cls: 'pill pill-danger' };
		return { label: 'live', cls: 'pill pill-success' };
	}

	function shortWhen(iso: string | null): string {
		if (!iso) return 'never';
		const t = new Date(iso.replace(' ', 'T') + 'Z');
		if (isNaN(t.getTime())) return iso.slice(0, 10);
		return t.toLocaleDateString();
	}
</script>

<section class="space-y-5">
	<header class="space-y-2">
		<p class="text-xs text-[color:var(--color-ink-3)]">
			<a href="/listings" class="hover:underline">Listings</a> · Squarespace health
		</p>
		<h1 class="headline text-3xl leading-tight">Listing health</h1>
		<p class="max-w-2xl text-sm text-[color:var(--color-ink-2)]">
			Checks every Squarespace listing link against the live store. <strong>Live</strong> ones get
			their stored info refreshed; <strong>orphaned</strong> ones (deleted on Squarespace) have their
			link cleared so they relist on the next push; <strong>errors</strong> show exactly what
			Squarespace said.
		</p>
	</header>

	{#if data.loadError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">Page load error:</p>
			<pre class="mt-1 max-h-48 overflow-auto font-mono text-[10px] whitespace-pre-wrap text-[color:var(--color-ink-3)]">{data.loadError}</pre>
		</div>
	{/if}

	{#if form?.error}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.error}</p>
		</div>
	{/if}

	{#if Number.isInteger(checked)}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss-bright)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				✓ Checked {checked} — {live} live{#if Number(orphaned) > 0}, <span class="text-[color:var(--color-gold-bright)]">{orphaned} orphaned (cleared)</span>{/if}{#if Number(errors) > 0}, <span class="text-[color:var(--color-rust-bright)]">{errors} errored</span>{/if}.
			</p>
		</div>
	{/if}

	{#if Number.isInteger(relinked)}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss-bright)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				🔗 Relinked <strong>{relinked}</strong> item(s) to their current Squarespace product by title
				{#if Number(relinkAi) > 0}({relinkAi} via AI match){/if} — real URLs + slugs stored, so
				updates now hit the right product.
			</p>
			<p class="mt-1 text-[11px] text-[color:var(--color-ink-3)]">
				{relinkAlready} already correct · {relinkUnmatched} no title match (not on Squarespace, or needs
				a fresh push) · scanned {relinkScanned} products.
			</p>
		</div>
	{/if}

	{#if Number.isInteger(descFilled)}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss-bright)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				⬇ Filled <strong>{descFilled}</strong> item description(s) from Squarespace as a baseline —
				items with no copy yet now have their live Squarespace text to start from on eBay / Reverb.
			</p>
			<p class="mt-1 text-[11px] text-[color:var(--color-ink-3)]">
				{descHad} already had a description (left untouched) · {descNoSrc} had nothing on Squarespace
				to pull · {descItems} Squarespace-linked items checked.
			</p>
		</div>
	{/if}

	<div class="panel flex flex-wrap items-center gap-3 px-4 py-3">
		<p class="text-sm text-[color:var(--color-ink-2)]">
			<strong>{data.counts.linked}</strong> linked · {data.counts.unlinked} not listed ·
			{#if data.counts.errored > 0}
				<span class="text-[color:var(--color-rust-bright)]">{data.counts.errored} need attention</span>
			{:else}
				<span class="text-[color:var(--color-moss-bright)]">all healthy</span>
			{/if}
		</p>
		<form
			method="POST"
			action="?/pullDescriptions"
			class="ml-auto"
			onsubmit={() => (pullingDesc = true)}
		>
			<button
				type="submit"
				class="btn-ghost px-4 py-2 text-sm whitespace-nowrap"
				disabled={pullingDesc}
				title="Pull each linked item's description from Squarespace as a baseline — only fills items that have none, never overwrites"
			>
				{pullingDesc ? 'Pulling…' : '⬇ Pull descriptions'}
			</button>
		</form>
		<form method="POST" action="?/relink" onsubmit={() => (relinking = true)}>
			<button
				type="submit"
				class="btn-ghost px-4 py-2 text-sm whitespace-nowrap"
				disabled={relinking}
				title="Scan the whole Squarespace catalog and link any unlinked items to their real product"
			>
				{relinking ? 'Relinking…' : '🔗 Relink all'}
			</button>
		</form>
		<form method="POST" action="?/check" onsubmit={() => (checking = true)}>
			<button
				type="submit"
				class="btn-primary px-4 py-2 text-sm whitespace-nowrap"
				disabled={checking}
				title="Check every linked listing against the live Squarespace store and refresh its status + open link"
			>
				{checking
					? 'Verifying all links…'
					: `↻ Verify all${data.counts.linked ? ` (${data.counts.linked})` : ''}`}
			</button>
		</form>
	</div>

	{#if checking}
		<p class="text-[11px] text-[color:var(--color-gold-bright)]">
			Scanning the live Squarespace catalog and checking every link — just a few seconds. The
			page refreshes itself when it’s done; no need to reload.
		</p>
	{:else}
		<p class="text-[11px] text-[color:var(--color-ink-3)]">
			Verifies every linked listing at once: live ones get their status + “open ↗” link
			refreshed, and any that were deleted on Squarespace get their link cleared so they relist on
			the next push.
		</p>
	{/if}

	<div class="overflow-hidden rounded border border-[color:var(--color-line-dim)]">
		{#each data.rows as r (r.item_id)}
			{@const st = rowStatus(r)}
			<div class="flex items-center gap-3 border-b border-[color:var(--color-line-dim)] px-3 py-2 last:border-b-0">
				<span class="{st.cls} text-[10px] whitespace-nowrap">{st.label}</span>
				<div class="min-w-0 flex-1">
					<a
						href="/items/{encodeURIComponent(r.sku)}/listings/squarespace"
						class="truncate text-sm text-[color:var(--color-ink)] hover:text-[color:var(--color-gold-bright)]"
					>
						{r.title}
					</a>
					<p class="text-[11px] text-[color:var(--color-ink-3)]">
						checked {shortWhen(r.last_synced_at)}
						{#if r.last_sync_status === 'error' && r.last_sync_error}
							· <span class="text-[color:var(--color-rust-bright)]">{r.last_sync_error}</span>
						{/if}
					</p>
				</div>
				{#if r.external_url}
					<a href={r.external_url} target="_blank" rel="noopener" class="text-[11px] text-[color:var(--color-gold-bright)] hover:underline">open ↗</a>
				{/if}
			</div>
		{/each}
		{#if data.rows.length === 0}
			<div class="px-4 py-8 text-center text-sm text-[color:var(--color-ink-3)]">
				No Squarespace listings tracked yet.
			</div>
		{/if}
	</div>
</section>
