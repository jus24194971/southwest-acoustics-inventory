<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="mx-auto flex min-h-screen max-w-3xl flex-col">
	<header class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
		<a href="/" class="text-lg font-semibold tracking-tight">SW Acoustics Inventory</a>
		<nav class="flex gap-4 text-sm text-slate-600">
			<a href="/items" class="hover:text-slate-900">Items</a>
			<a href="/locations" class="hover:text-slate-900">Locations</a>
		</nav>
	</header>
	<main class="flex-1 px-4 py-6">
		{@render children()}
	</main>
	<footer class="border-t border-slate-200 px-4 py-2 text-xs text-slate-400">
		Southwest Acoustics · inventory v0.0.1
	</footer>
</div>
