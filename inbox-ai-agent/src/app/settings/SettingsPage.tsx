import React, { useState, useEffect } from 'react';
import {
  hubspot,
  Button,
  Divider,
  Flex,
  Heading,
  Link,
  LoadingSpinner,
  Select,
  Text,
  Toggle,
} from '@hubspot/ui-extensions';
import type { ExtensionPointApiActions, SettingsContext } from '@hubspot/ui-extensions';

const CLOUD_RUN_URL = 'https://inbox-agent-483790599125.us-central1.run.app';

// Fetch up to 500 owners across paginated responses.
const MAX_OWNER_PAGES = 5;

interface Owner {
  label: string;
  value: string;
}

interface InboxOption {
  label: string;
  value: string;
}

interface Settings {
  review_owner_email: string | null;
  notes_enabled: boolean;
  inbox_id: string | null;
}

// Sentinel value for the "process all inboxes" choice. The Select can't use an empty
// string as a distinct option value, so we map this to inbox_id: null on save.
const ALL_INBOXES = '__all__';

interface SettingsExtensionProps {
  context: SettingsContext;
  actions: ExtensionPointApiActions<'settings'>;
}

hubspot.extend<'settings'>(({ context, actions }: SettingsExtensionProps) => (
  <SettingsPage context={context} actions={actions} />
));

const SettingsPage = ({ context, actions }: SettingsExtensionProps) => {
  const portalId = String(context.portal.id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [allOwners, setAllOwners] = useState<Owner[]>([]);
  const [filteredOwners, setFilteredOwners] = useState<Owner[]>([]);

  const [reviewOwnerEmail, setReviewOwnerEmail] = useState('');
  const [notesEnabled, setNotesEnabled] = useState(true);

  const [inboxes, setInboxes] = useState<InboxOption[]>([]);
  const [selectedInbox, setSelectedInbox] = useState<string>(ALL_INBOXES);

  const [billingStatus, setBillingStatus] = useState<string>('none');
  const [billingTier, setBillingTier] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('starter');
  const [billingBusy, setBillingBusy] = useState(false);
  const [stripeUrl, setStripeUrl] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        // Fetch current settings, owners (first page), inboxes, and billing status in parallel.
        const [settingsRes, firstOwnersRes, inboxesRes, billingRes] = await Promise.all([
          hubspot.fetch(`${CLOUD_RUN_URL}/settings?portalId=${portalId}`),
          hubspot.fetch(`${CLOUD_RUN_URL}/owners?portalId=${portalId}`),
          hubspot.fetch(`${CLOUD_RUN_URL}/inboxes?portalId=${portalId}`),
          hubspot.fetch(`${CLOUD_RUN_URL}/billing/status?portalId=${portalId}`),
        ]);

        if (billingRes?.ok) {
          const b = (await billingRes.json().catch(() => null)) as {
            status?: string;
            tier?: string | null;
          } | null;
          if (b?.status) setBillingStatus(b.status);
          if (b?.tier) {
            setBillingTier(b.tier);
            setSelectedTier(b.tier);
          }
        }

        if (!settingsRes) {
          actions.addAlert({
            type: 'danger',
            message: 'No response from settings endpoint.',
          });
        } else if (!settingsRes.ok) {
          const body = await settingsRes.text().catch(() => '');
          actions.addAlert({
            type: 'danger',
            message: `Settings load failed (${settingsRes.status}): ${body || 'no response body'}`,
          });
        } else {
          const raw = await settingsRes.text().catch(() => '');
          if (!raw) {
            actions.addAlert({
              type: 'warning',
              message: 'Settings endpoint returned an empty body.',
            });
          } else {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              actions.addAlert({
                type: 'danger',
                message: `Settings response was not valid JSON: ${raw.slice(0, 200)}`,
              });
              parsed = null;
            }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const s = parsed as Partial<Settings>;
              setReviewOwnerEmail(s.review_owner_email ?? '');
              setNotesEnabled(typeof s.notes_enabled === 'boolean' ? s.notes_enabled : true);
              setSelectedInbox(s.inbox_id ?? ALL_INBOXES);
            } else if (parsed !== null) {
              actions.addAlert({
                type: 'danger',
                message: `Settings response had unexpected shape: ${raw.slice(0, 200)}`,
              });
            }
          }
        }

        // Collect owners across all pages.
        const owners: Owner[] = [];

        const appendPage = (results: Array<{ email: string; firstName?: string; lastName?: string }>) => {
          for (const o of results ?? []) {
            owners.push({
              label: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email,
              value: o.email,
            });
          }
        };

        if (!firstOwnersRes) {
          actions.addAlert({
            type: 'danger',
            message: 'No response from HubSpot owners API.',
          });
        } else if (!firstOwnersRes.ok) {
          const body = await firstOwnersRes.text().catch(() => '');
          actions.addAlert({
            type: 'warning',
            message: `Could not load users (${firstOwnersRes.status}): ${body || 'no response body'}`,
          });
        } else {
          const firstPage = (await firstOwnersRes.json()) as {
            results: Array<{ email: string; firstName?: string; lastName?: string }>;
            paging?: { next?: { after: string } };
          };
          appendPage(firstPage.results);

          let after = firstPage.paging?.next?.after;
          let page = 1;

          while (after && page < MAX_OWNER_PAGES) {
            const res = await hubspot.fetch(
              `${CLOUD_RUN_URL}/owners?portalId=${portalId}&after=${after}`,
            );
            if (!res.ok) break;
            const data = (await res.json()) as {
              results: Array<{ email: string; firstName?: string; lastName?: string }>;
              paging?: { next?: { after: string } };
            };
            appendPage(data.results);
            after = data.paging?.next?.after;
            page++;
          }
        }

        setAllOwners(owners);
        setFilteredOwners(owners);

        // Load the portal's conversations inboxes for the dropdown. A failure here is
        // non-fatal — the user can still save other settings and keep "All inboxes".
        if (inboxesRes?.ok) {
          const data = (await inboxesRes.json().catch(() => null)) as {
            results?: Array<{ id: string; name: string }>;
          } | null;
          setInboxes((data?.results ?? []).map(i => ({ label: i.name, value: i.id })));
        } else if (inboxesRes) {
          const body = await inboxesRes.text().catch(() => '');
          actions.addAlert({
            type: 'warning',
            message: `Could not load inboxes (${inboxesRes.status}): ${body || 'no response body'}`,
          });
        }
      } catch {
        actions.addAlert({ type: 'danger', message: 'Failed to load settings.' });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const handleOwnerSearch = (search: string) => {
    if (!search) {
      setFilteredOwners(allOwners);
      return;
    }
    const lower = search.toLowerCase();
    setFilteredOwners(
      allOwners.filter(
        o => o.label.toLowerCase().includes(lower) || o.value.toLowerCase().includes(lower),
      ),
    );
  };

  // Fetches a Stripe-hosted URL (Checkout or Billing Portal) and surfaces it as a
  // clickable Link that opens in a new tab. Stripe sets frame-ancestors/X-Frame-Options
  // that block iframing its hosted pages, so we must NOT embed them — a new-tab link is
  // the supported pattern. hubspot.fetch also can't follow the 303, so the endpoints
  // return { url }.
  const fetchStripeUrl = async (path: string) => {
    setBillingBusy(true);
    setStripeUrl(null);
    try {
      const res = await hubspot.fetch(`${CLOUD_RUN_URL}${path}`);
      if (!res?.ok) {
        actions.addAlert({ type: 'danger', message: 'Could not reach Stripe. Please try again.' });
        return;
      }
      const data = (await res.json().catch(() => null)) as { url?: string } | null;
      if (data?.url) {
        setStripeUrl(data.url);
      } else {
        actions.addAlert({ type: 'danger', message: 'Stripe did not return a URL.' });
      }
    } catch {
      actions.addAlert({ type: 'danger', message: 'Could not reach Stripe. Please try again.' });
    } finally {
      setBillingBusy(false);
    }
  };

  const isActive = billingStatus === 'active' || billingStatus === 'trialing';
  const hasCustomer = billingStatus !== 'none';

  const save = async () => {
    setSaving(true);
    try {
      const res = await hubspot.fetch(`${CLOUD_RUN_URL}/settings`, {
        method: 'POST',
        body: {
          portalId,
          settings: {
            review_owner_email: reviewOwnerEmail || null,
            notes_enabled: notesEnabled,
            inbox_id: selectedInbox === ALL_INBOXES ? null : selectedInbox,
          },
        },
      });
      if (res.ok) {
        actions.addAlert({ type: 'success', message: 'Settings saved.' });
      } else {
        actions.addAlert({ type: 'danger', message: 'Failed to save settings.' });
      }
    } catch {
      actions.addAlert({ type: 'danger', message: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner label="Loading settings…" />;
  }

  return (
    <Flex direction="column" gap="medium">
      <Heading>Processing</Heading>

      <Select
        label="Inbox to monitor"
        value={selectedInbox}
        options={[
          { label: 'All inboxes', value: ALL_INBOXES },
          ...inboxes,
        ]}
        onChange={value => setSelectedInbox(String(value))}
      />
      <Text variant="microcopy">
        Only emails arriving in the selected inbox are turned into contacts. Choose “All
        inboxes” to process every conversations inbox.
      </Text>

      <Toggle
        label="Create a Note on Contact per email"
        checked={notesEnabled}
        onChange={setNotesEnabled}
      />

      <Select
        label="Assign low-confidence emails to"
        placeholder="Search users…"
        value={reviewOwnerEmail}
        options={filteredOwners}
        onChange={value => setReviewOwnerEmail(String(value))}
        onInput={handleOwnerSearch}
      />

      <Button variant="primary" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </Button>

      <Divider />

      <Heading>Billing</Heading>

      <Text>
        Subscription status: <Text format={{ fontWeight: 'bold' }} inline>{billingStatus}</Text>
        {billingTier && <> · Plan: <Text format={{ fontWeight: 'bold' }} inline>{billingTier}</Text></>}
        {!isActive && '. Leads are not processed until your subscription is active.'}
      </Text>

      {hasCustomer ? (
        <>
          <Button onClick={() => fetchStripeUrl(`/billing/portal?portalId=${portalId}`)} disabled={billingBusy}>
            {billingBusy ? 'Preparing…' : 'Manage subscription'}
          </Button>
          <Text variant="microcopy">
            Change plan, update payment, or cancel in the Stripe billing portal.
          </Text>
        </>
      ) : (
        <>
          <Select
            label="Plan"
            value={selectedTier}
            options={[
              { label: 'Starter', value: 'starter' },
              { label: 'Growth', value: 'growth' },
              { label: 'Pro', value: 'pro' },
              { label: 'Enterprise', value: 'enterprise' },
            ]}
            onChange={value => setSelectedTier(String(value))}
          />
          <Button
            variant="primary"
            onClick={() => fetchStripeUrl(`/billing/checkout?portalId=${portalId}&tier=${selectedTier}&format=json`)}
            disabled={billingBusy}
          >
            {billingBusy ? 'Preparing…' : 'Subscribe'}
          </Button>
        </>
      )}

      {stripeUrl && (
        <Text>
          <Link href={{ url: stripeUrl, external: true }}>
            {hasCustomer ? 'Open the Stripe billing portal →' : 'Continue to secure Stripe checkout →'}
          </Link>
        </Text>
      )}
    </Flex>
  );
};
