<script lang="ts">
	import { page } from '$app/state';
	import type { PageData, ActionData } from './$types';
	import InfoTip from '$lib/components/InfoTip.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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

	function fmtPrice(cents: number | null): string {
		if (cents == null) return '—';
		return `$${(cents / 100).toFixed(2)}`;
	}

	const createdJustNow = $derived(page.url.searchParams.get('created') === '1');
	const receivedLine = $derived(parseInt(page.url.searchParams.get('received') ?? '', 10));

	let editingOrder = $state(false);

	// Per-line typed-SKU map inputs.
	let skuInput = $state<Record<number, string>>({});

	let allReceived = $derived(
		data.lines.length > 0 && data.lines.every((l) => l.received_qty >= l.quantity && l.quantity > 0)
	);
	let estTotalCents = $derived(
		data.lines.reduce((s, l) => s + (l.unit_cost_cents ?? 0) * l.quantity, 0)
	);
</script>

<section class="space-y-5">
	<header class="space-y-2">
		<a
			href="/inbound"
			class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
		>
			← Inbound orders
		</a>
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="headline text-3xl">{data.order.supplier || 'Inbound order'}</h1>
			<span class={STATUS_PILL[data.order.status] ?? 'pill'}>
				{STATUS_LABEL[data.order.status] ?? data.order.status}
			</span>
		</div>
		{#if data.order.supplier_order_ref}
			<p class="font-mono text-sm text-[color:var(--color-ink-3)]">#{data.order.supplier_order_ref}</p>
		{/if}
	</header>

	{#if createdJustNow}
		<div class="panel px-4 py-2" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				Order created. Map each line to inventory (or create a new part), then receive when it arrives.
			</p>
		</div>
	{:else if receivedLine}
		<div class="panel px-4 py-2" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">✓ Received — stock updated and a receive movement logged.</p>
		</div>
	{/if}
	{#if allReceived && data.order.status === 'received'}
		<div class="panel px-4 py-2" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">All lines received — this order is complete. 🎉</p>
		</div>
	{/if}
	{#if form?.lineError}
		<div class="panel px-4 py-2" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.lineError}</p>
		</div>
	{/if}

	<!-- ============ Order status / details ============ -->
	<div class="panel space-y-3 px-6 py-4">
		<div class="flex items-baseline justify-between">
			<p class="eyebrow">Order details</p>
			{#if !editingOrder}
				<button type="button" class="btn-ghost px-3 py-1 text-xs" onclick={() => (editingOrder = true)}>Edit</button>
			{/if}
		</div>

		{#if !editingOrder}
			<dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Supplier</dt>
					<dd>
						{#if data.order.supplier_id}
							<a href="/suppliers/{data.order.supplier_id}" class="text-[color:var(--color-gold-bright)] hover:underline">{data.order.supplier_name || data.order.supplier}</a>
						{:else}
							{data.order.supplier || '—'}
						{/if}
					</dd>
				</div>
				<div class="flex justify-between gap-3"><dt class="text-[color:var(--color-ink-3)]">Status</dt><dd>{STATUS_LABEL[data.order.status] ?? data.order.status}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-[color:var(--color-ink-3)]">ETA</dt><dd>{data.order.eta ?? '—'}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-[color:var(--color-ink-3)]">Tracking</dt><dd class="font-mono text-xs">{data.order.tracking ?? '—'}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-[color:var(--color-ink-3)]">Est. total</dt><dd class="font-mono">{fmtPrice(estTotalCents)}</dd></div>
				{#if data.order.notes}
					<div class="flex justify-between gap-3 sm:col-span-2"><dt class="text-[color:var(--color-ink-3)]">Notes</dt><dd class="text-right">{data.order.notes}</dd></div>
				{/if}
			</dl>
		{:else}
			<form method="POST" action="?/updateOrder" class="space-y-3">
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="space-y-1.5">
						<label for="status" class="eyebrow block">Status</label>
						<select id="status" name="status" value={data.order.status} class="field">
							<option value="ordered">Ordered</option>
							<option value="in_transit">In transit</option>
							<option value="received">Received</option>
							<option value="canceled">Canceled</option>
						</select>
					</div>
					<div class="space-y-1.5">
						<label for="eta" class="eyebrow block">ETA</label>
						<input id="eta" name="eta" value={data.order.eta ?? ''} class="field" />
					</div>
					<div class="space-y-1.5 sm:col-span-2">
						<label for="tracking" class="eyebrow block">Tracking</label>
						<input id="tracking" name="tracking" value={data.order.tracking ?? ''} class="field font-mono" />
					</div>
					<div class="space-y-1.5 sm:col-span-2">
						<label for="notes" class="eyebrow block">Notes</label>
						<input id="notes" name="notes" value={data.order.notes ?? ''} class="field" />
					</div>
				</div>
				<div class="flex gap-2">
					<button type="button" class="btn-ghost px-3 py-1.5 text-xs" onclick={() => (editingOrder = false)}>Cancel</button>
					<button type="submit" class="btn-primary ml-auto px-3 py-1.5 text-xs">Save</button>
				</div>
			</form>
		{/if}
	</div>

	<!-- ============ Lines ============ -->
	<div class="panel space-y-3 px-6 py-4">
		<p class="eyebrow inline-flex items-center gap-0.5">
			Line items
			<InfoTip title="Mapping & receiving">
				<p>
					Map each ordered part to an inventory item — pick a suggestion, type a SKU, or
					<strong>create a new item</strong> if it's new (then come back and map it).
				</p>
				<p>
					When it arrives, hit <strong>Receive</strong>: stock goes up, a receive movement
					is logged, and you can print a label. Receiving the last line completes the order.
				</p>
			</InfoTip>
		</p>

		<div class="space-y-3">
			{#each data.lines as line (line.id)}
				{@const fullyReceived = line.received_qty >= line.quantity && line.quantity > 0}
				<div class="rounded border border-[color:var(--color-line-dim)] p-3 {fullyReceived ? 'opacity-70' : ''}">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium text-[color:var(--color-ink)]">{line.description}</p>
							<p class="mt-0.5 text-[11px] text-[color:var(--color-ink-3)]">
								Qty <span class="font-mono">{line.quantity}</span>
								{#if line.unit_cost_cents != null}· {fmtPrice(line.unit_cost_cents)} ea · {fmtPrice(line.unit_cost_cents * line.quantity)} total{/if}
								{#if line.supplier_sku}· <span class="font-mono">{line.supplier_sku}</span>{/if}
							</p>
						</div>
						<div class="text-right">
							{#if fullyReceived}
								<span class="pill pill-success text-[10px]">Received {line.received_qty}/{line.quantity}</span>
							{:else if line.received_qty > 0}
								<span class="pill pill-warn text-[10px]">Partial {line.received_qty}/{line.quantity}</span>
							{/if}
						</div>
					</div>

					<!-- Mapping + receive row -->
					<div class="mt-3 border-t border-[color:var(--color-line-dim)] pt-3">
						{#if line.item_id}
							<!-- Mapped -->
							<div class="flex flex-wrap items-center gap-3">
								<div class="flex-1">
									<span class="text-[10px] text-[color:var(--color-ink-4)]">Mapped to</span>
									<a href="/items/{encodeURIComponent(line.item_sku ?? '')}" class="ml-1 text-sm text-[color:var(--color-gold-bright)] hover:underline">
										{line.item_title}
									</a>
									<span class="ml-1 font-mono text-[10px] text-[color:var(--color-ink-4)]">{line.item_sku}</span>
									<span class="ml-2 text-[10px] text-[color:var(--color-ink-3)]">({line.item_stock_qty} on hand)</span>
									<!-- Preferred-supplier lever for this part -->
									{#if data.order.supplier_id}
										{#if line.item_preferred_supplier_id === data.order.supplier_id}
											<span class="ml-2 text-[10px] text-[color:var(--color-gold-bright)]" title="{data.order.supplier_name} is this part's preferred supplier">★ preferred from {data.order.supplier_name}</span>
										{:else}
											<form method="POST" action="?/setPreferredSupplier" class="ml-2 inline">
												<input type="hidden" name="line_id" value={line.id} />
												<button type="submit" class="text-[10px] text-[color:var(--color-ink-4)] hover:text-[color:var(--color-gold-bright)]" title="Make {data.order.supplier_name} the preferred reorder source for this part">
													☆ set {data.order.supplier_name} preferred
												</button>
											</form>
										{/if}
									{/if}
								</div>
								{#if !fullyReceived}
									<form method="POST" action="?/receiveLine">
										<input type="hidden" name="line_id" value={line.id} />
										<button type="submit" class="btn-primary px-3 py-1.5 text-xs">
											Receive {line.quantity - line.received_qty}
										</button>
									</form>
								{:else}
									<a href="/labels" class="btn-ghost px-3 py-1.5 text-xs" title="Go to label printing">🏷 Print label</a>
								{/if}
								<form method="POST" action="?/unmapLine">
									<input type="hidden" name="line_id" value={line.id} />
									<button type="submit" class="btn-ghost px-2 py-1.5 text-[11px]" title="Unmap">unmap</button>
								</form>
							</div>
						{:else}
							<!-- Unmapped: suggestions + SKU input + create new -->
							<div class="space-y-2">
								{#if data.suggestions[line.id]?.length}
									<div class="flex flex-wrap items-center gap-1.5">
										<span class="text-[10px] text-[color:var(--color-ink-4)]">Suggested:</span>
										{#each data.suggestions[line.id] as sug (sug.id)}
											<form method="POST" action="?/mapLine" class="inline">
												<input type="hidden" name="line_id" value={line.id} />
												<input type="hidden" name="item_id" value={sug.id} />
												<button type="submit" class="rounded-full border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-2.5 py-1 text-[11px] text-[color:var(--color-ink-2)] transition-colors hover:border-[color:var(--color-gold)] hover:text-[color:var(--color-ink)]" title={sug.sku}>
													{sug.title}
												</button>
											</form>
										{/each}
									</div>
								{/if}
								<div class="flex flex-wrap items-center gap-2">
									<form method="POST" action="?/mapLine" class="flex items-center gap-1">
										<input type="hidden" name="line_id" value={line.id} />
										<input
											name="sku"
											bind:value={skuInput[line.id]}
											placeholder="map by SKU…"
											class="field py-1 text-xs font-mono"
											style="min-height: 30px; width: 16rem"
										/>
										<button type="submit" class="btn-ghost px-2 py-1 text-[11px]">Map</button>
									</form>
									<a
										href="/items/new?title={encodeURIComponent(line.description)}"
										class="inline-flex items-center gap-1 rounded border border-dashed border-[color:var(--color-line-bright)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--color-ink-3)] transition-colors hover:border-[color:var(--color-gold)] hover:bg-[color:var(--color-hover)] hover:text-[color:var(--color-gold-bright)]"
										title="Create a new inventory item for this part, then come back and map it"
									>
										<span class="text-sm leading-none">+</span> Create new item
									</a>
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>
