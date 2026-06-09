<script lang="ts">
	import { page } from '$app/state';
	import type { PageData, ActionData } from './$types';
	import InfoTip from '$lib/components/InfoTip.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const addedJustNow = $derived(page.url.searchParams.get('added') === '1');
	let showAdd = $state(false);

	const KIND_LABEL: Record<string, string> = {
		alibaba: 'Alibaba',
		other: 'Other'
	};
</script>

<section class="space-y-5">
	<header class="flex flex-wrap items-end justify-between gap-3">
		<div class="space-y-1">
			<p class="eyebrow">Shipping &amp; Receiving</p>
			<h1 class="headline text-3xl inline-flex items-baseline gap-2">
				Suppliers
				<InfoTip title="Suppliers & preferred sellers">
					<p>
						Every inbound order is documented against a supplier here, so you keep a
						full order history per seller.
					</p>
					<p>
						The <strong>★ star</strong> marks a preferred seller. Parts can also name a
						preferred supplier (set it from a received inbound line) so you always know
						the go-to source to reorder a given part.
					</p>
				</InfoTip>
			</h1>
		</div>
		<button type="button" class="btn-primary" onclick={() => (showAdd = !showAdd)}>
			{showAdd ? 'Close' : '+ Add supplier'}
		</button>
	</header>

	{#if addedJustNow}
		<div class="panel px-4 py-2" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">Supplier added.</p>
		</div>
	{/if}

	{#if showAdd}
		<form method="POST" action="?/add" class="panel space-y-3 px-6 py-5">
			{#if form?.addError}
				<p class="text-sm text-[color:var(--color-rust-bright)]">{form.addError}</p>
			{/if}
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="space-y-1.5">
					<label for="name" class="eyebrow block">Name *</label>
					<input id="name" name="name" required placeholder="Seller / store name" class="field" />
				</div>
				<div class="space-y-1.5">
					<label for="kind" class="eyebrow block">Type</label>
					<select id="kind" name="kind" class="field">
						<option value="alibaba">Alibaba</option>
						<option value="other">Other</option>
					</select>
				</div>
				<div class="space-y-1.5">
					<label for="url" class="eyebrow block">Store URL <span class="lowercase">(optional)</span></label>
					<input id="url" name="url" placeholder="https://…" class="field font-mono text-xs" />
				</div>
				<div class="space-y-1.5">
					<label for="contact" class="eyebrow block">Contact <span class="lowercase">(optional)</span></label>
					<input id="contact" name="contact" placeholder="Rep name / WeChat / email" class="field" />
				</div>
				<div class="space-y-1.5 sm:col-span-2">
					<label for="notes" class="eyebrow block">Notes <span class="lowercase">(optional)</span></label>
					<input id="notes" name="notes" class="field" />
				</div>
			</div>
			<label class="flex items-center gap-2">
				<input type="checkbox" name="is_preferred" class="h-4 w-4 accent-[color:var(--color-gold)]" style="min-height: auto" />
				<span class="text-sm text-[color:var(--color-ink-2)]">★ Mark as a preferred supplier</span>
			</label>
			<div class="border-t border-[color:var(--color-line-dim)] pt-3">
				<button type="submit" class="btn-primary">Add supplier</button>
			</div>
		</form>
	{/if}

	{#if data.suppliers.length === 0}
		<div class="panel flex flex-col items-center gap-2 px-6 py-16 text-center">
			<p class="headline text-xl text-[color:var(--color-ink-2)]">No suppliers yet.</p>
			<p class="text-sm text-[color:var(--color-ink-3)]">
				They get created automatically when you log an inbound order, or add one above.
			</p>
		</div>
	{:else}
		<div class="panel overflow-hidden">
			<table class="w-full text-sm">
				<thead class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]">
					<tr class="text-left">
						<th class="eyebrow w-10 px-2 py-2.5"></th>
						<th class="eyebrow px-3 py-2.5">Supplier</th>
						<th class="eyebrow px-3 py-2.5">Type</th>
						<th class="eyebrow px-3 py-2.5 text-right">Orders</th>
						<th class="eyebrow px-3 py-2.5 text-right">Preferred for</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.suppliers as s (s.id)}
						<tr class="transition-colors hover:bg-[color:var(--color-hover)]">
							<td class="px-2 py-2.5 text-center">
								<!-- Preferred star toggle -->
								<form method="POST" action="?/togglePreferred">
									<input type="hidden" name="id" value={s.id} />
									<button
										type="submit"
										class="text-lg leading-none transition-colors {s.is_preferred
											? 'text-[color:var(--color-gold-bright)]'
											: 'text-[color:var(--color-ink-4)] hover:text-[color:var(--color-gold)]'}"
										title={s.is_preferred ? 'Preferred — click to unset' : 'Mark as preferred'}
									>
										{s.is_preferred ? '★' : '☆'}
									</button>
								</form>
							</td>
							<td class="px-3 py-2.5">
								<a href="/suppliers/{s.id}" class="font-medium text-[color:var(--color-ink)] hover:text-[color:var(--color-gold-bright)]">{s.name}</a>
								{#if s.contact}<div class="text-[10px] text-[color:var(--color-ink-4)]">{s.contact}</div>{/if}
							</td>
							<td class="px-3 py-2.5 text-xs text-[color:var(--color-ink-3)]">{KIND_LABEL[s.kind ?? ''] ?? s.kind ?? '—'}</td>
							<td class="px-3 py-2.5 text-right font-mono text-xs">{s.order_count}</td>
							<td class="px-3 py-2.5 text-right font-mono text-xs text-[color:var(--color-ink-3)]">{s.preferred_part_count} part{s.preferred_part_count === 1 ? '' : 's'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
