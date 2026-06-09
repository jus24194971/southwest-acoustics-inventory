<script lang="ts">
	import { page } from '$app/state';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const deletedCount = $derived(parseInt(page.url.searchParams.get('deleted') ?? '', 10));
	const deleteErrors = $derived(page.url.searchParams.get('delete_errors'));

	const totalDuplicates = $derived(
		data.groups.reduce((sum, g) => sum + (g.products.length - 1), 0)
	);

	function shortDate(iso: string): string {
		if (!iso) return '—';
		const t = new Date(iso.replace(' ', 'T'));
		if (isNaN(t.getTime())) return iso.slice(0, 10);
		return t.toLocaleDateString();
	}

	function confirmDelete(e: SubmitEvent, sku: string) {
		const formEl = e.target as HTMLFormElement;
		const n = formEl.querySelectorAll('input[name="delete_id"]:checked').length;
		if (n === 0) {
			e.preventDefault();
			alert('Nothing checked to delete in this group.');
			return;
		}
		if (!confirm(`Permanently delete ${n} Squarespace listing(s) for SKU ${sku}? This cannot be undone.`)) {
			e.preventDefault();
		}
	}
</script>

<section class="space-y-6">
	<header class="space-y-2">
		<p class="text-xs text-[color:var(--color-ink-3)]">
			<a href="/listings" class="hover:underline">Listings</a> · Cleanup
		</p>
		<h1 class="headline text-3xl leading-tight">Duplicate listing cleanup</h1>
		<p class="max-w-2xl text-sm text-[color:var(--color-ink-2)]">
			Finds Squarespace products that share the same SKU — the duplicates left behind when an
			earlier push crashed before it could save the link. Keep one of each, delete the rest.
			Deletions are permanent on Squarespace.
		</p>
	</header>

	{#if Number.isInteger(deletedCount)}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss-bright)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				✓ Deleted {deletedCount} duplicate listing{deletedCount === 1 ? '' : 's'} from Squarespace.
			</p>
			{#if deleteErrors}
				<p class="mt-1 text-xs text-[color:var(--color-gold-bright)]">
					Some couldn't be deleted: {deleteErrors}
				</p>
			{/if}
		</div>
	{/if}

	{#if form?.deleteError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.deleteError}</p>
		</div>
	{/if}

	{#if data.error}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{data.error}</p>
		</div>
	{:else}
		<p class="text-xs text-[color:var(--color-ink-3)]">
			Scanned {data.scanned} product{data.scanned === 1 ? '' : 's'} across {data.pagesScanned} page{data.pagesScanned ===
			1
				? ''
				: 's'}.
			{#if data.capped}
				<span class="text-[color:var(--color-gold-bright)]">
					Reached the scan limit — if you have a very large catalog some duplicates may not be
					shown. Re-run after deleting these.
				</span>
			{/if}
		</p>

		{#if data.groups.length === 0}
			<div class="panel px-6 py-10 text-center">
				<p class="text-lg text-[color:var(--color-ink)]">No duplicates found 🎉</p>
				<p class="mt-1 text-sm text-[color:var(--color-ink-3)]">
					Every SKU on Squarespace maps to a single product.
				</p>
			</div>
		{:else}
			<p class="text-sm text-[color:var(--color-ink-2)]">
				Found <strong>{data.groups.length}</strong> SKU{data.groups.length === 1 ? '' : 's'} with
				duplicates ({totalDuplicates} extra listing{totalDuplicates === 1 ? '' : 's'} to remove).
				The recommended keeper is pre-selected to stay; everything else is checked for deletion.
			</p>

			<div class="space-y-4">
				{#each data.groups as group (group.sku)}
					<form
						method="POST"
						action="?/delete"
						class="panel space-y-3 px-4 py-3"
						onsubmit={(e) => confirmDelete(e, group.sku)}
					>
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<div>
								<span class="font-mono text-sm text-[color:var(--color-gold-bright)]"
									>{group.sku}</span
								>
								<span class="ml-2 text-xs text-[color:var(--color-ink-3)]">
									{group.products.length} copies
								</span>
							</div>
							<button type="submit" class="btn-primary px-3 py-1.5 text-xs">
								Delete checked
							</button>
						</div>

						<ul class="space-y-1.5">
							{#each group.products as p (p.id)}
								<li
									class="flex items-start gap-3 rounded border px-3 py-2"
									style="border-color: {p.recommendedKeep
										? 'var(--color-moss)'
										: 'var(--color-line-dim)'}"
								>
									<input
										type="checkbox"
										name="delete_id"
										value={p.id}
										checked={!p.recommendedKeep}
										class="mt-1"
									/>
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-2">
											<span class="truncate text-sm text-[color:var(--color-ink)]">{p.name}</span>
											{#if p.recommendedKeep}
												<span class="pill pill-success text-[10px]">Recommended keep</span>
											{/if}
											{#if p.linkedItemSku}
												<span
													class="pill text-[10px]"
													title="Linked to inventory item {p.linkedItemSku}"
												>
													Linked
												</span>
											{/if}
										</div>
										<div class="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[color:var(--color-ink-3)]">
											<span>{p.imageCount} photo{p.imageCount === 1 ? '' : 's'}</span>
											<span>modified {shortDate(p.modifiedOn)}</span>
											{#if p.url}
												<a
													href={p.url}
													target="_blank"
													rel="noopener"
													class="text-[color:var(--color-gold-bright)] hover:underline"
												>
													View on Squarespace ↗
												</a>
											{/if}
										</div>
									</div>
								</li>
							{/each}
						</ul>
						<p class="text-[11px] italic text-[color:var(--color-ink-4)]">
							Tip: keep the copy with the most photos and/or the one marked “Linked”. Unchecking
							the keeper and checking a different copy is fine — the next push re-links by SKU.
						</p>
					</form>
				{/each}
			</div>
		{/if}
	{/if}
</section>
