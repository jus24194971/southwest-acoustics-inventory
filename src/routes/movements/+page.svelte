<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Each movement kind gets a tinted pill so the ledger reads at a glance.
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

	// Render the SQLite UTC timestamp ('YYYY-MM-DD HH:MM:SS') as a relative
	// short string. Kept inline because we only need it on this screen.
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
</script>

<section class="space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Audit ledger</p>
		<h1 class="headline text-3xl">Movements</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Every receive, transfer, sale, and scrap. Stock-on-hand is derived from this — never edited
			directly.
		</p>
	</header>

	{#if data.movements.length === 0}
		<div class="panel flex flex-col items-center gap-2 px-6 py-16 text-center">
			<p class="headline text-xl text-[color:var(--color-ink-2)]">Quiet ledger.</p>
			<p class="text-sm text-[color:var(--color-ink-3)]">
				Movements appear here automatically as items are received, transferred, or sold.
			</p>
		</div>
	{:else}
		<div class="panel overflow-hidden">
			<table class="w-full text-sm">
				<thead
					class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]"
				>
					<tr class="text-left">
						<th class="eyebrow px-3 py-2.5">Kind</th>
						<th class="eyebrow px-3 py-2.5">Item</th>
						<th class="eyebrow px-3 py-2.5">From</th>
						<th class="eyebrow px-3 py-2.5">To</th>
						<th class="eyebrow px-3 py-2.5">Note</th>
						<th class="eyebrow px-3 py-2.5 text-right">When</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.movements as m (m.id)}
						<tr class="transition-colors hover:bg-[color:var(--color-hover)]">
							<td class="px-3 py-2.5">
								<span class={KIND_PILL[m.kind] ?? 'pill'}>
									{KIND_LABEL[m.kind] ?? m.kind}
								</span>
							</td>
							<td class="px-3 py-2.5">
								<div class="font-mono text-xs text-[color:var(--color-gold)]">{m.sku}</div>
								<div class="text-xs text-[color:var(--color-ink-2)]">{m.title}</div>
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
	{/if}
</section>
