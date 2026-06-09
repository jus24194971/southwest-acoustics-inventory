<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { applyAction, deserialize } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionResult } from '@sveltejs/kit';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// ----------------------------------------------------------------
	// Keep scroll position on form actions (app-wide).
	// ----------------------------------------------------------------
	// Plain <form method="POST" action="?/…"> submits do a full POST →
	// redirect, and every redirect navigation yanks the window back to the
	// top — annoying on long lists. This one capture-phase listener turns
	// every POST action form into an in-place submit (like use:enhance),
	// and crucially tells the post-redirect navigation NOT to scroll. The
	// result: lists, item pages, the reconcile wizard, etc. all stay put
	// after you click a button. Opt out on any single form with
	// `data-native` if it ever needs the old full-reload behavior.
	onMount(() => {
		async function onSubmit(event: SubmitEvent) {
			const form = event.target;
			if (!(form instanceof HTMLFormElement)) return;
			if (form.method.toLowerCase() !== 'post') return;
			if (form.hasAttribute('data-native')) return;

			const submitter = event.submitter;
			const isBtn =
				submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement;
			// IMPORTANT: button.formAction (the IDL property) defaults to the
			// PAGE URL when no formaction attribute is set — so only trust it
			// when the attribute is actually present. Otherwise use the form's
			// action (which correctly carries `?/actionName`). Getting this
			// wrong posts to the bare page URL → "no action found" → 404/500.
			const actionAttr =
				isBtn && submitter.hasAttribute('formaction') ? submitter.formAction : form.action;
			let url: URL;
			try {
				url = new URL(actionAttr, location.href);
			} catch {
				return;
			}
			if (url.origin !== location.origin) return; // never intercept off-site posts

			event.preventDefault();
			const body = new FormData(form);
			if (isBtn && submitter.name) body.append(submitter.name, submitter.value);

			try {
				const res = await fetch(url, {
					method: 'POST',
					headers: { 'x-sveltekit-action': 'true' },
					body
				});
				let result: ActionResult;
				try {
					result = deserialize(await res.text());
				} catch {
					// Response wasn't a parseable action result — just refresh
					// in place (don't re-submit, which could double-run it).
					await invalidateAll();
					return;
				}
				if (result.type === 'redirect') {
					// Preserve scroll only when the action redirects back to the
					// SAME page (the common case — qty adjust, validate, remove…).
					// A redirect to a different page should still land at the top.
					const dest = new URL(result.location, location.href);
					const samePage = dest.pathname === location.pathname;
					await goto(result.location, { noScroll: samePage, invalidateAll: true });
				} else if (result.type === 'success') {
					await invalidateAll();
					applyAction(result);
				} else {
					// 'failure' (validation) or 'error' — surface without scrolling.
					applyAction(result);
				}
			} catch {
				// Network/unexpected failure — the action didn't run, so a
				// normal native submit is the safe fallback.
				form.submit();
			}
		}
		document.addEventListener('submit', onSubmit, true);
		return () => document.removeEventListener('submit', onSubmit, true);
	});

	// Global search — accessible from every page. Routes to /items?q=…
	// where the full filter UI lives.
	let globalSearch = $state('');

	function onGlobalSearch(e: Event) {
		e.preventDefault();
		const q = globalSearch.trim();
		if (!q) return;
		goto(`/items?q=${encodeURIComponent(q)}`);
	}

	// Nav structure — grouped. Top-level entries are either a direct
	// `link` or a `menu` (dropdown of related pages). Data-driven so
	// adding a page is a one-line edit.
	type NavLink = { kind: 'link'; href: string; label: string };
	type NavMenu = {
		kind: 'menu';
		label: string;
		items: { href: string; label: string }[];
	};
	const nav: (NavLink | NavMenu)[] = [
		{ kind: 'link', href: '/', label: 'Overview' },
		{ kind: 'link', href: '/issues', label: 'Issues' },
		{
			kind: 'menu',
			label: 'Inventory',
			items: [
				{ href: '/items', label: 'Items' },
				{ href: '/locations', label: 'Locations' },
				{ href: '/categories', label: 'Categories' },
				{ href: '/movements', label: 'Movements' }
			]
		},
		{
			kind: 'menu',
			label: 'Shipping & Receiving',
			items: [
				{ href: '/inbound', label: 'Inbound orders' },
				{ href: '/suppliers', label: 'Suppliers' },
				{ href: '/labels', label: 'Label printing' },
				{ href: '/scan', label: 'Scan' }
			]
		},
		{
			kind: 'menu',
			label: 'Listings',
			items: [
				{ href: '/listings', label: 'Dashboard' },
				{ href: '/listings/health', label: 'Listing health' },
				{ href: '/reconcile', label: 'Reconcile (go-live)' },
				{ href: '/reconcile/dead', label: 'Dead listings' },
				{ href: '/listings/cleanup', label: 'Clean up duplicates' }
			]
		}
	];

	// Which dropdown is open (by label). Hover opens; click toggles;
	// click-outside / navigation closes.
	let openMenu = $state<string | null>(null);

	// Close on a short DELAY rather than instantly on mouseleave. Without
	// this, moving the cursor from the top-level button across the small gap
	// to a submenu item triggers mouseleave and the panel vanishes before you
	// can click anything. Entering the button OR the panel cancels a pending
	// close; leaving (re)starts the timer. Re-entering the panel fires
	// mouseenter on this wrapper too (the panel is a descendant), so one pair
	// of handlers on the wrapper covers both.
	const CLOSE_DELAY_MS = 350;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	function openMenuNow(label: string) {
		if (closeTimer) {
			clearTimeout(closeTimer);
			closeTimer = null;
		}
		openMenu = label;
	}
	function scheduleClose() {
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = setTimeout(() => {
			openMenu = null;
			closeTimer = null;
		}, CLOSE_DELAY_MS);
	}
	function closeMenus() {
		if (closeTimer) {
			clearTimeout(closeTimer);
			closeTimer = null;
		}
		openMenu = null;
	}

	// Settings + Help live in a separate utility cluster to keep them
	// distinct from primary navigation — matches Listing Studio's
	// toolbar pattern.
	const utility = [
		{ href: '/help', label: 'Help' },
		{ href: '/settings', label: 'Settings' }
	] as const;

	function isActive(href: string, current: string): boolean {
		if (href === '/') return current === '/';
		return current === href || current.startsWith(href + '/');
	}

	// A menu is "active" (highlighted) when the current route matches any
	// of its child links — so Dad sees which group he's in.
	function menuActive(menu: NavMenu, current: string): boolean {
		return menu.items.some((i) => isActive(i.href, current));
	}

	// Accessibility classes apply to a wrapper div around the whole app.
	// Targeting a wrapper (rather than <body>) lets us drive class state
	// purely from Svelte's reactive system without touching document.body
	// manually — no flicker after hydration.
	let fontScale = $derived(data.preferences?.font_scale ?? 'normal');
	let highContrast = $derived(data.preferences?.high_contrast ?? false);

	// The Listings dashboard is a wide, multi-column grid (item + base +
	// 3 platform price cells + sold), so it needs far more horizontal
	// room than the reading-width pages. Give it a near-full-width
	// container; everything else stays at the comfortable 5xl reading
	// width. (Both literal classes appear here so Tailwind emits them.)
	let mainMaxWidth = $derived(
		page.url.pathname.startsWith('/listings') ? 'max-w-[100rem]' : 'max-w-5xl'
	);
</script>

<div
	class="relative z-10 flex min-h-screen flex-col"
	class:font-scale-large={fontScale === 'large'}
	class:font-scale-xlarge={fontScale === 'xlarge'}
	class:high-contrast={highContrast}
>
	<!-- ============================================================
	     Toolbar — brand left, global search middle, nav + utility right.
	     ============================================================ -->
	<header
		class="sticky top-0 z-30 flex flex-wrap items-center gap-4 border-b border-[color:var(--color-line-dim)] bg-gradient-to-b from-[color:var(--color-panel-2)] to-[color:var(--color-panel)] px-5 py-3 shadow-[inset_0_1px_0_rgba(255,230,180,0.04),inset_0_-1px_0_rgba(0,0,0,0.45)]"
	>
		<a href="/" class="group flex min-w-0 items-center gap-4 overflow-hidden">
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

		<!-- Global search — routes to /items?q=… so the filter UI handles the rest. -->
		<form
			onsubmit={onGlobalSearch}
			class="flex min-w-0 flex-1 items-center"
			role="search"
		>
			<input
				type="search"
				bind:value={globalSearch}
				placeholder="Search SKU, title, brand…"
				aria-label="Global item search"
				class="field max-w-md py-1.5 text-sm"
				style="min-height: 36px"
				autocomplete="off"
			/>
		</form>

		<nav class="flex flex-shrink-0 items-center gap-1">
			{#each nav as item (item.label)}
				{#if item.kind === 'link'}
					{@const active = isActive(item.href, page.url.pathname)}
					<a
						href={item.href}
						onclick={closeMenus}
						class="rounded px-3.5 py-1.5 text-sm font-medium transition-all duration-150 {active
							? 'border border-[color:var(--color-gold-dim)] bg-[color:var(--color-selected)] text-[color:var(--color-ink)]'
							: 'border border-transparent text-[color:var(--color-ink-2)] hover:border-[color:var(--color-line)] hover:bg-[color:var(--color-hover)] hover:text-[color:var(--color-ink)]'}"
					>
						{item.label}
					</a>
				{:else}
					{@const active = menuActive(item, page.url.pathname)}
					{@const isOpen = openMenu === item.label}
					<!-- Dropdown group: hover opens, click toggles, mouse-leave
						 closes. The relative wrapper anchors the absolute panel. -->
					<div
						class="relative"
						role="presentation"
						onmouseenter={() => openMenuNow(item.label)}
						onmouseleave={scheduleClose}
					>
						<button
							type="button"
							aria-haspopup="true"
							aria-expanded={isOpen}
							onclick={() => (isOpen ? closeMenus() : openMenuNow(item.label))}
							class="flex items-center gap-1 rounded px-3.5 py-1.5 text-sm font-medium transition-all duration-150 {active
								? 'border border-[color:var(--color-gold-dim)] bg-[color:var(--color-selected)] text-[color:var(--color-ink)]'
								: 'border border-transparent text-[color:var(--color-ink-2)] hover:border-[color:var(--color-line)] hover:bg-[color:var(--color-hover)] hover:text-[color:var(--color-ink)]'}"
						>
							{item.label}
							<svg
								class="h-3 w-3 transition-transform duration-150 {isOpen ? 'rotate-180' : ''}"
								viewBox="0 0 12 12"
								fill="none"
								aria-hidden="true"
							>
								<path
									d="M3 4.5L6 7.5L9 4.5"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>

						{#if isOpen}
							<div
								class="absolute right-0 top-full z-40 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-[color:var(--color-line-bright)] bg-[color:var(--color-panel)] py-1 shadow-2xl"
							>
								{#each item.items as sub (sub.href)}
									{@const subActive = isActive(sub.href, page.url.pathname)}
									<a
										href={sub.href}
										onclick={closeMenus}
										class="block px-4 py-2 text-sm transition-colors {subActive
											? 'bg-[color:var(--color-selected)] text-[color:var(--color-gold-bright)]'
											: 'text-[color:var(--color-ink-2)] hover:bg-[color:var(--color-hover)] hover:text-[color:var(--color-ink)]'}"
									>
										{sub.label}
									</a>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/each}

			<!-- Utility separator + buttons -->
			<span
				class="mx-2 h-6 w-px bg-gradient-to-b from-transparent via-[color:var(--color-line)] to-transparent"
			></span>

			{#each utility as item (item.href)}
				{@const active = isActive(item.href, page.url.pathname)}
				<a
					href={item.href}
					onclick={closeMenus}
					class="rounded px-3 py-1.5 text-xs font-medium transition-all duration-150 {active
						? 'border border-[color:var(--color-gold-dim)] bg-[color:var(--color-selected)] text-[color:var(--color-ink)]'
						: 'border border-transparent text-[color:var(--color-ink-3)] hover:border-[color:var(--color-line)] hover:bg-[color:var(--color-hover)] hover:text-[color:var(--color-ink)]'}"
				>
					{item.label}
				</a>
			{/each}
		</nav>
	</header>

	<!-- ============================================================
	     Main content.
	     ============================================================ -->
	<main class="mx-auto w-full {mainMaxWidth} flex-1 px-5 py-8">
		{@render children()}
	</main>

	<!-- ============================================================
	     Status bar — mono micro-text.
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
