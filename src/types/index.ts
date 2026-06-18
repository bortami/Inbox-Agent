export interface PortalSettings {
  review_owner_email?: string | null;
  notes_enabled?: boolean;
  // Conversations inbox ID to process. null/undefined = process all inboxes (default,
  // non-breaking for existing installs). When set, only emails whose thread belongs to
  // this inbox are processed; others are skipped. See task-handler inbox gate.
  inbox_id?: string | null;
}

export interface Portal {
  install_id: string;  // UUID regenerated on every install — scopes dedupe keys and audit log to a single install lifetime
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp (ms)
  installed_at: number;
  hub_domain: string;
  hub_id: string;
  settings?: PortalSettings;
}

// Billing lives in its own /billing/{portalId} collection, NOT on the Portal doc,
// so it survives an uninstall (which deletes /portals). Holds only Stripe IDs +
// status — no HubSpot content — so retaining it past data deletion is defensible.
export type BillingTier = 'starter' | 'growth' | 'pro' | 'enterprise';

export type BillingStatus =
  | 'none'       // no subscription ever created
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'detached';  // app uninstalled but subscription left intact (grace period running)

export interface BillingRecord {
  portal_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: BillingStatus;
  tier?: BillingTier | null;          // which pricing tier the active subscription is on
  customer_email?: string | null;     // keyed by email for future cross-product reconciliation
  current_period_end?: number;        // Unix ms
  detached_at?: number | null;        // Unix ms the portal was uninstalled; drives grace-period sweep
  // Red Anthos account link (durable cross-product identity). Set during account-first
  // install; enforces the 1 account → 1 portal rule. See docs/REDANTHOS_DEV_SPEC.md §6.
  redanthos_account_id?: string | null;
  linked_at?: number | null;          // Unix ms the account ↔ portal link was established
  updated_at: number;
}

// Short-lived record persisted between the partner-sign-in `authorize` and `finalize`
// steps. Keyed by the random `state` token we hand to HubSpot; holds the verified
// Red Anthos handoff so `finalize` can link the portal without re-verifying the JWT.
export interface InstallState {
  state: string;
  redanthos_account_id: string;
  email: string;
  tier?: BillingTier | null;
  stripe_customer_id?: string | null;
  expires_at: number;   // Unix ms; also drives the Firestore TTL policy on /installStates
  created_at: number;
}

export interface DedupeKey {
  portal_id: string;
  message_id: string;
  created_at: number;
}

export interface AuditLog {
  portal_id: string;
  install_id?: string;
  message_id: string;
  conversation_id: string;
  source_classified: string | null;
  extraction_json: Record<string, unknown> | null;
  confidence: 'high' | 'medium' | 'low' | null;
  outcome: 'created' | 'updated' | 'skipped' | 'errored' | 'queued_for_review' | 'skipped_unpaid';
  hubspot_contact_id: string | null;
  created_at: number;
}

export interface WebhookEvent {
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  subscriptionType: string;
  attemptNumber: number;
  objectId: number;
  messageId: string;
  messageType?: string;
}

export interface TaskPayload {
  portalId: number;
  event: WebhookEvent;
}
