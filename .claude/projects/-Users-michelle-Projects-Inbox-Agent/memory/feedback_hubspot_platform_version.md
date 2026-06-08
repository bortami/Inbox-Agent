---
name: feedback-hubspot-platform-version
description: Always use the latest HubSpot platform version (currently 2026.03) in hsproject.json
metadata:
  type: feedback
---

Always use `2026.03` as the `platformVersion` in `hsproject.json` for HubSpot projects.

**Why:** User corrected a `2025.2` usage — 2026.03 is the current latest and should be the default.

**How to apply:** Any time an `hsproject.json` is created or edited, use `"platformVersion": "2026.03"` unless there's a specific reason to pin an older version.
