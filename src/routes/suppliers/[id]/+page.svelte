<script lang="ts">
	import { page } from '$app/state';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const savedJustNow = $derived(page.url.searchParams.get('saved') === '1');
	let editing = $state(false);

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
		return Number.isNaN(d.getTime()) ? ts : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
	}
</script>

<section class="space-y-5">
	<header class="space-y-2">
		<a href="/suppliers" class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]">← Suppliers</a>
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="headline text-3xl">{data.supplier.name}</h1>
			{#if data.supplier.is_preferred}
				<span class="pill" style="color: var(--color-gold-bright)">★ Preferred</span>
			{/if}
		</div>
	</header>

	{#if savedJustNow}
		<div class="panel px-4 py-2" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">Supplier saved.</p>
		</div>
	{/if}

	<!-- Details / edit -->
	<div class="panel space-y-3 px-6 py-4">
		<div class="flex items-baseline justify-between">
			<p class="eyebrow">Details</p>
			{#if !editing}
				<button type="button" class="btn-ghost px-3 py-1 text-xs" onclick={() => (editing = true)}>Edit</button>
			{/if}
		</div>
		{#if !editing}
			<dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
				<div class="flex justify-between gap-3"><dt class="text-[color:var(--color-ink-3)]">Type</dt><dd>{data.supplier.kind ?? '—'}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-[color:var(--color-ink-3)]">Preferred</dt><dd>{data.supplier.is_preferred ? '★ Yes' : 'No'}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-[color:var(--color-ink-3)]">Contact</dt><dd>{data.supplier.contact ?? '—'}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-[color:var(--color-ink-3)]">URL</dt><dd class="truncate">{#if data.supplier.url}<a href={data.supplier.url} target="_blank" rel="noopener" class="text-[color:var(--color-gold-bright)] hover:underline">visit ↗</a>{:else}—{/if}</dd></div>
				{#if data.supplier.notes}<div class="flex justify-between gap-3 sm:col-span-2"><dt class="text-[color:var(--color-ink-3)]">Notes</dt><dd class="text-right">{data.supplier.notes}</dd></div>{/if}
			</dl>
		{:else}
			<form method="POST" action="?/update" class="space-y-3">
				{#if form?.editError}<p class="text-sm text-[color:var(--color-rust-bright)]">{form.editError}</p>{/if}
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="space-y-1.5"><label for="name" class="eyebrow block">Name</label><input id="name" name="name" value={data.supplier.name} class="field" /></div>
					<div class="space-y-1.5"><label for="kind" class="eyebrow block">Type</label><select id="kind" name="kind" value={data.supplier.kind ?? 'alibaba'} class="field"><option value="alibaba">Alibaba</option><option value="other">Other</option></select></div>
					<div class="space-y-1.5"><label for="url" class="eyebrow block">URL</label><input id="url" name="url" value={data.supplier.url ?? ''} class="field font-mono text-xs" /></div>
					<div class="space-y-1.5"><label for="contact" class="eyebrow block">Contact</label><input id="contact" name="contact" value={data.supplier.contact ?? ''} class="field" /></div>
					<div class="space-y-1.5 sm:col-span-2"><label for="notes" class="eyebrow block">Notes</label><input id="notes" name="notes" value={data.supplier.notes ?? ''} class="field" /></div>
				</div>
				<label class="flex items-center gap-2">
					<input type="checkbox" name="is_preferred" checked={data.supplier.is_preferred === 1} class="h-4 w-4 accent-[color:var(--color-gold)]" style="min-height: auto" />
					<span class="text-sm text-[color:var(--color-ink-2)]">★ Preferred supplier</span>
				</label>
				<div class="flex gap-2 border-t border-[color:var(--color-line-dim)] pt-3">
					<button type="button" class="btn-ghost px-3 py-1.5 text-xs" onclick={() => (editing = false)}>Cancel</button>
					<button type="submit" class="btn-primary ml-auto px-3 py-1.5 text-xs">Save</button>
				</div>
			</form>
		{/if}
	</div>

	<!-- Order history -->
	<div class="panel space-y-2 px-6 py-4">
		<p class="eyebrow">Order history ({data.orders.length})</p>
		{#if data.orders.length === 0}
			<p class="text-sm text-[color:var(--color-ink-4)]">No orders logged from this supplier yet.</p>
		{:else}
			<table class="w-full text-sm">
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.orders as o (o.id)}
						<tr class="cursor-pointer transition-colors hover:bg-[color:var(--color-hover)]" onclick={() => (window.location.href = `/inbound/${o.id}`)}>
							<td class="py-2 pr-3"><a href="/inbound/{o.id}" class="text-[color:var(--color-gold-bright)] hover:underline" onclick={(e) => e.stopPropagation()}>#{o.supplier_order_ref || o.id}</a></td>
							<td class="py-2 pr-3"><span class={STATUS_PILL[o.status] ?? 'pill'}>{STATUS_LABEL[o.status] ?? o.status}</span></td>
							<td class="py-2 pr-3 text-xs text-[color:var(--color-ink-3)]">{o.line_count} lines · {o.total_qty} qty</td>
							<td class="py-2 text-right text-xs text-[color:var(--color-ink-4)]">{fmtDate(o.created_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<!-- Preferred-for parts -->
	<div class="panel space-y-2 px-6 py-4">
		<p class="eyebrow">Preferred source for ({data.parts.length})</p>
		{#if data.parts.length === 0}
			<p class="text-sm text-[color:var(--color-ink-4)]">
				No parts name this supplier as preferred yet. Set it from a received inbound line.
			</p>
		{:else}
			<ul class="space-y-1">
				{#each data.parts as p (p.id)}
					<li class="flex items-baseline justify-between gap-3 text-sm">
						<a href="/items/{encodeURIComponent(p.sku)}" class="text-[color:var(--color-ink)] hover:text-[color:var(--color-gold-bright)]">{p.title}</a>
						<span class="font-mono text-[10px] text-[color:var(--color-ink-4)]">{p.sku} · {p.stock_qty} on hand</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>
