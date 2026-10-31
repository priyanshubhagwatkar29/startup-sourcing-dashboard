# LvlUp Startup Sourcing Dashboard

A private sourcing dashboard (`index.html`) and Founder Relationship Manager (`frm.html`), hosted as static pages on GitHub Pages.

**All research and CRM data lives in a private Supabase database, not in this repository.** The pages show a sign-in screen first and load data only after Supabase confirms the signed-in account is the authorised owner.

## How it fits together

| Piece | Where | Public? |
|---|---|---|
| Page code (`index.html`, `frm.html`, `assets/`) | This repository / GitHub Pages | Yes, contains no data |
| Supabase project URL + publishable key (`assets/config.js`) | This repository | Yes, safe by design (see below) |
| Companies, research runs, exclusions, founders, CRM progress, pipeline notes | Supabase Postgres tables | **No**, Row Level Security, owner only |
| Sign-in and sessions | Supabase Auth (email + password) | n/a |

- `assets/lvlup-cloud.js`: sign-in screen, persistent session, owner check, sign-out, password reset, and the save queue (autosave, retries, conflict handling).
- `supabase/schema.sql`: tables, Row Level Security policies, and the owner allowlist. It is idempotent and contains no data or email address.

## Security model

- Every table has Row Level Security. Signed-out visitors (`anon`) have **no privileges at all**. Signed-in accounts can only read or write rows if their user ID is in `private.allowed_users`.
- The allowlist is filled by `public.claim_owner()`. It records the **first** signed-in user whose confirmed email matches `private.app_owner.owner_email`. After that, no other account can claim access.
- Public sign-ups are disabled in Supabase Auth. Accounts are created only from the Supabase dashboard.
- Research tables are read-only from the browser. CRM and pipeline tables allow insert and update, with no delete policies: records are soft-deleted (`deleted_at`), so they stay recoverable.
- The publishable key in `assets/config.js` only identifies the project; it grants nothing beyond what the policies allow. **Never commit a secret key, `service_role` key, database password or personal access token.**

## Saving and sync

- Edits save automatically. The status pill shows *Saving…*, *All changes saved*, or *Not saved yet · retrying* with a **Retry now** button. Failed saves are kept and retried; nothing is marked saved until Supabase confirms it.
- `crm_records`, `crm_settings` and `company_pipeline` carry a `version` number. A save only applies if the row hasn't changed since the device last saw it. Otherwise the app reloads the latest row and re-applies only the fields you changed, so edits to different fields on two devices both survive.
- Changes from your other devices arrive live (Supabase Realtime), and the app also refreshes when you return to the tab.
- Founder CRM tasks and your edits to research fields are stored in the existing `crm_records.extra` JSON column (no schema change): `extra.tasks` holds each company's to-do list (the earliest open task is mirrored into `next_action` / `next_due`), and `extra.frontend_overrides` holds your edits to research-imported fields, which stay untouched in `founders` and can be restored with *reset*. If the same record's `extra` changes on two devices at once, the app merges them key by key (tasks by task id) before saving.
- On first sign-in in a browser that still holds pre-cloud progress (`lvlup_frm_v1` or `lvlup_scout_pipeline_v1` in local storage), the page offers to upload it. The old GitHub token key (`lvlup_frm_github_token_v1`) is deleted automatically.

## Sessions

You stay signed in on each device until you sign out. Supabase refreshes the session automatically. Private browsing, clearing site data, signing out, or a security event (such as a password change) will require signing in again. Each device signs in separately.

## Updating research data

Research records are no longer edited as JSON in this repository. Add or update rows in the `companies`, `research_runs`, `research_exclusions`, `founder_lists` and `founders` tables (each keeps the full original record in its `data` column), using the Supabase SQL editor or a trusted server-side tool. Keep IDs stable: CRM progress is keyed by founder `id`, and pipeline notes by company `id` (a slug of the company name).

Give every new company a unique `rank`, a `research_batch_id` equal to its run ID, and a `financing_need_status` of Confirmed, Inferred or Unknown. Leave eligibility as Unknown when a published criterion cannot be verified.

## Backups

- **Founder CRM → Export backup** downloads your CRM progress as JSON. **Import backup** merges a backup without overwriting newer cloud edits.
- **Export CSV** on either page exports the current view.
