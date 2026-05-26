<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const currentYear = new Date().getFullYear();

	// Track form state reactively so attribute inputs swap in/out when the
	// category changes, and so the UNQ description textarea appears
	// inline only when the matching slot value is "UNQ".
	let selectedCategoryId = $state<number | null>(null);
	let attrValues = $state<string[]>(['', '', '', '', '']);
	let trackingMode = $state<'serialized' | 'stocked'>('serialized');
	let stockQty = $state(1);

	// Derive the active category's attribute labels (or nulls). Each
	// non-null label means "render this attribute slot's input."
	let activeCategory = $derived(
		data.categories.find((c) => c.id === selectedCategoryId) ?? null
	);
	let attrLabels = $derived(
		activeCategory
			? [
					activeCategory.attr_1_label,
					activeCategory.attr_2_label,
					activeCategory.attr_3_label,
					activeCategory.attr_4_label,
					activeCategory.attr_5_label
				]
			: [null, null, null, null, null]
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
		<!-- ============= Title ============= -->
		<div class="space-y-1.5">
			<label for="title" class="eyebrow block">Title</label>
			<input
				id="title"
				name="title"
				type="text"
				required
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
				<select id="condition" name="condition" required class="field">
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
					<select id="brand_id" name="brand_id" class="field">
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
					placeholder="STR"
					class="field font-mono uppercase"
				/>
				{#if form?.errors?.model}
					<p class="text-xs text-[color:var(--color-rust-bright)]">{form.errors.model}</p>
				{/if}
			</div>
		</div>

		<!-- ============= Per-category attributes ============= -->
		{#if attrLabels.some((l) => l != null)}
			<fieldset class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
				<legend class="eyebrow px-2">Attributes</legend>
				<p class="text-[11px] text-[color:var(--color-ink-3)]">
					3-character codes (e.g. <span class="font-mono">BLK</span> for black,
					<span class="font-mono">SLV</span> for silver). Type
					<span class="font-mono">UNQ</span> for one-of-a-kind and describe it in the box that
					appears.
				</p>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each attrLabels as label, i (i)}
						{#if label}
							<div class="space-y-1.5">
								<label for="attr_{i + 1}" class="eyebrow block">{label}</label>
								<input
									id="attr_{i + 1}"
									name="attr_{i + 1}"
									type="text"
									maxlength="3"
									placeholder="XXX"
									bind:value={attrValues[i]}
									class="field font-mono uppercase"
								/>
								{#if isUnq(attrValues[i])}
									<textarea
										name="attr_{i + 1}_unique_desc"
										rows="2"
										placeholder="Describe this one-of-a-kind {label.toLowerCase()}…"
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
						<option value={bin.id}>{bin.loc_code} / {bin.bin_code} ({bin.loc_name})</option>
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
				<input id="price" name="price" type="number" step="0.01" min="0" placeholder="0.00" class="field" />
			</div>
		</div>

		<!-- ============= Description ============= -->
		<div class="space-y-1.5">
			<label for="description" class="eyebrow block">
				Description
				<span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(optional)</span>
			</label>
			<textarea id="description" name="description" rows="3" class="field"></textarea>
		</div>

		<div class="flex gap-2 border-t border-[color:var(--color-line-dim)] pt-5">
			<button type="submit" class="btn-primary">Save item</button>
			<a href="/items" class="btn-ghost">Cancel</a>
		</div>
	</form>
</section>
