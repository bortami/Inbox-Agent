import 'dotenv/config';
import { getDb } from '../src/lib/firestore.js';
import type { AuditLog } from '../src/types/index.js';
import type { ExtractionResult } from '../src/ai/types.js';

const PORTAL_ID = process.env.PORTAL_ID ?? '51574240';

const db = getDb();
const snap = await db.collection('auditLog')
  .where('portal_id', '==', PORTAL_ID)
  .get();

const entries = snap.docs.map(d => d.data() as AuditLog);

if (entries.length === 0) {
  console.log('No audit log entries found for portal', PORTAL_ID);
  process.exit(0);
}

// ── Summary ──────────────────────────────────────────────────────────────────
const byOutcome = Map.groupBy(entries, e => e.outcome);
const byConfidence = Map.groupBy(
  entries.filter(e => e.confidence),
  e => e.confidence!,
);

console.log('\n═══════════════════════════════════════════════════════');
console.log(` Audit Log Review — Portal ${PORTAL_ID}  (${entries.length} total)`);
console.log('═══════════════════════════════════════════════════════');
console.log('\nOutcomes:');
for (const [outcome, rows] of byOutcome) {
  console.log(`  ${outcome.padEnd(20)} ${rows.length}`);
}
console.log('\nConfidence (leads only):');
for (const [conf, rows] of byConfidence) {
  console.log(`  ${conf.padEnd(20)} ${rows.length}`);
}

// ── Per-entry detail ─────────────────────────────────────────────────────────
console.log('\n───────────────────────────────────────────────────────');
console.log(' Per-message detail');
console.log('───────────────────────────────────────────────────────\n');

for (const entry of entries) {
  const ex = entry.extraction_json as ExtractionResult | null;
  const flags: string[] = [];

  if (ex) {
    if (!ex.email)     flags.push('NO EMAIL');
    if (!ex.firstname) flags.push('NO FIRSTNAME');
    if (!ex.lastname)  flags.push('NO LASTNAME');
    if (!ex.phone)     flags.push('NO PHONE');
    if (!ex.source)    flags.push('NO SOURCE');
    if (!ex.message || ex.message.length < 5) flags.push('EMPTY MESSAGE');
  }

  const flagStr = flags.length > 0 ? `  ⚠ ${flags.join(', ')}` : '';
  const outcomeIcon = entry.outcome === 'created' ? '✓' :
                      entry.outcome === 'skipped' ? '–' :
                      entry.outcome === 'queued_for_review' ? '?' : '✗';

  console.log(`${outcomeIcon} [${(entry.confidence ?? '   ').padEnd(6)}] ${entry.message_id.slice(0, 8)}…`);

  if (ex) {
    console.log(`  source:  ${ex.source ?? '(null)'}`);
    console.log(`  name:    ${ex.firstname ?? '(null)'} ${ex.lastname ?? '(null)'}`);
    console.log(`  email:   ${ex.email ?? '(null)'}`);
    console.log(`  phone:   ${ex.phone ?? '(null)'}`);
    const ref = ex.listing_reference;
    if (ref) {
      const refStr = [ref.vin && `VIN:${ref.vin}`, ref.stock_number && `Stock:${ref.stock_number}`, ref.title].filter(Boolean).join(' | ');
      console.log(`  listing: ${refStr}`);
    }
    console.log(`  message: ${ex.message?.slice(0, 80) ?? '(null)'}${(ex.message?.length ?? 0) > 80 ? '…' : ''}`);
  }

  if (flagStr) console.log(flagStr);
  console.log();
}
