<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const currentYear = new Date().getFullYear();
</script>

<section class="space-y-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Add an item</h1>
		<p class="mt-1 text-sm text-slate-600">
			The SKU is generated for you — you just fill in what it is.
		</p>
	</div>

	<form method="POST" class="space-y-4">
		<div>
			<label for="title" class="block text-sm font-medium text-slate-700">Title</label>
			<input
				id="title"
				name="title"
				type="text"
				required
				placeholder="Seymour Duncan JB Jr pickup, neck position"
				class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
			/>
			{#if form?.errors?.title}
				<p class="mt-1 text-xs text-red-600">{form.errors.title}</p>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="category_id" class="block text-sm font-medium text-slate-700">Category</label>
				<select
					id="category_id"
					name="category_id"
					required
					class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				>
					<option value="">— pick one —</option>
					{#each data.categories as cat (cat.id)}
						<option value={cat.id}>{cat.code} · {cat.name}</option>
					{/each}
				</select>
				{#if form?.errors?.category_id}
					<p class="mt-1 text-xs text-red-600">{form.errors.category_id}</p>
				{/if}
			</div>

			<div>
				<label for="condition" class="block text-sm font-medium text-slate-700">Condition</label>
				<select
					id="condition"
					name="condition"
					required
					class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				>
					<option value="">— pick one —</option>
					<option value="N">New</option>
					<option value="U">Used</option>
					<option value="R">Refurbished</option>
					<option value="B">Broken / for parts</option>
				</select>
				{#if form?.errors?.condition}
					<p class="mt-1 text-xs text-red-600">{form.errors.condition}</p>
				{/if}
			</div>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="brand_id" class="block text-sm font-medium text-slate-700"
					>Brand <span class="text-slate-400">(optional)</span></label
				>
				{#if data.brands.length > 0}
					<select
						id="brand_id"
						name="brand_id"
						class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
					>
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
						class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono uppercase shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
					/>
					<p class="mt-1 text-xs text-slate-500">
						No brands saved yet — 3-letter code (e.g. FEN, GIB, SEY).
					</p>
				{/if}
			</div>

			<div>
				<label for="model" class="block text-sm font-medium text-slate-700">Model</label>
				<input
					id="model"
					name="model"
					type="text"
					required
					placeholder="STR"
					class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				/>
				{#if form?.errors?.model}
					<p class="mt-1 text-xs text-red-600">{form.errors.model}</p>
				{/if}
			</div>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="year_received" class="block text-sm font-medium text-slate-700"
					>Year received</label
				>
				<input
					id="year_received"
					name="year_received"
					type="number"
					min="2000"
					max="2100"
					value={currentYear}
					class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				/>
			</div>

			<div>
				<label for="bin_id" class="block text-sm font-medium text-slate-700"
					>Bin <span class="text-slate-400">(optional)</span></label
				>
				<select
					id="bin_id"
					name="bin_id"
					class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				>
					<option value="">— unassigned —</option>
					{#each data.bins as bin (bin.id)}
						<option value={bin.id}>{bin.loc_code} / {bin.bin_code} ({bin.loc_name})</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="cost" class="block text-sm font-medium text-slate-700"
					>Cost <span class="text-slate-400">($)</span></label
				>
				<input
					id="cost"
					name="cost"
					type="number"
					step="0.01"
					min="0"
					placeholder="0.00"
					class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				/>
			</div>
			<div>
				<label for="price" class="block text-sm font-medium text-slate-700"
					>Price <span class="text-slate-400">($)</span></label
				>
				<input
					id="price"
					name="price"
					type="number"
					step="0.01"
					min="0"
					placeholder="0.00"
					class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				/>
			</div>
		</div>

		<div>
			<label for="description" class="block text-sm font-medium text-slate-700"
				>Description <span class="text-slate-400">(optional)</span></label
			>
			<textarea
				id="description"
				name="description"
				rows="3"
				class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
			></textarea>
		</div>

		<div class="flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
			>
				Save item
			</button>
			<a
				href="/items"
				class="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100"
			>
				Cancel
			</a>
		</div>
	</form>
</section>
