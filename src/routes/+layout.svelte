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
	type NavLink = { kind: 'link'; href: string; label: string; icon: string };
	type NavMenu = {
		kind: 'menu';
		label: string;
		icon: string;
		items: { href: string; label: string; icon: string }[];
	};
	const nav: (NavLink | NavMenu)[] = [
		{ kind: 'link', href: '/', label: 'Overview', icon: 'grid' },
		{ kind: 'link', href: '/issues', label: 'Issues', icon: 'alert' },
		{
			kind: 'menu',
			label: 'Inventory',
			icon: 'box',
			items: [
				{ href: '/items', label: 'Items', icon: 'box' },
				{ href: '/locations', label: 'Locations', icon: 'pin' },
				{ href: '/categories', label: 'Categories', icon: 'list' },
				{ href: '/movements', label: 'Movements', icon: 'trend' }
			]
		},
		{
			kind: 'menu',
			label: 'Shipping & Receiving',
			icon: 'truck',
			items: [
				{ href: '/inbound', label: 'Inbound orders', icon: 'inbox' },
				{ href: '/suppliers', label: 'Suppliers', icon: 'users' },
				{ href: '/labels', label: 'Label printing', icon: 'printer' },
				{ href: '/scan', label: 'Scan', icon: 'scan' }
			]
		},
		{
			kind: 'menu',
			label: 'Listings',
			icon: 'tag',
			items: [
				{ href: '/listings', label: 'Dashboard', icon: 'grid' },
				{ href: '/listings/health', label: 'Listing health', icon: 'pulse' },
				{ href: '/reconcile', label: 'Reconcile (go-live)', icon: 'refresh' },
				{ href: '/reconcile/dead', label: 'Dead listings', icon: 'trash' },
				{ href: '/listings/cleanup', label: 'Clean up duplicates', icon: 'sparkles' }
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
		{ href: '/help', label: 'Help', icon: 'help' },
		{ href: '/settings', label: 'Settings', icon: 'gear' }
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
	{#snippet navIcon(name: string)}
		<svg
			class="nav-ico"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{#if name === 'grid'}
				<rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect
					x="3"
					y="14"
					width="7"
					height="7"
					rx="1"
				/><rect x="14" y="14" width="7" height="7" rx="1" />
			{:else if name === 'alert'}
				<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path
					d="M12 9v4"
				/><path d="M12 17h.01" />
			{:else if name === 'box'}
				<path d="M21 8 12 3 3 8l9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" />
			{:else if name === 'truck'}
				<path d="M1 5h13v9H1z" /><path d="M14 8h4l3 3v3h-7z" /><circle cx="5.5" cy="17" r="1.7" /><circle
					cx="17.5"
					cy="17"
					r="1.7"
				/>
			{:else if name === 'tag'}
				<path d="M20.6 13.4 13 21l-9-9V4h8z" /><circle cx="8" cy="8" r="1.3" />
			{:else if name === 'pin'}
				<path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" />
			{:else if name === 'list'}
				<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
			{:else if name === 'trend'}
				<path d="M3 17 10 10l4 4 7-7" /><path d="M15 7h6v6" />
			{:else if name === 'inbox'}
				<path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5 5h14l3 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6z" />
			{:else if name === 'users'}
				<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="3.5" /><path
					d="M22 21v-2a4 4 0 0 0-3-3.9"
				/><path d="M16 3.1a4 4 0 0 1 0 7.8" />
			{:else if name === 'printer'}
				<path d="M6 9V3h12v6" /><path
					d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"
				/><path d="M6 14h12v7H6z" />
			{:else if name === 'scan'}
				<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path
					d="M3 12h18"
				/>
			{:else if name === 'pulse'}
				<path d="M3 12h4l3 8 4-16 3 8h4" />
			{:else if name === 'refresh'}
				<path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path
					d="M21 12a9 9 0 0 1-15 6.7L3 16"
				/><path d="M3 21v-5h5" />
			{:else if name === 'trash'}
				<path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path
					d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"
				/><path d="M10 11v6M14 11v6" />
			{:else if name === 'sparkles'}
				<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5 10.2 7.7z" /><path
					d="M19 14l.9 2.3 2.3.9-2.3.9L19 20.4l-.9-2.3-2.3-.9 2.3-.9z"
				/>
			{:else if name === 'help'}
				<circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" /><path
					d="M12 17h.01"
				/>
			{:else if name === 'gear'}
				<circle cx="12" cy="12" r="3" /><path
					d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L16.5 3h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z"
				/>
			{/if}
		</svg>
	{/snippet}

	<!-- ============================================================
	     Toolbar — brand left, global search middle, nav + utility right.
	     ============================================================ -->
	<header
		class="sticky top-0 z-30 flex flex-wrap items-center gap-4 border-b border-[color:var(--color-line-dim)] px-5 py-3 shadow-[inset_0_1px_0_rgba(255,230,180,0.06),inset_0_-1px_0_rgba(0,0,0,0.5)]"
		style="background: linear-gradient(180deg, #352b1f 0%, #2a2118 55%, #241d15 100%)"
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
		<form onsubmit={onGlobalSearch} class="relative flex min-w-0 flex-1 items-center" role="search">
			<svg
				class="pointer-events-none absolute left-3 z-10 h-4 w-4 text-[color:var(--color-ink-3)]"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<circle cx="11" cy="11" r="7" />
				<path d="m21 21-4.3-4.3" />
			</svg>
			<input
				type="search"
				bind:value={globalSearch}
				placeholder="Search SKU, title, brand…"
				aria-label="Global item search"
				class="field field-search max-w-md py-1.5 text-sm"
				style="min-height: 38px"
				autocomplete="off"
			/>
		</form>

		<nav class="flex flex-shrink-0 items-center gap-1.5">
			{#each nav as item (item.label)}
				{#if item.kind === 'link'}
					{@const active = isActive(item.href, page.url.pathname)}
					<a href={item.href} onclick={closeMenus} class="nav-link {active ? 'is-active' : ''}">
						{@render navIcon(item.icon)}
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
							class="nav-link {active ? 'is-active' : ''}"
						>
							{@render navIcon(item.icon)}
							{item.label}
							<svg
								class="nav-caret {isOpen ? 'rotate-180' : ''}"
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
							<div class="menu-panel">
								{#each item.items as sub (sub.href)}
									{@const subActive = isActive(sub.href, page.url.pathname)}
									<a
										href={sub.href}
										onclick={closeMenus}
										class="menu-item {subActive ? 'is-active' : ''}"
									>
										{@render navIcon(sub.icon)}
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
				class="mx-1 h-6 w-px bg-gradient-to-b from-transparent via-[color:var(--color-line)] to-transparent"
			></span>

			{#each utility as item (item.href)}
				{@const active = isActive(item.href, page.url.pathname)}
				<a
					href={item.href}
					onclick={closeMenus}
					class="nav-link {active ? 'is-active' : ''}"
					style="font-size: 0.8rem"
				>
					{@render navIcon(item.icon)}
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
