<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import AttributeValueSelect from '$lib/components/AttributeValueSelect.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const currentYear = new Date().getFullYear();

	// AI prefill from the reconcile wizard's "Have it" (null for normal use).
	const pf = data.reconcile?.prefill ?? null;

	// Form state — attribute inputs react to category changes so only
	// the slots that mean something for the current category show up.
	// When prefilled, seed the state from the AI's resolved values.
	let selectedCategoryId = $state<number | null>(pf?.categoryId ?? null);
	let attrValues = $state<string[]>(
		pf?.attrCodes && pf.attrCodes.length === 5 ? [...pf.attrCodes] : ['', '', '', '', '']
	);
	let trackingMode = $state<'serialized' | 'stocked'>(pf ? 'stocked' : 'serialized');
	let stockQty = $state(pf?.qty ?? 1);
	let condition = $state<string>(pf?.condition ?? '');
	let brandId = $state<number | string>(pf?.brandId ?? '');

	let activeCategory = $derived(
		data.categories.find((c) => c.id === selectedCategoryId) ?? null
	);

	// Derive per-slot {label, contextKey, valuesForContext} from the
	// active category. Each slot's dropdown gets the subset of
	// attribute_values that match its context_key.
	let attrSlots = $derived(
		[1, 2, 3, 4, 5].map((n) => {
			const label = activeCategory
				? (activeCategory[`attr_${n}_label` as keyof typeof activeCategory] as string | null)
				: null;
			const contextKey = activeCategory
				? (activeCategory[`attr_${n}_context_key` as keyof typeof activeCategory] as
						| string
						| null)
				: null;
			const values = contextKey
				? data.attrValues
						.filter((v) => v.context_key === contextKey)
						.map((v) => ({ id: v.id, code: v.code, label: v.label }))
				: [];
			return { n, label, contextKey, values };
		})
	);

	function isUnq(value: string): boolean {
		return value.trim().toUpperCase() === 'UNQ';
	}
</script>

<section class="mx-auto max-w-2xl space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Receive</p>
		<h1 class="headline text-3xl">Add an item</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			The SKU is generated for you. Pick a category and any attribute slots it defines will appear
			below.
		</p>
	</header>

	<form method="POST" class="panel space-y-5 px-6 py-6">
		{#if data.reconcile}
			<input type="hidden" name="reconcile_group_id" value={data.reconcile.groupId} />
			<div class="panel px-4 py-3" style="border-color: var(--color-moss-bright)">
				<p class="text-sm text-[color:var(--color-moss-bright)]">
					✨ Pre-filled from your marketplace listing(s). Review and adjust, then save — every
					listing links back to this item automatically.
				</p>
				{#if pf?.descriptors}
					<p class="mt-1 text-[11px] text-[color:var(--color-ink-3)]">AI saw: {pf.descriptors}</p>
				{/if}
				{#if data.reconcile.photos.length > 0}
					<!-- Product graphics carried over from the listings, so Dad
						 can eyeball the item while filling the form. -->
					<div class="mt-2 flex flex-wrap items-center gap-2">
						{#each data.reconcile.photos as ph (ph.image_url)}
							<a
								href={ph.url ?? ph.image_url}
								target="_blank"
								rel="noopener"
								title="Open {ph.platform} listing"
							>
								<img
									src={ph.image_url}
									alt=""
									class="h-16 w-16 rounded object-cover ring-1 ring-[color:var(--color-line-dim)] transition hover:ring-[color:var(--color-gold-bright)]"
									loading="lazy"
								/>
							</a>
						{/each}
						<span class="text-[11px] italic text-[color:var(--color-ink-3)]">
							↗ Click a photo to open its listing for a closer look
						</span>
					</div>
				{/if}

				<label
					class="mt-3 flex items-start gap-2 border-t border-[color:var(--color-line-dim)] pt-3 text-[12px] text-[color:var(--color-ink-2)]"
				>
					<input type="checkbox" name="make_sellable" class="mt-0.5" />
					<span>
						<strong class="text-[color:var(--color-ink)]">Sell it on Squarespace</strong> — mark it
						sellable and keep its Squarespace listing in sync (price, stock, title, SKU) from now on.
						If it’s <em>already</em> on Squarespace we publish it right away; if it’s
						<em>not</em>, you’ll go to its listing page to add photos, write a description, and push
						it live. Uncheck if you’re only recording stock and not selling it online.
					</span>
				</label>
			</div>
		{/if}

		<!-- ============= Title ============= -->
		<div class="space-y-1.5">
			<label for="title" class="eyebrow block">Title</label>
			<input
				id="title"
				name="title"
				type="text"
				required
				value={pf?.title ?? ''}
				placeholder="Seymour Duncan JB Jr pickup, neck position"
				class="field"
			/>
			{#if form?.errors?.title}
				<p class="text-xs text-[color:var(--color-rust-bright)]">{form.errors.title}</p>
			{/if}
		</div>

		<!-- ============= Category + condition ============= -->
		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1.5">
				<label for="category_id" class="eyebrow block">Category</label>
				<select
					id="category_id"
					name="category_id"
					required
					bind:value={selectedCategoryId}
					class="field"
				>
					<option value={null}>— pick one —</option>
					{#each data.categories as cat (cat.id)}
						<option value={cat.id}>{cat.code} · {cat.name}</option>
					{/each}
				</select>
				{#if form?.errors?.category_id}
					<p class="text-xs text-[color:var(--color-rust-bright)]">{form.errors.category_id}</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<label for="condition" class="eyebrow block">Condition</label>
				<select id="condition" name="condition" required bind:value={condition} class="field">
					<option value="">— pick one —</option>
					<option value="N">New</option>
					<option value="U">Used</option>
					<option value="R">Refurbished</option>
					<option value="B">Broken / for parts</option>
				</select>
				{#if form?.errors?.condition}
					<p class="text-xs text-[color:var(--color-rust-bright)]">{form.errors.condition}</p>
				{/if}
			</div>
		</div>

		<!-- ============= Brand + model ============= -->
		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1.5">
				<label for="brand_id" class="eyebrow block">
					Brand
					<span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(optional)</span>
				</label>
				{#if data.brands.length > 0}
					<select id="brand_id" name="brand_id" bind:value={brandId} class="field">
						<option value="">— none —</option>
						{#each data.brands as brand (brand.id)}
							<option value={brand.id}>{brand.code} · {brand.name}</option>
						{/each}
					</select>
				{:else}
					<input
						id="brand_code"
						name="brand_code"
						type="text"
						maxlength="3"
						value={pf?.brandCode ?? ''}
						placeholder="FEN"
						class="field font-mono uppercase"
					/>
					<p class="text-[11px] text-[color:var(--color-ink-3)]">
						No brands saved yet — type a 3-letter code (e.g. FEN, GIB, SEY).
					</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<label for="model" class="eyebrow block">Model</label>
				<input
					id="model"
					name="model"
					type="text"
					required
					value={pf?.model ?? ''}
					placeholder="STR"
					class="field font-mono uppercase"
				/>
				{#if form?.errors?.model}
					<p class="text-xs text-[color:var(--color-rust-bright)]">{form.errors.model}</p>
				{/if}
			</div>
		</div>

		<!-- ============= Per-category attributes ============= -->
		{#if attrSlots.some((s) => s.label != null)}
			<fieldset class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
				<legend class="eyebrow px-2">Attributes</legend>
				<p class="text-[11px] text-[color:var(--color-ink-3)]">
					Each dropdown shows the friendly name with the 3-letter SKU code in parentheses. Pick
					<span class="font-mono">+ Add new value…</span> at the bottom to add a code we
					haven't catalogued yet. Pick <span class="font-mono">UNQ</span> for a one-of-a-kind and
					describe it in the box that appears.
				</p>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each attrSlots as slot, i (slot.n)}
						{#if slot.label}
							<div class="space-y-1.5">
								<label for="attr_{slot.n}" class="eyebrow block">{slot.label}</label>
								<AttributeValueSelect
									contextKey={slot.contextKey}
									name="attr_{slot.n}"
									bind:value={attrValues[i]}
									initialValues={slot.values}
									placeholder="— no value —"
								/>
								{#if isUnq(attrValues[i])}
									<textarea
										name="attr_{slot.n}_unique_desc"
										rows="2"
										placeholder="Describe this one-of-a-kind {slot.label.toLowerCase()}…"
										class="field text-sm"
									></textarea>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			</fieldset>
		{/if}

		<!-- ============= Tracking ============= -->
		<fieldset class="grid gap-3 rounded border border-[color:var(--color-line-dim)] p-4 sm:grid-cols-2">
			<legend class="eyebrow px-2">Tracking</legend>
			<div class="space-y-1.5">
				<label for="tracking_mode" class="eyebrow block">Mode</label>
				<select
					id="tracking_mode"
					name="tracking_mode"
					bind:value={trackingMode}
					class="field"
				>
					<option value="serialized">Serialized (one physical object)</option>
					<option value="stocked">Stocked (count by quantity)</option>
				</select>
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					{trackingMode === 'serialized'
						? 'Like a guitar, a body, a premium pickup — each one is its own row.'
						: 'Like knobs, screws, strings — one row per variant, with a quantity.'}
				</p>
			</div>

			{#if trackingMode === 'stocked'}
				<div class="space-y-1.5">
					<label for="stock_qty" class="eyebrow block">On-hand quantity</label>
					<input
						id="stock_qty"
						name="stock_qty"
						type="number"
						min="0"
						required
						bind:value={stockQty}
						class="field"
					/>
					{#if form?.errors?.stock_qty}
						<p class="text-xs text-[color:var(--color-rust-bright)]">{form.errors.stock_qty}</p>
					{/if}
				</div>
			{:else}
				<!-- Hidden input so the action always receives stock_qty=1 for
					 serialized items, even if the input above is hidden. -->
				<input type="hidden" name="stock_qty" value="1" />
			{/if}
		</fieldset>

		<!-- ============= Year + bin ============= -->
		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1.5">
				<label for="year_received" class="eyebrow block">Year received</label>
				<input
					id="year_received"
					name="year_received"
					type="number"
					min="2000"
					max="2100"
					value={currentYear}
					class="field"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="bin_id" class="eyebrow block">
					Bin
					<span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(optional)</span>
				</label>
				<select id="bin_id" name="bin_id" class="field">
					<option value="">— unassigned —</option>
					{#each data.bins as bin (bin.id)}
						<option value={bin.id}>{bin.path}</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- ============= Pricing ============= -->
		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1.5">
				<label for="cost" class="eyebrow block">
					Cost <span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">($)</span>
				</label>
				<input id="cost" name="cost" type="number" step="0.01" min="0" placeholder="0.00" class="field" />
			</div>
			<div class="space-y-1.5">
				<label for="price" class="eyebrow block">
					Price <span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">($)</span>
				</label>
				<input
					id="price"
					name="price"
					type="number"
					step="0.01"
					min="0"
					value={pf?.priceCents != null ? (pf.priceCents / 100).toFixed(2) : ''}
					placeholder="0.00"
					class="field"
				/>
			</div>
		</div>

		<!-- ============= Description ============= -->
		<div class="space-y-1.5">
			<label for="description" class="eyebrow block">
				Description
				<span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(optional)</span>
			</label>
			<textarea id="description" name="description" rows="3" class="field" value={pf?.description ?? ''}
			></textarea>
		</div>

		<div class="flex gap-2 border-t border-[color:var(--color-line-dim)] pt-5">
			<button type="submit" class="btn-primary">Save item</button>
			<a href="/items" class="btn-ghost">Cancel</a>
		</div>
	</form>
</section>
