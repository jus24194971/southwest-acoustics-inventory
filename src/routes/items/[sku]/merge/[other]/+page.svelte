<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import InfoTip from '$lib/components/InfoTip.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const CONDITION_LABEL: Record<string, string> = {
		N: 'New',
		U: 'Used',
		R: 'Refurb',
		B: 'For parts'
	};

	function formatPrice(cents: number | null): string {
		if (cents == null) return '—';
		return `$${(cents / 100).toFixed(2)}`;
	}

	// Confirmation gate — the form requires typing the duplicate SKU
	// to enable Confirm. Prevents stray clicks from firing the merge.
	let confirmSku = $state('');
	let confirmMatches = $derived(confirmSku.trim() === data.duplicate.sku);
</script>

<section class="space-y-5">
	<header class="space-y-2">
		<a
			href="/items/{encodeURIComponent(data.keeper.sku)}/merge"
			class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
		>
			← Back to duplicate picker
		</a>
		<h1 class="headline text-3xl">Merge preview</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Review what will move from the duplicate into the keeper, then type the
			duplicate's SKU below to confirm.
		</p>
	</header>

	{#if form?.mergeError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.mergeError}</p>
		</div>
	{/if}

	<!-- Side-by-side comparison -->
	<div class="grid gap-4 lg:grid-cols-2">
		<!-- KEEPER -->
		<div
			class="panel space-y-3 px-4 py-3"
			style="border-color: var(--color-moss-dim, var(--color-line-bright))"
		>
			<div class="flex items-baseline justify-between gap-2">
				<p class="eyebrow text-[color:var(--color-moss-bright)]">
					✓ Keeper · stays as canonical
				</p>
				<a
					href="/items/{encodeURIComponent(data.keeper.sku)}"
					class="text-[10px] text-[color:var(--color-gold-bright)] hover:underline"
				>
					Open ↗
				</a>
			</div>
			<p class="font-mono text-sm text-[color:var(--color-gold)]">{data.keeper.sku}</p>
			<p class="text-[color:var(--color-ink)]">{data.keeper.title}</p>
			<dl class="grid grid-cols-2 gap-y-1 text-[11px]">
				<dt class="text-[color:var(--color-ink-3)]">Condition</dt>
				<dd>{CONDITION_LABEL[data.keeper.condition] ?? data.keeper.condition}</dd>
				<dt class="text-[color:var(--color-ink-3)]">Tracking</dt>
				<dd class="font-mono">{data.keeper.tracking_mode}</dd>
				<dt class="text-[color:var(--color-ink-3)]">On hand</dt>
				<dd class="font-mono">{data.keeper.stock_qty}</dd>
				<dt class="text-[color:var(--color-ink-3)]">Price</dt>
				<dd class="font-mono">{formatPrice(data.keeper.price_cents)}</dd>
				<dt class="text-[color:var(--color-ink-3)]">Category</dt>
				<dd>{data.keeper.cat_code} · {data.keeper.category_name}</dd>
				<dt class="text-[color:var(--color-ink-3)]">Brand · Model</dt>
				<dd>{data.keeper.brand_name ?? '—'} · {data.keeper.model ?? '—'}</dd>
			</dl>
		</div>

		<!-- DUPLICATE -->
		<div
			class="panel space-y-3 px-4 py-3"
			style="border-color: var(--color-rust-dim, var(--color-line-dim))"
		>
			<div class="flex items-baseline justify-between gap-2">
				<p class="eyebrow text-[color:var(--color-rust-bright)]">
					✗ Duplicate · gets soft-deleted
				</p>
				<a
					href="/items/{encodeURIComponent(data.duplicate.sku)}"
					class="text-[10px] text-[color:var(--color-gold-bright)] hover:underline"
				>
					Open ↗
				</a>
			</div>
			<p class="font-mono text-sm text-[color:var(--color-gold)]">{data.duplicate.sku}</p>
			<p class="text-[color:var(--color-ink)]">{data.duplicate.title}</p>
			<dl class="grid grid-cols-2 gap-y-1 text-[11px]">
				<dt class="text-[color:var(--color-ink-3)]">Condition</dt>
				<dd>
					{CONDITION_LABEL[data.duplicate.condition] ?? data.duplicate.condition}
					{#if data.duplicate.condition !== data.keeper.condition}
						<span class="ml-1 text-[color:var(--color-gold-bright)]">⚠ differs</span>
					{/if}
				</dd>
				<dt class="text-[color:var(--color-ink-3)]">Tracking</dt>
				<dd class="font-mono">{data.duplicate.tracking_mode}</dd>
				<dt class="text-[color:var(--color-ink-3)]">On hand</dt>
				<dd class="font-mono">{data.duplicate.stock_qty}</dd>
				<dt class="text-[color:var(--color-ink-3)]">Price</dt>
				<dd class="font-mono">
					{formatPrice(data.duplicate.price_cents)}
					{#if data.duplicate.price_cents !== data.keeper.price_cents}
						<span class="ml-1 text-[color:var(--color-gold-bright)]">⚠ differs</span>
					{/if}
				</dd>
				<dt class="text-[color:var(--color-ink-3)]">Category</dt>
				<dd>{data.duplicate.cat_code} · {data.duplicate.category_name}</dd>
				<dt class="text-[color:var(--color-ink-3)]">Brand · Model</dt>
				<dd>{data.duplicate.brand_name ?? '—'} · {data.duplicate.model ?? '—'}</dd>
			</dl>
		</div>
	</div>

	<!-- What will move -->
	<div class="panel space-y-3 px-4 py-4">
		<p class="eyebrow inline-flex items-center gap-0.5">
			What will happen
			<InfoTip>
				<p>
					The merge runs as a single batched transaction. Photos and movements
					re-point from the duplicate to the keeper, marketplace listings transfer
					only when the keeper doesn't already have one for that platform, stock
					quantities sum, and the duplicate gets soft-deleted with a reference to
					the keeper.
				</p>
				<p>
					<strong>Reversible-ish</strong>: nothing is hard-deleted. The duplicate
					row stays in the DB with <code>deleted_at</code> set. Reversing would
					mean writing the inverse re-pointer manually — let me know if you ever
					need to.
				</p>
			</InfoTip>
		</p>

		<ul class="space-y-1.5 text-sm">
			<li class="flex items-baseline gap-2">
				<span class="font-mono text-[color:var(--color-gold-bright)]">
					+{data.duplicate.stock_qty}
				</span>
				<span>
					stock qty added to the keeper · final total
					<span class="font-mono">{data.plan.finalQty}</span>
				</span>
			</li>
			{#if data.plan.willPromoteToStocked}
				<li class="ml-6 text-[11px] italic text-[color:var(--color-gold-bright)]">
					⚠ Keeper is serialized and final qty exceeds 1 — tracking mode will
					auto-switch to <code>stocked</code>.
				</li>
			{/if}
			<li class="flex items-baseline gap-2">
				<span class="font-mono text-[color:var(--color-ink-2)]">
					{data.plan.photosToMove}
				</span>
				<span>photo(s) moved from duplicate → keeper (appended at the end)</span>
			</li>
			<li class="flex items-baseline gap-2">
				<span class="font-mono text-[color:var(--color-ink-2)]">
					{data.plan.movementsToMove}
				</span>
				<span>movement(s) re-pointed to keeper</span>
			</li>
			<li class="flex items-baseline gap-2">
				<span class="font-mono text-[color:var(--color-ink-2)]">
					{data.plan.listingsToMove.length}
				</span>
				<span>
					marketplace listing(s) moved to keeper{#if data.plan.listingsToMove.length > 0}
						:
						{#each data.plan.listingsToMove as l, i (l.platform)}
							<code class="font-mono">{l.platform}</code>{i < data.plan.listingsToMove.length - 1
								? ', '
								: ''}
						{/each}
					{/if}
				</span>
			</li>
			{#if data.plan.listingsToOrphan.length > 0}
				<li class="flex items-baseline gap-2">
					<span class="font-mono text-[color:var(--color-rust-bright)]">
						{data.plan.listingsToOrphan.length}
					</span>
					<span>
						listing(s) left on the duplicate (keeper already has one for these
						platforms):
						{#each data.plan.listingsToOrphan as l, i (l.platform)}
							<code class="font-mono">{l.platform}</code>{i < data.plan.listingsToOrphan.length - 1
								? ', '
								: ''}
						{/each}
						<InfoTip>
							<p>
								The duplicate's listing for these platforms stays linked to the
								duplicate row (not deleted, not moved). To clean them up:
							</p>
							<p>
								1. Unlink the duplicate's marketplace listing in its admin (it
								points at the SS / Reverb product but the inventory row is
								soft-deleted here).
							</p>
							<p>
								2. If you want the keeper to also be on those platforms, push
								from the keeper's listing editor.
							</p>
						</InfoTip>
					</span>
				</li>
			{/if}
			<li class="flex items-baseline gap-2">
				<span class="font-mono text-[color:var(--color-rust-bright)]">→</span>
				<span>
					Duplicate <span class="font-mono">{data.duplicate.sku}</span> is
					soft-deleted with a reference back to the keeper. Direct URL still works
					(read-only); list/search hides it.
				</span>
			</li>
		</ul>
	</div>

	<!-- Confirm gate -->
	<form method="POST" action="?/confirm" class="panel space-y-3 px-4 py-4">
		<div class="space-y-1.5">
			<label for="confirm_sku" class="eyebrow block">
				Type the duplicate's SKU to confirm:
				<code class="ml-1 font-mono text-[color:var(--color-gold)]"
					>{data.duplicate.sku}</code
				>
			</label>
			<input
				id="confirm_sku"
				name="confirm_sku"
				type="text"
				bind:value={confirmSku}
				placeholder="Paste or type the duplicate SKU"
				class="field font-mono"
				autocomplete="off"
				spellcheck="false"
			/>
		</div>
		<div class="flex flex-wrap gap-2 pt-1">
			<a
				href="/items/{encodeURIComponent(data.keeper.sku)}/merge"
				class="btn-ghost px-4 py-2 text-sm"
			>
				Cancel
			</a>
			<button
				type="submit"
				class="btn-primary ml-auto px-4 py-2 text-sm"
				disabled={!confirmMatches}
				style:opacity={confirmMatches ? 1 : 0.5}
			>
				Merge {data.duplicate.sku} → {data.keeper.sku}
			</button>
		</div>
		{#if !confirmMatches && confirmSku.length > 0}
			<p class="text-[11px] italic text-[color:var(--color-rust-bright)]">
				SKU doesn't match — must be exactly <code>{data.duplicate.sku}</code>.
			</p>
		{/if}
	</form>
</section>
