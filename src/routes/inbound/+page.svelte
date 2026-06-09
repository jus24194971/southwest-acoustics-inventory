<script lang="ts">
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import InfoTip from '$lib/components/InfoTip.svelte';

	let { data }: { data: PageData } = $props();

	const STATUS_PILL: Record<string, string> = {
		ordered: 'pill-warn',
		in_transit: 'pill',
		received: 'pill-success',
		canceled: 'pill-danger'
	};
	const STATUS_LABEL: Record<string, string> = {
		ordered: 'Ordered',
		in_transit: 'In transit',
		received: 'Received',
		canceled: 'Canceled'
	};

	function fmtDate(ts: string | null): string {
		if (!ts) return '—';
		const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
		if (Number.isNaN(d.getTime())) return ts;
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
	}

	const FILTERS = ['', 'ordered', 'in_transit', 'received', 'canceled'];
	function filterHref(s: string): string {
		return s ? `/inbound?status=${s}` : '/inbound';
	}
</script>

<section class="space-y-5">
	<header class="flex flex-wrap items-end justify-between gap-3">
		<div class="space-y-1">
			<p class="eyebrow">Shipping &amp; Receiving</p>
			<h1 class="headline text-3xl inline-flex items-baseline gap-2">
				Inbound orders
				<InfoTip title="How inbound orders work">
					<p>
						Track parts coming in from suppliers (Alibaba, etc.). Create an order by
						uploading a screenshot or pasting the order — Claude reads the line items —
						then map each to inventory or create a new part.
					</p>
					<p>
						As it moves <strong>Ordered → In transit → Received</strong>, hit
						<strong>Receive</strong> on each line when the box lands: it adds stock,
						logs a receive movement, and offers a label to print.
					</p>
				</InfoTip>
			</h1>
		</div>
		<a href="/inbound/new" class="btn-primary">+ New inbound order</a>
	</header>

	<!-- Status filter -->
	<div class="flex flex-wrap items-center gap-2 text-xs">
		{#each FILTERS as s (s)}
			{@const active = data.filters.status === s}
			<a
				href={filterHref(s)}
				class="rounded-full border px-3 py-1 transition-colors {active
					? 'border-[color:var(--color-gold)] bg-[color:var(--color-selected)] text-[color:var(--color-ink)]'
					: 'border-[color:var(--color-line)] text-[color:var(--color-ink-3)] hover:bg-[color:var(--color-hover)]'}"
			>
				{s === '' ? 'All' : STATUS_LABEL[s]}
				{#if s && data.statusCounts[s]}
					<span class="ml-1 font-mono text-[color:var(--color-ink-4)]">{data.statusCounts[s]}</span>
				{/if}
			</a>
		{/each}
	</div>

	{#if data.orders.length === 0}
		<div class="panel flex flex-col items-center gap-2 px-6 py-16 text-center">
			<p class="headline text-xl text-[color:var(--color-ink-2)]">No inbound orders yet.</p>
			<p class="text-sm text-[color:var(--color-ink-3)]">
				When Dad orders parts, create an order from the Alibaba screenshot and we'll track it
				to receiving.
			</p>
			<a href="/inbound/new" class="btn-primary mt-2">+ New inbound order</a>
		</div>
	{:else}
		<div class="panel overflow-hidden">
			<table class="w-full text-sm">
				<thead class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]">
					<tr class="text-left">
						<th class="eyebrow px-3 py-2.5">Supplier / Order</th>
						<th class="eyebrow px-3 py-2.5">Status</th>
						<th class="eyebrow px-3 py-2.5 text-right">Lines</th>
						<th class="eyebrow px-3 py-2.5 text-right">Qty</th>
						<th class="eyebrow px-3 py-2.5">ETA</th>
						<th class="eyebrow px-3 py-2.5">Created</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.orders as o (o.id)}
						<tr
							class="cursor-pointer transition-colors hover:bg-[color:var(--color-hover)]"
							onclick={() => (window.location.href = `/inbound/${o.id}`)}
						>
							<td class="px-3 py-2.5">
								<a
									href="/inbound/{o.id}"
									class="font-medium text-[color:var(--color-ink)] hover:text-[color:var(--color-gold-bright)]"
									onclick={(e) => e.stopPropagation()}
								>
									{o.supplier || 'Supplier order'}
								</a>
								{#if o.supplier_order_ref}
									<div class="font-mono text-[10px] text-[color:var(--color-ink-4)]">
										#{o.supplier_order_ref}
									</div>
								{/if}
							</td>
							<td class="px-3 py-2.5">
								<span class={STATUS_PILL[o.status] ?? 'pill'}>
									{STATUS_LABEL[o.status] ?? o.status}
								</span>
							</td>
							<td class="px-3 py-2.5 text-right font-mono text-xs text-[color:var(--color-ink-2)]">
								{o.received_lines}/{o.line_count}
							</td>
							<td class="px-3 py-2.5 text-right font-mono text-xs text-[color:var(--color-ink-2)]">
								{o.total_qty}
							</td>
							<td class="px-3 py-2.5 text-xs text-[color:var(--color-ink-2)]">{o.eta ?? '—'}</td>
							<td class="px-3 py-2.5 text-xs text-[color:var(--color-ink-3)]">{fmtDate(o.created_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
