<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Local UI state for the inline editors. Each section toggles into
	// edit mode in place rather than opening a modal — fewer clicks,
	// less spatial dislocation for Dad.
	let editingDetails = $state(false);
	let editingCategory = $state(false);
	let showingTransfer = $state(false);
	let showingRetire = $state(false);

	const CONDITION_LABEL: Record<string, string> = {
		N: 'New',
		U: 'Used',
		R: 'Refurbished',
		B: 'For parts'
	};
	const CONDITION_PILL: Record<string, string> = {
		N: 'pill-success',
		U: 'pill',
		R: 'pill-warn',
		B: 'pill-danger'
	};
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

	function formatPrice(cents: number | null): string {
		if (cents == null) return '—';
		return `$${(cents / 100).toFixed(2)}`;
	}

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

	let primaryPhoto = $derived(data.photos[0]);
	let extraPhotos = $derived(data.photos.slice(1));
	let activePhotoIndex = $state(0);
	let activePhoto = $derived(data.photos[activePhotoIndex] ?? null);
</script>

<section class="space-y-6">
	<!-- ============= Header / crumb ============= -->
	<header class="space-y-2">
		<a
			href="/items"
			class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
		>
			← All items
		</a>
		<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
			<p class="font-mono text-sm text-[color:var(--color-gold)]">{data.item.sku}</p>
			{#if data.item.retired_at}
				<span class="pill pill-danger">Retired · {data.item.retired_reason}</span>
			{/if}
		</div>
		<h1 class="headline text-3xl leading-tight">{data.item.title}</h1>
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<span class={CONDITION_PILL[data.item.condition] ?? 'pill'}>
				{CONDITION_LABEL[data.item.condition] ?? data.item.condition}
			</span>
			<span class="pill">{data.item.cat_code} · {data.item.cat_name}</span>
			{#if data.item.brand_code}
				<span class="pill">{data.item.brand_code}</span>
			{/if}
			<span class="text-xs text-[color:var(--color-ink-3)]">
				Received {data.item.year_received}
			</span>
		</div>
	</header>

	{#if form?.actionError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.actionError}</p>
		</div>
	{/if}

	<!-- ============= Photos + sidebar ============= -->
	<div class="grid gap-6 lg:grid-cols-[2fr_1fr]">
		<!-- Photos -->
		<div class="space-y-3">
			{#if data.photos.length === 0}
				<div
					class="panel flex aspect-square items-center justify-center text-sm italic text-[color:var(--color-ink-4)]"
				>
					No photos yet
				</div>
			{:else}
				<div class="panel overflow-hidden">
					<img
						src="/api/photos/{activePhoto?.r2_key ?? primaryPhoto.r2_key}"
						alt={activePhoto?.alt_text ?? data.item.title}
						class="aspect-square w-full bg-[color:var(--color-input)] object-contain"
					/>
				</div>
				{#if extraPhotos.length > 0}
					<div class="grid grid-cols-6 gap-2">
						{#each data.photos as photo, i (photo.id)}
							<button
								type="button"
								onclick={() => (activePhotoIndex = i)}
								class="aspect-square overflow-hidden rounded border bg-[color:var(--color-input)] transition-colors {i ===
								activePhotoIndex
									? 'border-[color:var(--color-gold)]'
									: 'border-[color:var(--color-line-dim)] hover:border-[color:var(--color-line-bright)]'}"
							>
								<img
									src="/api/photos/{photo.r2_key}"
									alt=""
									class="h-full w-full object-cover"
									loading="lazy"
								/>
							</button>
						{/each}
					</div>
				{/if}
			{/if}
		</div>

		<!-- Sidebar: location, pricing, category, actions -->
		<aside class="space-y-3">
			<!-- LOCATION ------------------------------------------ -->
			<div class="panel px-4 py-3">
				<p class="eyebrow mb-2">Location</p>
				{#if showingTransfer}
					<form method="POST" action="?/transfer" class="space-y-2">
						<select name="bin_id" class="field text-sm">
							<option value="">— unassigned —</option>
							{#each data.bins as b (b.id)}
								<option value={b.id} selected={b.id === data.item.current_bin_id}>
									{b.loc_code} / {b.bin_code} ({b.loc_name})
								</option>
							{/each}
						</select>
						<input
							name="note"
							type="text"
							placeholder="Note (optional)"
							class="field text-xs"
						/>
						<div class="flex gap-2">
							<button type="submit" class="btn-primary px-3 py-1.5 text-xs">Save</button>
							<button
								type="button"
								class="btn-ghost px-3 py-1.5 text-xs"
								onclick={() => (showingTransfer = false)}
							>
								Cancel
							</button>
						</div>
					</form>
				{:else}
					<p class="font-mono text-lg text-[color:var(--color-ink)]">
						{#if data.item.bin_code && data.item.loc_code}
							{data.item.loc_code} / {data.item.bin_code}
						{:else}
							<span class="italic text-[color:var(--color-ink-4)]">unassigned</span>
						{/if}
					</p>
					{#if data.item.loc_name}
						<p class="text-xs text-[color:var(--color-ink-3)]">{data.item.loc_name}</p>
					{/if}
					{#if !data.item.retired_at}
						<button
							type="button"
							class="btn-ghost mt-2 w-full px-3 py-1.5 text-xs"
							onclick={() => (showingTransfer = true)}
						>
							{data.item.current_bin_id ? 'Transfer' : 'Assign bin'}
						</button>
					{/if}
				{/if}
			</div>

			<!-- PRICING ------------------------------------------- -->
			<div class="panel px-4 py-3">
				<p class="eyebrow mb-2">Pricing</p>
				<div class="space-y-1 text-sm">
					<div class="flex items-baseline justify-between">
						<span class="text-[color:var(--color-ink-3)]">Cost</span>
						<span class="font-mono">{formatPrice(data.item.cost_cents)}</span>
					</div>
					<div class="flex items-baseline justify-between">
						<span class="text-[color:var(--color-ink-3)]">Price</span>
						<span class="font-mono text-lg text-[color:var(--color-ink)]">
							{formatPrice(data.item.price_cents)}
						</span>
					</div>
				</div>
			</div>

			<!-- CATEGORY ------------------------------------------ -->
			<div class="panel px-4 py-3">
				<p class="eyebrow mb-2">Category</p>
				{#if editingCategory}
					<form method="POST" action="?/changeCategory" class="space-y-2">
						<select name="category_id" class="field text-sm">
							{#each data.categories as cat (cat.id)}
								<option value={cat.id} selected={cat.id === data.item.category_id}>
									{cat.code} · {cat.name}
								</option>
							{/each}
						</select>
						<div class="flex gap-2">
							<button type="submit" class="btn-primary px-3 py-1.5 text-xs">Save</button>
							<button
								type="button"
								class="btn-ghost px-3 py-1.5 text-xs"
								onclick={() => (editingCategory = false)}
							>
								Cancel
							</button>
						</div>
					</form>
				{:else}
					<p class="text-sm">
						<span class="font-mono text-[color:var(--color-gold)]">{data.item.cat_code}</span>
						<span class="ml-2 text-[color:var(--color-ink)]">{data.item.cat_name}</span>
					</p>
					<button
						type="button"
						class="btn-ghost mt-2 w-full px-3 py-1.5 text-xs"
						onclick={() => (editingCategory = true)}
					>
						Change category
					</button>
				{/if}
			</div>

			<!-- SQUARESPACE LINK ---------------------------------- -->
			{#if data.item.squarespace_product_id}
				<div class="panel px-4 py-3">
					<p class="eyebrow mb-2">Squarespace</p>
					<p class="break-all font-mono text-[10px] text-[color:var(--color-ink-3)]">
						{data.item.squarespace_product_id}
					</p>
					{#if data.item.squarespace_sku}
						<p class="mt-1 text-xs">
							SS SKU: <span class="font-mono text-[color:var(--color-ink-2)]">{data.item.squarespace_sku}</span>
						</p>
					{/if}
					{#if data.item.squarespace_synced_at}
						<p class="mt-1 text-[10px] italic text-[color:var(--color-ink-4)]">
							last synced {shortWhen(data.item.squarespace_synced_at)}
						</p>
					{/if}
				</div>
			{/if}

			<!-- RETIRE / UNRETIRE --------------------------------- -->
			{#if data.item.retired_at}
				<form method="POST" action="?/unretire" class="panel px-4 py-3">
					<p class="eyebrow mb-2 text-[color:var(--color-rust-bright)]">Retired</p>
					<p class="text-xs text-[color:var(--color-ink-3)]">
						{data.item.retired_reason} · {shortWhen(data.item.retired_at)}
					</p>
					<button type="submit" class="btn-ghost mt-2 w-full px-3 py-1.5 text-xs">
						Bring back
					</button>
				</form>
			{:else if showingRetire}
				<form method="POST" action="?/retire" class="panel space-y-2 px-4 py-3">
					<p class="eyebrow">Retire item</p>
					<select name="reason" required class="field text-sm">
						<option value="">— pick a reason —</option>
						<option value="sold">Sold</option>
						<option value="scrap">Scrap / discarded</option>
						<option value="used_in_build">Used in a build</option>
					</select>
					<input name="note" type="text" placeholder="Note (e.g. order ref)" class="field text-xs" />
					<div class="flex gap-2">
						<button type="submit" class="btn-primary px-3 py-1.5 text-xs">Retire</button>
						<button
							type="button"
							class="btn-ghost px-3 py-1.5 text-xs"
							onclick={() => (showingRetire = false)}
						>
							Cancel
						</button>
					</div>
				</form>
			{:else}
				<button
					type="button"
					class="btn-ghost w-full px-4 py-2 text-xs"
					onclick={() => (showingRetire = true)}
				>
					Retire item
				</button>
			{/if}
		</aside>
	</div>

	<!-- ============= Description + edit ============= -->
	<section class="panel space-y-3 px-6 py-5">
		<div class="flex items-center justify-between">
			<p class="eyebrow">Description</p>
			{#if !editingDetails}
				<button
					type="button"
					class="btn-ghost px-3 py-1.5 text-xs"
					onclick={() => (editingDetails = true)}
				>
					Edit
				</button>
			{/if}
		</div>

		{#if editingDetails}
			<form method="POST" action="?/edit" class="space-y-3">
				<div class="grid gap-3 md:grid-cols-2">
					<div class="space-y-1.5 md:col-span-2">
						<label for="title" class="eyebrow block">Title</label>
						<input
							id="title"
							name="title"
							type="text"
							required
							value={data.item.title}
							class="field"
						/>
						{#if form?.editErrors?.title}
							<p class="text-xs text-[color:var(--color-rust-bright)]">{form.editErrors.title}</p>
						{/if}
					</div>

					<div class="space-y-1.5">
						<label for="condition" class="eyebrow block">Condition</label>
						<select id="condition" name="condition" required class="field">
							<option value="N" selected={data.item.condition === 'N'}>New</option>
							<option value="U" selected={data.item.condition === 'U'}>Used</option>
							<option value="R" selected={data.item.condition === 'R'}>Refurbished</option>
							<option value="B" selected={data.item.condition === 'B'}>Broken / parts</option>
						</select>
					</div>

					<div class="grid grid-cols-2 gap-2">
						<div class="space-y-1.5">
							<label for="cost" class="eyebrow block">Cost ($)</label>
							<input
								id="cost"
								name="cost"
								type="number"
								step="0.01"
								min="0"
								value={data.item.cost_cents != null ? (data.item.cost_cents / 100).toFixed(2) : ''}
								class="field"
							/>
						</div>
						<div class="space-y-1.5">
							<label for="price" class="eyebrow block">Price ($)</label>
							<input
								id="price"
								name="price"
								type="number"
								step="0.01"
								min="0"
								value={data.item.price_cents != null ? (data.item.price_cents / 100).toFixed(2) : ''}
								class="field"
							/>
						</div>
					</div>
				</div>

				<div class="space-y-1.5">
					<label for="description" class="eyebrow block">Description (plain text)</label>
					<textarea id="description" name="description" rows="3" class="field">{data.item.description ?? ''}</textarea>
				</div>

				<div class="space-y-1.5">
					<label for="description_html" class="eyebrow block">
						Description (HTML — shown on Squarespace)
					</label>
					<textarea
						id="description_html"
						name="description_html"
						rows="6"
						class="field font-mono text-xs"
					>{data.item.description_html ?? ''}</textarea>
				</div>

				<div class="flex gap-2 border-t border-[color:var(--color-line-dim)] pt-3">
					<button type="submit" class="btn-primary">Save changes</button>
					<button
						type="button"
						class="btn-ghost"
						onclick={() => (editingDetails = false)}
					>
						Cancel
					</button>
				</div>
			</form>
		{:else if data.item.description_html}
			<!-- HTML descriptions come from Squarespace and are trusted -->
			<div
				class="prose prose-invert max-w-none text-sm text-[color:var(--color-ink-2)] [&_a]:text-[color:var(--color-gold-bright)] [&_a]:underline"
			>
				{@html data.item.description_html}
			</div>
		{:else if data.item.description}
			<p class="whitespace-pre-wrap text-sm text-[color:var(--color-ink-2)]">{data.item.description}</p>
		{:else}
			<p class="text-sm italic text-[color:var(--color-ink-4)]">No description yet.</p>
		{/if}
	</section>

	<!-- ============= Movement history ============= -->
	<section class="space-y-3">
		<div class="flex items-end justify-between">
			<p class="eyebrow">Provenance</p>
			<p class="text-xs text-[color:var(--color-ink-4)]">
				{data.movements.length} entr{data.movements.length === 1 ? 'y' : 'ies'}
			</p>
		</div>

		<div class="panel overflow-hidden">
			<table class="w-full text-sm">
				<thead
					class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]"
				>
					<tr class="text-left">
						<th class="eyebrow px-3 py-2.5">Kind</th>
						<th class="eyebrow px-3 py-2.5">From</th>
						<th class="eyebrow px-3 py-2.5">To</th>
						<th class="eyebrow px-3 py-2.5">Note</th>
						<th class="eyebrow px-3 py-2.5">By</th>
						<th class="eyebrow px-3 py-2.5 text-right">When</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.movements as m (m.id)}
						<tr>
							<td class="px-3 py-2.5">
								<span class={KIND_PILL[m.kind] ?? 'pill'}>
									{KIND_LABEL[m.kind] ?? m.kind}
								</span>
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
							<td class="px-3 py-2.5 text-xs text-[color:var(--color-ink-3)]">
								{m.actor ?? '—'}
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
	</section>
</section>
