# LeadCatch — Privacy Policy & Terms of Service Spec

Outline and source-of-truth for the LeadCatch **Privacy Policy** and **Terms of Service**.
These are LeadCatch-specific (the Red Anthos master policies do not cover this product's
HubSpot data flows). The **final hosted pages live in the Red Anthos repo**; this file is
the spec the author works from, anchored to what the code actually does.

HubSpot Marketplace requires both as separate, live, login-free public URLs. The "Shared
data" listing table must match the Privacy Policy.

> **Maintenance rule:** when a data flow, retention behavior, or sub-processor changes in
> this repo, update this spec **and** the hosted pages. Citations below point at the code
> that must stay true.

---

## Part 0 — Ground truth: what LeadCatch actually does with data

Everything in the legal docs must trace back to one of these. Verified against the code on
the date of writing.

### Data LeadCatch reads (input)
- **HubSpot Conversations email bodies.** On a `conversation.newMessage` webhook, the
  service fetches the full message text via the Conversations API
  ([hubspot-conversations.ts](../src/lib/hubspot-conversations.ts), [task-handler.ts](../src/routes/task-handler.ts)).
  These emails are from the dealer's prospective buyers and contain personal data (name,
  email, phone, free-text message, vehicle/listing interest).
- **HubSpot owners list** — names/emails of the portal's users, to populate the review-owner
  picker on the Settings page (`crm.objects.owners.read`).

### Data LeadCatch writes (output, into the customer's own HubSpot)
- **Contact** upserted by email, with standard fields (firstname, lastname, phone) plus
  `inbox_agent_*` custom properties (inquiry message, lead source, listing ref, processed-at)
  ([hubspot-writer.ts](../src/lib/hubspot-writer.ts) `upsertContact`).
- **Note** engagement per processed email, carrying the message + confidence + source
  (`createNote`; can be disabled per-portal via `notes_enabled`).
- **Thread assignment** — low-confidence/invalid-email inquiries are assigned to a review
  owner in the customer's inbox (`conversations.write`).

### Data LeadCatch stores (in our own infrastructure — Google Cloud / Firestore)
Be precise here; this is the heart of the Privacy Policy.

| Store | Contents | Personal data? | Retention |
|---|---|---|---|
| `portals/{portalId}` | OAuth access + refresh tokens, hub domain/id, per-portal settings | Tokens (sensitive), not buyer PII | Until uninstall, then **deleted** (`deletePortalData`) |
| `auditLog/{id}` | Per-email processing record incl. **`extraction_json`** (name, email, phone, message), source, confidence, outcome, HubSpot contact id | **Yes — buyer PII** | **90-day** rolling TTL (`ttl_at`, [firestore.ts](../src/lib/firestore.ts)); also **deleted on uninstall** (`deletePortalData` batch-deletes by portal) |
| `dedupeKeys/{key}` | install id + email + listing ref + hour bucket (hashed-style composite key), message id | Email embedded in key | **24h** Firestore TTL ([firestore.ts](../src/lib/firestore.ts)) |
| `billing/{portalId}` | Stripe customer/subscription ids, status, tier, **customer email**, Red Anthos account id | Account/billing email only — **no buyer content** | **Survives uninstall by design** (needed to cancel the Stripe subscription after grace period). See note below. |
| `installStates/{state}` | Short-lived install handoff (Red Anthos account id, email, tier) | Account email | **10 min** TTL |
| `usedJtis/{jti}` | Consumed handoff-token ids (replay protection) | No | **24h** TTL |
| `appState/journalOffset` | HubSpot journal read cursor | No | Indefinite (operational) |

**Two facts the Privacy Policy must state plainly:**
1. **The audit log (incl. buyer personal data) is retained for 90 days** on a rolling TTL,
   and is also deleted immediately for a portal on uninstall. State the 90-day window as the
   retention claim. (Implemented via `ttl_at` in code; the matching Firestore TTL policy must
   be enabled on the collection — see todo.md.)
2. **The billing record intentionally outlives uninstall.** It contains Stripe ids + the
   billing/account email only — **no buyer email content** — so retaining it is defensible
   and necessary to honor/cancel the subscription. State this explicitly so the "we delete
   everything on uninstall" claim is accurate rather than misleading.

### Sub-processors (third parties that receive data)
- **Anthropic (Claude API)** — each email body is sent to Claude `claude-sonnet-4-6` for
  extraction ([claude-extractor.ts](../src/ai/claude-extractor.ts)). This is the most
  material disclosure: buyer email content leaves our infra and goes to Anthropic.
  *Only Claude is implemented today — do not list Gemini/Google AI as an active processor
  until a `GeminiExtractor` actually ships.*
- **Google Cloud Platform** — hosting (Cloud Run), queue (Cloud Tasks), database
  (Firestore), secrets (Secret Manager). Data residency = the configured GCP region.
- **Stripe** — payment processing and metered billing; receives billing email + usage
  counts, **not** buyer content.
- **HubSpot** — the customer's own CRM (the destination), and the source of the email data.
- **Red Anthos** — parent company; owns account identity and the cross-product Stripe
  customer; operates the universal billing portal.

### Security controls actually in place (claim only these)
- HubSpot webhook signature verification (`X-HubSpot-Signature-v3`, 5-min timestamp window)
  on all inbound HubSpot requests ([hubspot-verify.ts](../src/lib/hubspot-verify.ts)).
- Google OIDC verification on internal Cloud Tasks / Cloud Scheduler routes.
- Stripe webhook signature verification on the raw body.
- OAuth tokens stored in Firestore; secrets in GCP Secret Manager; TLS in transit (Cloud
  Run/GCP managed).
- OAuth CSRF protection (signed httpOnly state cookie); single-use, replay-protected,
  short-TTL install handoff tokens.
- Billing gate before any AI/extraction so unpaid portals incur no processing.

> Don't claim certifications (SOC 2, ISO 27001, HIPAA, pen-test cadence, encryption-at-rest
> specifics) unless they're actually true. Default to GCP/Stripe/Anthropic platform-level
> assurances and describe our app-level controls honestly.

---

## Part 1 — Privacy Policy outline

Audience: HubSpot portal admins (our customers) **and** the buyers whose data we process.
Make the controller/processor split explicit: **the dealer/customer is the data
controller; LeadCatch (Red Anthos) is a processor** acting on their instruction.

1. **Who we are & scope.** LeadCatch by Red Anthos; this policy covers the LeadCatch HubSpot
   app only. Contact / legal entity. Effective + last-updated dates.
2. **Our role — processor, not controller.** We process inbound-email personal data on the
   customer's behalf and only to provide the service. The customer controls what flows in
   (which inbox) and out (their HubSpot).
3. **What data we process** — split into:
   - Buyer personal data (from emails): name, email, phone, message, listing interest.
   - Customer/account data: portal id, hub domain, OAuth tokens, owner emails, settings.
   - Billing data: Stripe customer/subscription ids, billing email, usage counts.
   - (No tracking cookies on the service itself beyond the OAuth/install session cookies —
     describe those: signed, httpOnly, short-lived, purpose = CSRF/handoff.)
4. **How and why we use it** (purposes/lawful basis): receive webhook → extract via AI →
   write Contact/Note to the customer's HubSpot → bill per processed lead. Tie each to a
   purpose; no secondary use, no resale, no advertising, **no model training** (state that
   email content is not used to train AI models — confirm Anthropic API terms support this
   claim, which for the API they do).
5. **Sub-processors / who we share with.** The list from Part 0, each with purpose and what
   they receive. Call out Anthropic explicitly (email content for extraction). Note billing
   data goes to Stripe; buyer data does not.
6. **Where data is stored / international transfers.** GCP region; Anthropic/Stripe US
   processing as applicable; SCC/transfer-mechanism language if serving EU/UK.
7. **Retention** — mirror the table in Part 0 precisely:
   - Audit log (incl. buyer PII): **90-day** rolling retention, and deleted on uninstall.
   - Dedupe keys: 24h. Install/handoff state: ≤24h.
   - Billing record: retained beyond uninstall for subscription/legal/tax purposes; contains
     no buyer content.
8. **Deletion on uninstall.** Uninstalling triggers deletion of `portals` + `auditLog` for
   that portal (via the journal sweep → `deletePortalData`). Note the timing: the sweep is
   scheduler-driven (not instantaneous) and billing is retained as above.
9. **Data subject rights** (GDPR/CCPA): how a buyer or customer requests access/deletion.
   Because the dealer is the controller, route buyer requests through the dealer; provide a
   LeadCatch contact for customer-side requests and for deletions we must action.
10. **Security.** Describe the controls in Part 0 honestly. No overclaiming.
11. **Children's data.** Not directed at children; B2B service.
12. **Changes to this policy.** How we notify; effective-date mechanism.
13. **Contact.** Support/privacy contact (the Marketplace "support contact" field must match).

---

## Part 2 — Terms of Service outline

Audience: the customer (dealer/portal admin) who installs and pays.

1. **Acceptance & parties.** Installing = accepting; relationship to Red Anthos master terms
   (incorporate by reference if Red Anthos has umbrella terms; this doc governs LeadCatch
   specifics).
2. **Service description.** What LeadCatch does (AI extraction of inbound emails into HubSpot
   Contacts/Notes), and explicitly what it does **not** do (no outbound replies, no
   guarantee of extraction accuracy, AI may miss or misclassify).
3. **Accounts & eligibility.** Requires a Red Anthos account and a HubSpot portal; the
   **1 Red Anthos account → 1 HubSpot portal** rule ([oauth.ts](../src/routes/oauth.ts) /
   [install.ts](../src/routes/install.ts) `conflictingPortalForAccount`).
4. **Subscription, billing & usage.** Pay-at-install; per-tier flat fee + **metered
   per-lead** charges (one charge per processed lead, idempotent on message id); tiers and
   included allotments reference the pricing page; billing operated via Stripe/Red Anthos.
5. **Cancellation & uninstall.** How to cancel (Stripe/Red Anthos billing portal); uninstall
   behavior: app data deleted, subscription enters a **grace period** then auto-cancels
   (`BILLING_GRACE_DAYS`, default 14) — reinstalling within the window reattaches. No refund
   policy / proration statement as applicable.
6. **Customer responsibilities.** Customer warrants it has the right to process the inbound
   emails and is the data controller; must comply with HubSpot terms and applicable law;
   must not feed prohibited content.
7. **Acceptable use.** No reverse engineering, no abuse of the API, no using the service for
   unlawful data processing.
8. **IP & ownership.** LeadCatch/Red Anthos owns the software; customer owns its HubSpot
   data and the extracted records written into its CRM.
9. **AI / accuracy disclaimer.** Extraction is probabilistic; low-confidence results are
   routed to human review, not auto-written; customer must verify. No warranty that every
   lead is captured or correctly classified.
10. **Warranties & disclaimers.** "As is," to the extent permitted by law.
11. **Limitation of liability.** Cap (typically fees paid in trailing N months); exclude
    consequential damages.
12. **Indemnification.** Mutual or customer-side as appropriate.
13. **Term, suspension & termination.** Non-payment → soft-block (billing gate); breach →
    termination; effect of termination = data deletion per Privacy Policy.
14. **Changes to the service / terms.** Right to modify; notice.
15. **Governing law & disputes.** Red Anthos jurisdiction.
16. **Contact.** Same support contact as the listing.

---

## Part 3 — HubSpot "Shared data" listing table (must match Privacy Policy)

For the Marketplace listing, map each scope to data direction. Draft:

| Scope | Direction | Data |
|---|---|---|
| `conversations.read` | In ← HubSpot | Inbound email message bodies (buyer PII) |
| `conversations.write` | Out → HubSpot | Thread assignment to a review owner |
| `crm.objects.contacts.read` | In ← HubSpot | Existing contact match on upsert |
| `crm.objects.contacts.write` | Out → HubSpot | Contact create/update + `inbox_agent_*` props + Notes |
| `crm.objects.owners.read` | In ← HubSpot | Owner names/emails for the review-owner picker |
| `crm.schemas.contacts.write` | Out → HubSpot | Creates the `inbox_agent_*` property group on install |
| `oauth` | — | Authentication |

(There is no separate Notes scope — Note engagements are covered by `crm.objects.contacts.*`.)

---

## Open items for the author to confirm before publishing
- Legal entity name + address + jurisdiction (Red Anthos).
- GCP region(s) → data-residency statement.
- Anthropic API data-use/no-training confirmation language (cite their commercial terms).
- EU/UK transfer mechanism (SCCs) if serving those markets; whether a DPA is offered to
  customers (likely required given the processor role).
- ~~Final retention stance on the audit log~~ — **decided: 90-day rolling TTL**, implemented
  via `ttl_at` in [firestore.ts](../src/lib/firestore.ts). Remaining action is operational:
  enable the Firestore TTL policy on `auditLog.ttl_at` (see todo.md). If the window changes,
  update the code, this spec, and the policy together.
- Refund/proration policy for the ToS billing section.
