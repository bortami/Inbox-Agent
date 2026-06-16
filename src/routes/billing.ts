import { Router, raw } from 'express';
import type Stripe from 'stripe';
import {
  getStripe,
  mapSubscriptionStatus,
  isValidTier,
  tierPrices,
  tierFromSubscription,
  DEFAULT_TIER,
} from '../lib/stripe.js';
import { getPortal, getBilling, saveBilling } from '../lib/firestore.js';
import { verifyHubSpotSignature } from '../lib/hubspot-verify.js';

export const billingRouter = Router();

// Stripe webhook lives on its own router so server.ts can mount it BEFORE the global
// express.json() — signature verification needs the unparsed raw body.
export const stripeWebhookRouter = Router();

// GET /billing/checkout?portalId=…&tier=… — creates a Stripe Checkout session
// (subscription mode: the tier's flat price + its metered price) and redirects the
// browser to Stripe. Called from the OAuth callback for new portals (no tier → default)
// and from the Settings page tier picker. Invalid tier → 400.
billingRouter.get('/checkout', async (req, res) => {
  const portalId = req.query.portalId as string | undefined;
  if (!portalId) {
    res.status(400).send('portalId required');
    return;
  }

  const tierParam = req.query.tier as string | undefined;
  if (tierParam && !isValidTier(tierParam)) {
    res.status(400).send('Invalid tier');
    return;
  }
  const tier = isValidTier(tierParam) ? tierParam : DEFAULT_TIER;

  try {
    const portal = await getPortal(portalId);
    if (!portal) {
      res.status(404).send('Portal not found');
      return;
    }

    const billing = await getBilling(portalId);
    const prices = tierPrices(tier);

    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        { price: prices.flat, quantity: 1 },
        { price: prices.metered }, // metered: no quantity
      ],
      // Reuse an existing Stripe customer if this portal has one (e.g. reinstall);
      // otherwise let Checkout collect the email. Keying by email supports future
      // cross-product reconciliation in the Red Anthos universal portal.
      ...(billing?.stripe_customer_id
        ? { customer: billing.stripe_customer_id }
        : billing?.customer_email
          ? { customer_email: billing.customer_email }
          : {}),
      client_reference_id: portalId,
      metadata: { portalId, tier },
      // Stamp the tier on the subscription so subscription.* webhooks can recover it.
      subscription_data: { metadata: { portalId, tier } },
      success_url: `https://app.hubspot.com/contacts/${portalId}`,
      cancel_url: `${process.env.SERVICE_URL}/billing/checkout?portalId=${portalId}&tier=${tier}`,
    });

    // The OAuth callback redirects the browser straight to Stripe (303). The Settings
    // page can't follow a redirect through hubspot.fetch, so it requests ?format=json
    // and opens session.url itself.
    if (req.query.format === 'json') {
      res.json({ url: session.url });
      return;
    }

    res.redirect(303, session.url!);
  } catch (err) {
    console.error('Checkout session error', { portalId, err });
    res.status(500).send('Could not start checkout. Please try again.');
  }
});

// GET /billing/portal — HubSpot-signed (called from Settings page). Returns a Stripe
// Billing Portal URL so the customer can manage/cancel their subscription. Interim
// per-product entry point; the Red Anthos universal portal is the eventual home.
billingRouter.get('/portal', verifyHubSpotSignature, async (req, res) => {
  const portalId = req.query.portalId as string | undefined;
  if (!portalId) {
    res.status(400).json({ error: 'portalId required' });
    return;
  }

  // Static Billing Portal login link (Stripe Dashboard → share link). Used only as a
  // fallback when we can't create a per-customer session — it requires the user to log
  // in via emailed code, vs. the session deep-link which pre-authenticates them.
  const fallbackUrl = process.env.STRIPE_PORTAL_LOGIN_URL;

  try {
    const billing = await getBilling(portalId);

    // No customer yet → can't create a session. Fall back to the static login link.
    if (!billing?.stripe_customer_id) {
      if (fallbackUrl) {
        res.json({ url: fallbackUrl, fallback: true });
        return;
      }
      res.status(404).json({ error: 'No billing customer for this portal' });
      return;
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `https://app.hubspot.com/contacts/${portalId}`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Billing portal session error', { portalId, err });
    // Session creation failed (e.g. Stripe outage) — fall back to the static link
    // rather than leaving the customer with no way to reach billing.
    if (fallbackUrl) {
      res.json({ url: fallbackUrl, fallback: true });
      return;
    }
    res.status(500).json({ error: 'Could not open billing portal' });
  }
});

// GET /billing/status — HubSpot-signed. Lets the Settings page show subscription state.
billingRouter.get('/status', verifyHubSpotSignature, async (req, res) => {
  const portalId = req.query.portalId as string | undefined;
  if (!portalId) {
    res.status(400).json({ error: 'portalId required' });
    return;
  }

  try {
    const billing = await getBilling(portalId);
    res.json({
      status: billing?.status ?? 'none',
      tier: billing?.tier ?? null,
      current_period_end: billing?.current_period_end ?? null,
    });
  } catch (err) {
    console.error('GET /billing/status error', { portalId, err });
    res.status(500).json({ error: 'Could not load billing status' });
  }
});

// POST /billing/webhook — Stripe webhook. Uses raw body for signature verification
// (mounted with express.raw, bypassing the global JSON parser). Updates the /billing
// record as the subscription lifecycle changes (including cancel via the Stripe portal).
stripeWebhookRouter.post(
  '/webhook',
  raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'] as string | undefined;
    let event: Stripe.Event;

    try {
      event = getStripe().webhooks.constructEvent(
        req.body, // Buffer, thanks to express.raw
        sig!,
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
    } catch (err) {
      console.error('Stripe webhook signature verification failed', err);
      res.status(400).send('Invalid signature');
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const portalId = session.metadata?.portalId ?? session.client_reference_id;
          if (portalId) {
            const tier = session.metadata?.tier;
            await saveBilling(portalId, {
              stripe_customer_id:
                typeof session.customer === 'string' ? session.customer : null,
              stripe_subscription_id:
                typeof session.subscription === 'string' ? session.subscription : null,
              customer_email: session.customer_details?.email ?? null,
              status: 'active',
              ...(isValidTier(tier) ? { tier } : {}),
              detached_at: null,
            });
            console.log(`Billing activated via checkout — portal=${portalId} tier=${tier ?? 'unknown'}`);
          }
          break;
        }

        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          const portalId = sub.metadata?.portalId;
          if (portalId) {
            // In Stripe's current API, current_period_end lives on the subscription
            // item, not the subscription. Use the first item's value.
            const periodEnd = sub.items.data[0]?.current_period_end;
            // A plan change in the Billing Portal swaps the price but doesn't update
            // metadata.tier, so derive the current tier from the live price IDs.
            const tier = tierFromSubscription(sub);
            await saveBilling(portalId, {
              stripe_subscription_id: sub.id,
              status: mapSubscriptionStatus(sub.status),
              ...(tier ? { tier } : {}),
              ...(periodEnd ? { current_period_end: periodEnd * 1000 } : {}),
            });
            console.log(`Billing updated — portal=${portalId} status=${sub.status} tier=${tier ?? 'unknown'}`);
          }
          break;
        }

        default:
          // Unhandled event types are acknowledged so Stripe stops retrying.
          break;
      }

      res.json({ received: true });
    } catch (err) {
      console.error('Stripe webhook handler error', { type: event.type, err });
      res.status(500).send('Webhook handler failed');
    }
  },
);
