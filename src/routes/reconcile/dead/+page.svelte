<script lang="ts">
	import { page } from '$app/state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const PLATFORM_LABEL: Record<string, string> = {
		squarespace: 'Squarespace',
		reverb: 'Reverb',
		ebay: 'eBay'
	};
	const PLATFORM_PILL: Record<string, string> = {
		squarespace: 'pill',
		reverb: 'pill-warn',
		ebay: 'pill-success'
	};

	const removedJustNow = $derived(parseInt(page.url.searchParams.get('removed') ?? '', 10));
	const failedJustNow = $derived(parseInt(page.url.searchParams.get('failed') ?? '', 10));

	let toRemove = $derived(
		data.dead.filter((d) => ['pending', 'failed', 'manual'].includes(d.status))
	);
	let removed = $derived(data.dead.filter((d) => d.status === 'removed'));
	let kept = $derived(data.dead.filter((d) => d.status === 'dismissed'));
</script>

<section class="mx-auto max-w-2xl space-y-5">
	<header class="space-y-2">
		<p class="text-xs text-[color:var(--color-ink-3)]">
			<a href="/reconcile" class="hover:underline">Reconcile</a> · Dead listings
		</p>
		<h1 class="headline text-2xl leading-tight">Remove dead listings</h1>
		<p class="max-w-xl text-sm text-[color:var(--color-ink-2)]">
			Everything Dad marked “no longer have” in the wizard is queued here. Removing pushes the
			actual delete to <strong>Squarespace</strong> and <strong>Reverb</strong>. eBay's classic
			listings can't be ended by API — open each and end it by hand, then mark it done.
		</p>
	</header>

	{#if Number.isInteger(removedJustNow)}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss-bright)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				✓ Removed {removedJustNow} listing(s).
				{#if Number.isInteger(failedJustNow) && failedJustNow > 0}
					<span class="text-[color:var(--color-gold-bright)]">{failedJustNow} failed — see below.</span>
				{/if}
			</p>
		</div>
	{/if}

	<!-- Summary + bulk action -->
	<div class="panel flex flex-wrap items-center gap-3 px-4 py-3">
		<p class="text-sm text-[color:var(--color-ink-2)]">
			<strong>{data.counts.pending + data.counts.failed}</strong> to remove ·
			<strong>{data.counts.manual}</strong> manual (eBay) ·
			<span class="text-[color:var(--color-moss-bright)]">{data.counts.removed} done</span>
		</p>
		{#if data.apiRemovable > 0}
			<form
				method="POST"
				action="?/removeAll"
				class="ml-auto"
				onsubmit={(e) => {
					if (!confirm(`Remove all ${data.apiRemovable} Squarespace/Reverb listing(s) now? This deletes them from the live stores and can't be undone.`))
						e.preventDefault();
				}}
			>
				<button type="submit" class="btn-primary px-4 py-2 text-sm">
					Remove all SS + Reverb ({data.apiRemovable})
				</button>
			</form>
		{/if}
	</div>

	{#if toRemove.length === 0}
		<div class="panel px-6 py-10 text-center">
			<p class="text-lg text-[color:var(--color-ink)]">Nothing queued 🎉</p>
			<p class="mt-1 text-sm text-[color:var(--color-ink-3)]">
				No dead listings to remove right now.
			</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each toRemove as d (d.id)}
				<div
					class="panel flex items-center gap-3 px-4 py-3"
					style={d.status === 'failed' ? 'border-color: var(--color-rust)' : ''}
				>
					<span class="{PLATFORM_PILL[d.platform]} text-[10px]">{PLATFORM_LABEL[d.platform]}</span>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm text-[color:var(--color-ink)]">{d.title ?? '(untitled)'}</p>
						<p class="text-[11px] text-[color:var(--color-ink-3)]">
							{d.source === 'item_retired' ? 'retired item' : 'discontinued product'}
							{#if d.status === 'failed' && d.error}
								· <span class="text-[color:var(--color-rust-bright)]">{d.error}</span>
							{/if}
						</p>
					</div>

					{#if d.external_url}
						<a
							href={d.external_url}
							target="_blank"
							rel="noopener"
							class="text-[11px] text-[color:var(--color-gold-bright)] hover:underline"
						>
							open ↗
						</a>
					{/if}

					{#if d.platform === 'ebay'}
						<!-- Classic eBay — can't delete via API. -->
						<form method="POST" action="?/markDone">
							<input type="hidden" name="dead_id" value={d.id} />
							<button type="submit" class="btn-ghost px-2.5 py-1 text-[11px] whitespace-nowrap">
								Mark ended
							</button>
						</form>
					{:else}
						<form
							method="POST"
							action="?/remove"
							onsubmit={(e) => {
								if (!confirm(`Remove this ${PLATFORM_LABEL[d.platform]} listing? Deletes it from the live store.`))
									e.preventDefault();
							}}
						>
							<input type="hidden" name="dead_id" value={d.id} />
							<button
								type="submit"
								class="rounded border border-[color:var(--color-rust)] px-2.5 py-1 text-[11px] whitespace-nowrap text-[color:var(--color-rust-bright)] hover:bg-[color:var(--color-input)]"
							>
								{d.status === 'failed' ? 'Retry remove' : 'Remove'}
							</button>
						</form>
					{/if}

					<form method="POST" action="?/dismiss">
						<input type="hidden" name="dead_id" value={d.id} />
						<button
							type="submit"
							class="text-[11px] text-[color:var(--color-ink-3)] hover:underline"
							title="Keep the listing live — drop it from this queue"
						>
							keep
						</button>
					</form>
				</div>
			{/each}
		</div>
	{/if}

	{#if removed.length > 0}
		<details class="panel px-4 py-3">
			<summary class="cursor-pointer text-sm text-[color:var(--color-moss-bright)]">
				✓ {removed.length} removed
			</summary>
			<ul class="mt-2 space-y-1">
				{#each removed as d (d.id)}
					<li class="text-[12px] text-[color:var(--color-ink-3)]">
						{PLATFORM_LABEL[d.platform]} · {d.title ?? '(untitled)'}
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if kept.length > 0}
		<details class="panel px-4 py-3">
			<summary class="cursor-pointer text-sm text-[color:var(--color-ink-2)]">
				{kept.length} kept (left live)
			</summary>
			<ul class="mt-2 space-y-1">
				{#each kept as d (d.id)}
					<li class="text-[12px] text-[color:var(--color-ink-3)]">
						{PLATFORM_LABEL[d.platform]} · {d.title ?? '(untitled)'}
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>
