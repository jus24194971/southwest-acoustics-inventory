<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	// Nav structure. Keeping it data-driven so adding /scan, /import, etc.
	// later is one-line work.
	const nav = [
		{ href: '/', label: 'Overview' },
		{ href: '/items', label: 'Items' },
		{ href: '/locations', label: 'Locations' }
	] as const;

	// Current path drives the active tab. Match on either exact path or
	// /items/anything-under-items so detail screens still highlight 'Items'.
	function isActive(href: string, current: string): boolean {
		if (href === '/') return current === '/';
		return current === href || current.startsWith(href + '/');
	}
</script>

<div class="relative z-10 flex min-h-screen flex-col">
	<!-- ============================================================
	     Toolbar — brand left, nav right. Sticky so it's always reachable
	     on long pages or zoomed sessions.
	     ============================================================ -->
	<header
		class="sticky top-0 z-30 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[color:var(--color-line-dim)] bg-gradient-to-b from-[color:var(--color-panel-2)] to-[color:var(--color-panel)] px-5 py-3 shadow-[inset_0_1px_0_rgba(255,230,180,0.04),inset_0_-1px_0_rgba(0,0,0,0.45)]"
	>
		<a href="/" class="group flex items-center gap-4 overflow-hidden">
			<img
				src="/southwest_logo.png"
				alt="Southwest Acoustics"
				class="h-11 w-auto drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition-opacity group-hover:opacity-85"
			/>
			<span
				class="h-8 w-px bg-gradient-to-b from-transparent via-[color:var(--color-line-bright)] to-transparent"
			></span>
			<div class="flex min-w-0 flex-col gap-0.5">
				<span
					class="headline truncate text-lg leading-none transition-colors group-hover:text-[color:var(--color-gold-bright)]"
				>
					Inventory
				</span>
				<span class="eyebrow truncate">Southwest Acoustics · Shop Floor</span>
			</div>
		</a>

		<nav class="flex flex-shrink-0 items-center gap-1">
			{#each nav as item (item.href)}
				{@const active = isActive(item.href, page.url.pathname)}
				<a
					href={item.href}
					class="rounded px-3.5 py-1.5 text-sm font-medium transition-all duration-150 {active
						? 'border border-[color:var(--color-gold-dim)] bg-[color:var(--color-selected)] text-[color:var(--color-ink)]'
						: 'border border-transparent text-[color:var(--color-ink-2)] hover:border-[color:var(--color-line)] hover:bg-[color:var(--color-hover)] hover:text-[color:var(--color-ink)]'}"
				>
					{item.label}
				</a>
			{/each}
		</nav>
	</header>

	<!-- ============================================================
	     Main content. Constrained width on big screens so the dark
	     shell never feels barren; flush on mobile.
	     ============================================================ -->
	<main class="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
		{@render children()}
	</main>

	<!-- ============================================================
	     Status bar — mono micro-text, brand wordmark right-aligned.
	     Mirrors the Listing Studio chassis.
	     ============================================================ -->
	<footer
		class="flex items-center gap-4 border-t border-[color:var(--color-line-dim)] bg-gradient-to-b from-[#15120e] to-[#100e0a] px-4 py-1.5"
	>
		<span class="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-4)]">
			Ready
		</span>
		<span class="ml-auto font-[var(--font-display)] text-[11px] italic text-[color:var(--color-gold-dim)]">
			Southwest Acoustics · Inventory v0.0.1
		</span>
	</footer>
</div>
