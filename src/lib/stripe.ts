import Stripe from 'stripe';
import type { BillingStatus, BillingTier } from '../types/index.js';
import pricing from '../config/pricing.json' with { type: 'json' };

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

// Monthly lead allotment per tier, shown as the "of Y" in the usage display. The flat +
// metered pricing model doesn't encode an included quota in Stripe, so the allotment comes
// from the canonical pricing definition (src/config/pricing.json — same `includedEmails`
// shown on the pricing page), keeping a single source of truth.
export function tierAllotment(tier: BillingTier): number {
  return pricing.tiers[tier].includedEmails;
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

// Current-period lead usage read back from Stripe's metered events: how many
// `lead_processed` events the customer has accrued in the active billing period.
export interface LeadUsage {
  used: number;
  period_start: number; // Unix ms
  period_end: number;   // Unix ms
}

// Rounds a Unix-seconds timestamp down to the minute — meter event summaries require
// start/end times aligned to a minute boundary.
function floorToMinute(unixSeconds: number): number {
  return Math.floor(unixSeconds / 60) * 60;
}

// Reads the customer's lead usage for the subscription's current billing period from
// Stripe. Resolves the period window from the live subscription (not the cached billing
// record) so it's always the true active period, then sums the meter event summaries for
// the shared lead meter. Requires STRIPE_METER_ID. Returns null if usage can't be read
// (no active subscription, meter not configured) — callers should treat that as "unknown".
export async function getMonthlyLeadUsage(
  stripeCustomerId: string,
  subscriptionId: string,
): Promise<LeadUsage | null> {
  const meterId = process.env.STRIPE_METER_ID;
  if (!meterId) {
    console.error('STRIPE_METER_ID not set — cannot read lead usage');
    return null;
  }

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  // In Stripe's current API the billing period lives on the subscription items, not the
  // subscription itself (matches how the webhook handler reads current_period_end).
  const item = sub.items.data[0];
  const periodStart = item?.current_period_start;
  const periodEnd = item?.current_period_end;
  if (!periodStart || !periodEnd) return null;

  const startSec = floorToMinute(periodStart);
  const endSec = floorToMinute(periodEnd);

  // No value_grouping_window → a single summary for the whole range. Sum defensively in
  // case Stripe returns more than one bucket.
  let used = 0;
  for await (const summary of stripe.billing.meters.listEventSummaries(meterId, {
    customer: stripeCustomerId,
    start_time: startSec,
    end_time: endSec,
  })) {
    used += summary.aggregated_value;
  }

  return {
    used,
    period_start: periodStart * 1000,
    period_end: periodEnd * 1000,
  };
}

// Cancels a subscription immediately. Used by the grace-period sweep for portals
// that have stayed detached past the grace window — never called on uninstall itself.
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await getStripe().subscriptions.cancel(subscriptionId);
}
