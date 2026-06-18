import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  saveInstallState,
  consumeInstallState,
} from '../lib/firestore.js';
import {
  verifyHandoffToken,
  buildLoginUrl,
  type HandoffAccount,
} from '../lib/redanthos.js';
import {
  exchangeCodeAndSavePortal,
  conflictingPortalForAccount,
  linkAccountToPortal,
  redirectToPayment,
} from './oauth.js';

// HubSpot Marketplace partner sign-in install flow. HubSpot calls this endpoint with
// step=authorize (we send the user to Red Anthos login) and later step=finalize (HubSpot
// hands us the OAuth `code` + our `state`; we link the account and exchange tokens).
// Docs: understand-app-install-flow. Plan: docs/ONBOARDING_PLAN.md.
export const installRouter = Router();

const STATE_TTL_MS = 10 * 60 * 1000;
// HubSpot's returnUrl, stashed at `authorize` so it survives the Red Anthos round-trip
// without depending on Red Anthos preserving our query string when it appends ?ra_token.
// Signed + httpOnly; same-browser; SameSite=None because the redirect chain crosses
// origins (HubSpot → us → redanthos.com → us) and the cookie must ride the cross-site nav.
const RETURN_COOKIE = 'install_return_url';
const RETURN_COOKIE_MAX_AGE_MS = STATE_TTL_MS;

// HubSpot frames this endpoint during install — must allow it as a frame ancestor or the
// embedded browser blocks our pages. Applied to every install route.
installRouter.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://app.hubspot.com https://app-eu1.hubspot.com;",
  );
  next();
});

// GET /install — HubSpot's install URL endpoint. Dispatches on `step`.
installRouter.get('/', async (req, res) => {
  const step = req.query.step as string | undefined;
  const returnUrl = req.query.returnUrl as string | undefined;

  if (!returnUrl) {
    res.status(400).send('Missing returnUrl');
    return;
  }

  if (step === 'authorize') {
    // Stash HubSpot's returnUrl in a signed cookie so we recover it at /install/return
    // regardless of how Red Anthos appends ?ra_token. Then send the user to Red Anthos
    // login; they return to /install/return with the handoff token.
    res.cookie(RETURN_COOKIE, returnUrl, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      signed: true,
      maxAge: RETURN_COOKIE_MAX_AGE_MS,
    });
    const returnTo = new URL('/install/return', process.env.SERVICE_URL!);
    res.redirect(buildLoginUrl(returnTo.toString(), req.query.tier as string | undefined));
    return;
  }

  if (step === 'finalize') {
    await finalize(req, res, returnUrl);
    return;
  }

  res.status(400).send('Unknown install step');
});

// GET /install/return — Red Anthos redirects here after login with ?ra_token. We verify
// it, persist the account against a fresh `state` token, then bounce back to HubSpot's
// returnUrl with that state so HubSpot proceeds to step=finalize.
installRouter.get('/return', async (req, res) => {
  const raToken = req.query.ra_token as string | undefined;
  // Prefer the signed cookie set at authorize; fall back to a preserved query param.
  const returnUrl =
    (req.signedCookies?.[RETURN_COOKIE] as string | undefined) ??
    (req.query.returnUrl as string | undefined);
  res.clearCookie(RETURN_COOKIE);

  if (!returnUrl) {
    res.status(400).send('Missing returnUrl');
    return;
  }
  // On verification failure we still must bounce back to HubSpot, or the user is stuck in
  // an infinite login loop (per HubSpot docs). We append an error the listing can surface.
  if (!raToken) {
    res.redirect(appendParam(returnUrl, 'error', 'signin_required'));
    return;
  }

  let account: HandoffAccount;
  try {
    account = await verifyHandoffToken(raToken);
  } catch (err) {
    console.error('Handoff verification failed (/install/return)', err);
    res.redirect(appendParam(returnUrl, 'error', 'signin_failed'));
    return;
  }

  const state = randomUUID();
  await saveInstallState({
    state,
    redanthos_account_id: account.account_id,
    email: account.email,
    tier: account.tier,
    stripe_customer_id: account.stripe_customer_id,
    expires_at: Date.now() + STATE_TTL_MS,
    created_at: Date.now(),
  });

  res.redirect(appendParam(returnUrl, 'state', state));
});

// step=finalize: validate the state HubSpot echoes back, recover the linked account,
// exchange `code` for tokens, link account ↔ portal (1:1:1), then return to HubSpot.
async function finalize(
  req: import('express').Request,
  res: import('express').Response,
  returnUrl: string,
): Promise<void> {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code || !state) {
    // Can't complete, but must still return to HubSpot to avoid a login loop.
    res.redirect(appendParam(returnUrl, 'error', 'install_failed'));
    return;
  }

  const installState = await consumeInstallState(state);
  if (!installState) {
    console.warn('Install finalize with unknown/expired state', { state });
    res.redirect(appendParam(returnUrl, 'error', 'state_expired'));
    return;
  }

  const account: HandoffAccount = {
    account_id: installState.redanthos_account_id,
    email: installState.email,
    tier: installState.tier ?? null,
    stripe_customer_id: installState.stripe_customer_id ?? null,
  };

  try {
    const { portalId } = await exchangeCodeAndSavePortal(code);

    const conflict = await conflictingPortalForAccount(account.account_id, portalId);
    if (conflict) {
      console.warn(
        `1:1:1 violation — account ${account.account_id} already on portal ${conflict}, ` +
          `blocked install on portal ${portalId}`,
      );
      res.redirect(appendParam(returnUrl, 'error', 'account_in_use'));
      return;
    }

    await linkAccountToPortal(portalId, account);

    // Pay at install — same as the website flow. Send the browser to Checkout for the
    // chosen tier; Checkout's success_url is HubSpot's returnUrl, so install→pay→HubSpot
    // is one continuous path. (Reattach/active portals skip Checkout in redirectToPayment.)
    await redirectToPayment(res, portalId, account.tier, returnUrl);
  } catch (err) {
    console.error('Install finalize error', err);
    res.redirect(appendParam(returnUrl, 'error', 'install_failed'));
  }
}

// Appends a query param to an absolute URL, preserving any HubSpot already added.
function appendParam(url: string, key: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}
