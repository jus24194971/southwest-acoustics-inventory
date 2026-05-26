<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section class="space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Bootstrap</p>
		<h1 class="headline text-3xl">Squarespace product import</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Diagnostic: confirm we can reach Dad's Squarespace store. Reads the first page of products
			and reports what came back. Nothing is written to inventory yet.
		</p>
	</header>

	{#if data.status === 'no_key'}
		<div
			class="panel border-[color:var(--color-rust)] px-6 py-5"
			style="border-color: var(--color-rust)"
		>
			<p class="headline text-xl text-[color:var(--color-rust-bright)]">No API key configured.</p>
			<p class="mt-2 text-sm text-[color:var(--color-ink-2)]">{data.message}</p>
		</div>
	{:else if data.status === 'api_error'}
		<div class="panel px-6 py-5" style="border-color: var(--color-rust)">
			<p class="headline text-xl text-[color:var(--color-rust-bright)]">
				Squarespace rejected the request.
			</p>
			<p class="mt-2 text-sm">
				HTTP <span class="font-mono">{data.httpStatus}</span>
				— {data.message}
			</p>
			{#if data.httpStatus === 401 || data.httpStatus === 403}
				<p class="mt-3 text-xs italic text-[color:var(--color-ink-3)]">
					Likely cause: the API key is missing the <span class="font-mono">Products</span>
					read scope, or it's pointed at the wrong Squarespace site. Regenerate the key in Squarespace
					→ Settings → Developer Tools → API Keys with all read scopes selected.
				</p>
			{/if}
			{#if data.body}
				<pre
					class="mt-4 overflow-x-auto rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] p-3 text-xs text-[color:var(--color-ink-2)]">{data.body}</pre>
			{/if}
		</div>
	{:else if data.status === 'network_error'}
		<div class="panel px-6 py-5" style="border-color: var(--color-rust)">
			<p class="headline text-xl text-[color:var(--color-rust-bright)]">
				Couldn't reach Squarespace.
			</p>
			<p class="mt-2 text-sm text-[color:var(--color-ink-2)]">{data.message}</p>
		</div>
	{:else if data.status === 'ok'}
		<!-- =========================================
		     Summary tile — we have a working pipe.
		     ========================================= -->
		<div class="panel px-6 py-5" style="border-color: var(--color-moss)">
			<p class="headline text-xl text-[color:var(--color-moss-bright)]">Connected.</p>
			<div class="mt-3 grid grid-cols-3 gap-4 text-sm">
				<div>
					<span class="eyebrow">Products on page 1</span>
					<p class="headline mt-1 text-2xl">{data.sampleCount}</p>
				</div>
				<div>
					<span class="eyebrow">Images on page 1</span>
					<p class="headline mt-1 text-2xl">{data.totalImageCount}</p>
				</div>
				<div>
					<span class="eyebrow">Variants on page 1</span>
					<p class="headline mt-1 text-2xl">{data.totalVariantCount}</p>
				</div>
			</div>
			<p class="mt-3 text-xs italic text-[color:var(--color-ink-3)]">
				Has additional pages: <span class="font-mono"
					>{data.hasNextPage ? 'yes' : 'no'}</span
				>
				{data.hasNextPage ? '— the full import will paginate through them.' : ''}
			</p>
		</div>

		<!-- =========================================
		     Sample products — first five.
		     ========================================= -->
		<div class="space-y-1">
			<p class="eyebrow">First 5 products as Squarespace sees them</p>
			<p class="text-xs text-[color:var(--color-ink-4)]">
				This is what the importer will translate into inventory items.
			</p>
		</div>

		<div class="space-y-3">
			{#each data.sample ?? [] as p (p.id)}
				<div class="panel grid grid-cols-[120px_1fr] gap-4 p-4">
					<div
						class="aspect-square overflow-hidden rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)]"
					>
						{#if p.firstImageUrl}
							<img src={p.firstImageUrl} alt={p.name} class="h-full w-full object-cover" />
						{:else}
							<div
								class="flex h-full w-full items-center justify-center text-xs italic text-[color:var(--color-ink-4)]"
							>
								no image
							</div>
						{/if}
					</div>

					<div class="space-y-2">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-mono text-[11px] text-[color:var(--color-gold-dim)]">{p.id}</p>
								<h3 class="headline text-lg leading-tight">{p.name}</h3>
							</div>
							{#if !p.isVisible}
								<span class="pill pill-warn flex-shrink-0">Hidden</span>
							{/if}
						</div>

						{#if p.descriptionPreview}
							<p class="text-xs text-[color:var(--color-ink-2)]">
								{p.descriptionPreview}{p.descriptionLength > 180 ? '…' : ''}
								<span class="ml-1 italic text-[color:var(--color-ink-4)]">
									({p.descriptionLength} chars)
								</span>
							</p>
						{:else}
							<p class="text-xs italic text-[color:var(--color-ink-4)]">no description</p>
						{/if}

						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
							<span>
								<span class="eyebrow">Variants:</span>
								<span class="ml-1 font-mono text-[color:var(--color-ink)]">{p.variantCount}</span>
							</span>
							<span>
								<span class="eyebrow">Images:</span>
								<span class="ml-1 font-mono text-[color:var(--color-ink)]">{p.imageCount}</span>
							</span>
							{#if p.firstVariantSku}
								<span>
									<span class="eyebrow">First SKU:</span>
									<span class="ml-1 font-mono text-[color:var(--color-gold)]">
										{p.firstVariantSku}
									</span>
								</span>
							{/if}
							<span>
								<span class="eyebrow">Price:</span>
								<span class="ml-1 font-mono text-[color:var(--color-ink)]">{p.firstVariantPrice}</span>
							</span>
						</div>

						{#if p.tags.length > 0}
							<div class="flex flex-wrap gap-1">
								{#each p.tags as t}
									<span class="pill text-[10px]">{t}</span>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<div class="panel space-y-2 px-6 py-5">
			<p class="headline text-lg">What's next</p>
			<p class="text-sm text-[color:var(--color-ink-2)]">
				If this all looks right, give me a thumbs-up and I'll build the actual importer that
				writes each variant into an inventory <span class="font-mono">item</span> row, downloads
				images to R2, and records <span class="font-mono">squarespace_product_id</span> for the
				eventual round-trip sync.
			</p>
		</div>
	{/if}
</section>
