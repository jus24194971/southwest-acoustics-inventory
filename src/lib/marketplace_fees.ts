/**
 * Platform fee schedules for grossing up listing prices so the
 * seller nets the inventory's base price after the platform takes
 * its cut. Source of truth for the per-listing-page price
 * pre-fill — Dad can still override per listing if a specific item
 * warrants different pricing.
 *
 * Rates verified late 2025 per the platforms' published fee pages.
 * Re-check periodically — these change a few times a year.
 *
 * Algebra used to compute the gross price G that nets the seller
 * base B after a percentage `p` and a fixed `f` fee per transaction:
 *
 *     gross - (gross × p) - f = base
 *     gross × (1 - p) = base + f
 *     gross = (base + f) / (1 - p)
 *
 * The math holds across percentage-only and fixed-only fees, and we
 * round UP to the nearest cent so Dad never nets below the base due
 * to rounding losses.
 */

export interface FeeSchedule {
	/** Percentage fee as a decimal: 0.05 = 5% */
	percent: number;
	/** Fixed dollar amount per transaction */
	fixed: number;
	/** Human label used in UI breakdowns / tooltips */
	label: string;
	/** Link to the platform's published fee page */
	docsUrl: string;
}

/**
 * Reverb standard seller fees as of late 2025:
 *   - Selling fee:      5% of sale (min $0.50, max $500)
 *   - Payment processing: 3.19% + $0.49 per transaction (Reverb Payments)
 *
 * Combined: 8.19% + $0.49 per transaction.
 *
 * Reverb Preferred Sellers get a discount on processing (2.99%).
 * See REVERB_PREFERRED_FEES below; switch to that if Dad reaches
 * that tier.
 */
export const REVERB_FEES: FeeSchedule = {
	percent: 0.0819,
	fixed: 0.49,
	label: 'Reverb 5% selling + 3.19% processing + $0.49',
	docsUrl: 'https://reverb.com/selling/selling-fees'
};

/**
 * Reverb Preferred Seller rates — 0.2 percentage points lower on
 * payment processing. Apply when Dad's account qualifies.
 */
export const REVERB_PREFERRED_FEES: FeeSchedule = {
	percent: 0.0799,
	fixed: 0.49,
	label: 'Reverb Preferred 5% selling + 2.99% processing + $0.49',
	docsUrl: 'https://reverb.com/selling/selling-fees'
};

/**
 * eBay final value fee for Guitars & Basses (and most musical
 * instrument categories) as of late 2025: 12% FVF + $0.30 per
 * order. FVF is capped at $350 per item for sellers without a
 * store subscription.
 *
 * Other eBay categories have different rates; if we ever sell
 * non-instrument items via eBay, this needs to fork.
 */
export const EBAY_GUITAR_FEES: FeeSchedule = {
	percent: 0.12,
	fixed: 0.3,
	label: 'eBay 12% FVF (Guitars & Basses) + $0.30 per order',
	docsUrl: 'https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822'
};

/**
 * Compute the gross listing price (in cents) that nets the seller
 * `baseCents` after the platform's fee schedule. Returns 0 when
 * baseCents <= 0 (no-op for items without a price set yet).
 *
 * Rounded UP to the nearest cent so the seller is never short.
 */
export function grossUpForFees(baseCents: number, fees: FeeSchedule): number {
	if (baseCents <= 0) return 0;
	const baseDollars = baseCents / 100;
	const grossDollars = (baseDollars + fees.fixed) / (1 - fees.percent);
	return Math.ceil(grossDollars * 100);
}

/**
 * Inverse of grossUpForFees — compute the platform's take given a
 * gross listing price. Useful for "if you list at $X you keep $Y"
 * UI breakdowns.
 */
export function feesOnPrice(grossCents: number, fees: FeeSchedule): number {
	if (grossCents <= 0) return 0;
	const grossDollars = grossCents / 100;
	const feeDollars = grossDollars * fees.percent + fees.fixed;
	return Math.round(feeDollars * 100);
}
