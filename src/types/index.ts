export interface PortalSettings {
  review_owner_email?: string | null;
  notes_enabled?: boolean;
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
  outcome: 'created' | 'updated' | 'skipped' | 'errored' | 'queued_for_review';
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
