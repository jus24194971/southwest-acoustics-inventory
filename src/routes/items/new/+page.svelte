<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const currentYear = new Date().getFullYear();
</script>

<section class="mx-auto max-w-2xl space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Receive</p>
		<h1 class="headline text-3xl">Add an item</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			The SKU is generated for you — just describe what it is and where it lives.
		</p>
	</header>

	<form method="POST" class="panel space-y-5 px-6 py-6">
		<!-- Title — the human-readable description. Most important field. -->
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

		<!-- Category + condition, side-by-side because both are required pickers. -->
		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1.5">
				<label for="category_id" class="eyebrow block">Category</label>
				<select id="category_id" name="category_id" required class="field">
					<option value="">— pick one —</option>
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

		<!-- Brand + model. Both feed the SKU. -->
		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1.5">
				<label for="brand_id" class="eyebrow block">
					Brand <span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(optional)</span>
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

		<!-- Year received + bin. Year defaults to current year. -->
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
					Bin <span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(optional)</span>
				</label>
				<select id="bin_id" name="bin_id" class="field">
					<option value="">— unassigned —</option>
					{#each data.bins as bin (bin.id)}
						<option value={bin.id}>{bin.loc_code} / {bin.bin_code} ({bin.loc_name})</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- Money. Cost is what Dad paid; price is what he asks. -->
		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1.5">
				<label for="cost" class="eyebrow block">
					Cost <span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">($)</span>
				</label>
				<input
					id="cost"
					name="cost"
					type="number"
					step="0.01"
					min="0"
					placeholder="0.00"
					class="field"
				/>
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
					placeholder="0.00"
					class="field"
				/>
			</div>
		</div>

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
