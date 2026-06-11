import React, { useState, useEffect } from 'react';
import {
  hubspot,
  Button,
  Flex,
  Heading,
  LoadingSpinner,
  Select,
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

interface Settings {
  review_owner_email: string | null;
  notes_enabled: boolean;
}

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

  useEffect(() => {
    const load = async () => {
      try {
        // Fetch current settings and paginated owners list in parallel (first page of owners).
        const [settingsRes, firstOwnersRes] = await Promise.all([
          hubspot.fetch(`${CLOUD_RUN_URL}/settings?portalId=${portalId}`),
          hubspot.fetch(`${CLOUD_RUN_URL}/owners?portalId=${portalId}`),
        ]);

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
    </Flex>
  );
};
