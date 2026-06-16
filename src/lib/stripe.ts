import Stripe from 'stripe';
import type { BillingStatus, BillingTier } from '../types/index.js';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return _stripe;
}

export const BILLING_TIERS: readonly BillingTier[] = ['starter', 'growth', 'pro', 'enterprise'];

// The tier a portal lands on at install when none is chosen (e.g. the OAuth redirect).
export const DEFAULT_TIER: BillingTier = (process.env.STRIPE_DEFAULT_TIER as BillingTier) ?? 'starter';

export function isValidTier(tier: string | undefined): tier is BillingTier {
  return !!tier && (BILLING_TIERS as readonly string[]).includes(tier);
}

// Resolves a tier to its flat + metered Stripe price IDs from env. One Product, one
// shared meter; each tier pairs a flat price with its own metered price (per-tier rate).
// Env vars: STRIPE_PRICE_<TIER>_FLAT and STRIPE_PRICE_<TIER>_METERED.
export function tierPrices(tier: BillingTier): { flat: string; metered: string } {
  const upper = tier.toUpperCase();
  const flat = process.env[`STRIPE_PRICE_${upper}_FLAT`];
  const metered = process.env[`STRIPE_PRICE_${upper}_METERED`];
  if (!flat || !metered) {
    throw new Error(`Missing Stripe price env vars for tier "${tier}"`);
  }
  return { flat, metered };
}

// Single source of truth for "is this portal allowed to process leads".
// trialing and active both grant access; everything else soft-blocks.
export function isBillingActive(status: BillingStatus | undefined): boolean {
  return status === 'active' || status === 'trialing';
}

// Reverse-maps a subscription back to its tier by matching its price IDs against the
// per-tier env config. Used when a Billing Portal plan change updates the price but
// not the subscription's metadata. Returns null if no tier's prices match.
export function tierFromSubscription(sub: Stripe.Subscription): BillingTier | null {
  const priceIds = new Set(
    sub.items.data.map(item => item.price?.id).filter((id): id is string => !!id),
  );
  for (const tier of BILLING_TIERS) {
    let prices;
    try {
      prices = tierPrices(tier);
    } catch {
      continue; // tier not configured in this environment
    }
    if (priceIds.has(prices.flat) || priceIds.has(prices.metered)) {
      return tier;
    }
  }
  return null;
}

// Maps a Stripe subscription status to our internal BillingStatus.
export function mapSubscriptionStatus(status: Stripe.Subscription.Status): BillingStatus {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      // incomplete, paused, etc. — treat as not-yet-active (soft-block)
      return 'none';
  }
}

// Records one processed lead against the metered price. messageId is used as the
// idempotency identifier so Cloud Tasks retries never double-bill the same lead.
export async function recordLeadUsage(
  stripeCustomerId: string,
  messageId: string,
): Promise<void> {
  await getStripe().billing.meterEvents.create({
    event_name: 'lead_processed',
    payload: {
      stripe_customer_id: stripeCustomerId,
      value: '1',
    },
    identifier: messageId,
  });
}

// Cancels a subscription immediately. Used by the grace-period sweep for portals
// that have stayed detached past the grace window — never called on uninstall itself.
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await getStripe().subscriptions.cancel(subscriptionId);
}
