#!/usr/bin/env npx tsx
/**
 * Dev convenience script — registers inbox_agent_* contact properties on a
 * specific portal. Production installs are handled automatically by the OAuth
 * callback. Safe to re-run; existing resources are skipped (409 = already exists).
 *
 * Required env vars:
 *   HUBSPOT_ACCESS_TOKEN — OAuth access token from the installed test portal
 *
 * Usage:
 *   HUBSPOT_ACCESS_TOKEN=xxx npx tsx scripts/setup-hubspot.ts
 *   # or add to .env and run: npx tsx scripts/setup-hubspot.ts
 */

import 'dotenv/config';
import { ensureInboxAgentProperties } from '../src/lib/hubspot-properties.js';

const ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('Error: HUBSPOT_ACCESS_TOKEN is required.');
  process.exit(1);
}

console.log('Registering inbox_agent_* contact properties...');
await ensureInboxAgentProperties(ACCESS_TOKEN);
console.log('Done.');
