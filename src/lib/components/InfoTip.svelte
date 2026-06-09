<!--
	InfoTip — a small (ⓘ) trigger that opens an explanation in a modal.

	Originally a hover bubble; switched to click-to-open modal because
	the explanations got long enough that a floating bubble looked
	cramped and the formatting was hard to control. A modal gives the
	content room to breathe, a proper close button, and a blurred
	backdrop so it reads as a deliberate "tell me more" rather than an
	accidental hover.

	Usage (unchanged from the bubble version):
		<InfoTip>This is the explanation body.</InfoTip>
		<InfoTip label="Why?" title="About merging">
			Click to fold this listing into another item…
		</InfoTip>

	Props:
	  - children  (snippet, required) — the modal body. Rich HTML ok:
	                <p>, <strong>, <code> are styled.
	  - label?    — trigger text instead of the default ⓘ glyph (e.g.
	                "Why?"). Also used as the modal title if `title`
	                isn't given.
	  - title?    — modal header text. Defaults to `label` or "Good to know".
	  - side?, maxWidth? — accepted for backward-compat with the old
	                bubble API; ignored.

	Behavior: opens on click (stopPropagation so it never triggers a
	parent row-nav or form submit), closes on ×, backdrop click, or
	Escape. Locks body scroll while open and restores focus to the
	trigger on close. The modal is portaled to <body> so ancestor
	stacking contexts / transforms can't clip it.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, scale } from 'svelte/transition';

	let {
		children,
		label,
		title
	}: {
		children: Snippet;
		label?: string;
		title?: string;
		/** @deprecated — bubble-era props, ignored. */
		side?: 'top' | 'bottom' | 'right';
		/** @deprecated — bubble-era props, ignored. */
		maxWidth?: string;
	} = $props();

	let open = $state(false);
	let triggerEl: HTMLButtonElement | undefined = $state();

	const headerText = $derived(title ?? label ?? 'Good to know');

	function openModal(e: MouseEvent) {
		// Never let the click bubble to a clickable table row / form.
		e.stopPropagation();
		e.preventDefault();
		open = true;
	}

	function closeModal() {
		open = false;
		// Return focus to the trigger for keyboard users.
		triggerEl?.focus();
	}

	// Esc-to-close + body scroll lock while the modal is up.
	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				closeModal();
			}
		};
		document.addEventListener('keydown', onKey, true);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.removeEventListener('keydown', onKey, true);
			document.body.style.overflow = prevOverflow;
		};
	});

	/**
	 * Portal action — relocates the node to <body> so the fixed
	 * overlay is positioned against the viewport, not against any
	 * ancestor that happens to establish a stacking/containing block
	 * (panels with transforms, backdrop-filters, etc.).
	 */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}
</script>

<button
	type="button"
	bind:this={triggerEl}
	class="info-tip-trigger"
	aria-label={label ? `More info: ${label}` : 'More info'}
	aria-haspopup="dialog"
	onclick={openModal}
>
	{#if label}
		<span class="info-tip-label">{label}</span>
	{:else}
		ⓘ
	{/if}
</button>

{#if open}
	<!-- Portaled to body. Backdrop: blur + dim, click-outside closes. -->
	<div
		use:portal
		class="info-tip-backdrop"
		role="dialog"
		aria-modal="true"
		aria-label={headerText}
		tabindex="-1"
		transition:fade={{ duration: 120 }}
		onclick={(e) => {
			if (e.target === e.currentTarget) closeModal();
		}}
		onkeydown={() => {
			/* Escape handled by the document-level listener in $effect */
		}}
	>
		<div class="info-tip-panel" transition:scale={{ duration: 140, start: 0.96 }}>
			<header class="info-tip-header">
				<h2 class="info-tip-title">{headerText}</h2>
				<button
					type="button"
					class="info-tip-close"
					aria-label="Close"
					onclick={closeModal}
				>
					×
				</button>
			</header>
			<div class="info-tip-body">
				{@render children()}
			</div>
		</div>
	</div>
{/if}

<style>
	/* ---- Trigger ---------------------------------------------------- */
	.info-tip-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1rem;
		height: 1rem;
		min-height: 0;
		padding: 0 0.15rem;
		border: none;
		background: transparent;
		color: var(--color-ink-3, #9b9075);
		font-size: 0.7rem;
		line-height: 1;
		cursor: pointer;
		border-radius: 3px;
		transition: color 0.15s ease;
		vertical-align: baseline;
	}
	.info-tip-trigger:hover,
	.info-tip-trigger:focus-visible {
		color: var(--color-gold-bright, #ffd166);
		outline: none;
	}
	.info-tip-label {
		font-size: 0.625rem;
		text-decoration: underline dotted;
		text-underline-offset: 2px;
	}

	/* ---- Backdrop --------------------------------------------------- */
	.info-tip-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(5px);
		-webkit-backdrop-filter: blur(5px);
	}

	/* ---- Panel ------------------------------------------------------ */
	.info-tip-panel {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 32rem;
		max-height: 85vh;
		overflow: hidden;
		background: var(--color-panel, #16140f);
		border: 1px solid var(--color-line-bright, #4a4233);
		border-radius: 8px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
	}

	.info-tip-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1rem 0.85rem 1.25rem;
		border-bottom: 1px solid var(--color-line-dim, #2a261d);
		background: linear-gradient(
			to bottom,
			var(--color-panel-2, #1a1814),
			var(--color-panel, #16140f)
		);
	}
	.info-tip-title {
		margin: 0;
		font-family: var(--font-display, 'Fraunces', Georgia, serif);
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--color-ink, #ebe4d0);
		letter-spacing: 0.01em;
	}
	.info-tip-close {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.85rem;
		height: 1.85rem;
		min-height: 0;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ink-3, #9b9075);
		font-size: 1.5rem;
		line-height: 1;
		cursor: pointer;
		transition:
			color 0.15s ease,
			background 0.15s ease,
			border-color 0.15s ease;
	}
	.info-tip-close:hover,
	.info-tip-close:focus-visible {
		color: var(--color-ink, #ebe4d0);
		background: var(--color-hover, #221f18);
		border-color: var(--color-line-bright, #4a4233);
		outline: none;
	}

	.info-tip-body {
		overflow-y: auto;
		padding: 1.1rem 1.25rem 1.35rem;
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--color-ink-2, #cabf9f);
	}

	/* ---- Body content styling --------------------------------------- */
	.info-tip-body :global(p) {
		margin: 0;
	}
	.info-tip-body :global(p + p) {
		margin-top: 0.7em;
	}
	.info-tip-body :global(ul) {
		margin: 0.5em 0 0;
		padding-left: 1.2em;
		list-style: disc;
	}
	.info-tip-body :global(li) {
		margin-top: 0.25em;
	}
	.info-tip-body :global(code) {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.9em;
		color: var(--color-gold-bright, #ffd166);
		background: rgba(255, 209, 102, 0.08);
		padding: 0.05em 0.3em;
		border-radius: 3px;
	}
	.info-tip-body :global(strong) {
		color: var(--color-gold-bright, #ffd166);
		font-weight: 600;
	}
</style>
