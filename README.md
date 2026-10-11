# LvlUp Startup Sourcing Dashboard

The dashboard interface and research data are maintained separately. Add or update startup records in JSON without rewriting the UI.

## Files

- `index.html`: dashboard interface and rendering logic.
- `data/companies.json`: active startup records, scores, eligibility checks, sources, and diligence gaps. Each record carries `country`, `region` and `research_batch_id` so the dashboard can filter by geography and batch.
- `data/research-runs.json`: research metadata (including the program-criteria audit), exclusions (optionally with `run_id`, `country`, `source_urls`), and run history.
  
## Updating a sourcing batch

1. Add or revise candidate records in the `companies` array in `data/companies.json`.
2. Add a new record to the `runs` array in `data/research-runs.json`, update `current_run_id`, and retain older run entries.
3. Move unsuitable companies to `considered_and_excluded` with a reason instead of silently deleting the trail.
4. Commit the JSON changes. The deployed dashboard reads these files when it loads.

Give every new record a unique `rank`, a `research_batch_id` equal to its run ID, and a `financing_need_status` of Confirmed, Inferred or Unknown. Keep inferred financing needs clearly labelled as inference, and leave eligibility as Unknown when a published criterion cannot be verified.

## Research batches

- `baseline-india-uae-2026-10-09`: India and UAE baseline from the supplied research snapshot. 8 active records and 5 exclusion entries, preserved unchanged apart from additive `country`, `region` and `research_batch_id` fields.
- `SEA-01-2026-10-09`: Singapore, Indonesia and Malaysia. 14 new records (ranks 9 to 22) and 11 new exclusion entries. Eligibility for the non-dilutive programs is kept at Unknown for non-US companies because LvlUp's pages conflict on geography; see `meta.program_criteria_audit` in `data/research-runs.json`.

Notes on the dashboard: pipeline status and notes are stored in the browser's localStorage and do not sync between devices or users. Export CSV to keep them. No API keys or secrets belong in this repository.

## Founder CRM (FRM)

`frm.html` is a separate founder-relationship manager for early-stage founder lists, kept apart from the program-fit pipeline.

- Data: `data/founders.json`, with one entry per founder and a `list_id` for each sourcing list (currently the global early-stage list and the India & UAE early-stage list, both from 11 October 2026).
- Features: a pipeline board with drag-and-drop stages, a table view, scheduled follow-ups, a per-founder activity timeline, tags, warmth, a monthly LvlUp application goal, manually added founders, CSV export, and JSON backup and restore.
- Storage: progress is saved in the browser's localStorage under `lvlup_frm_v1` and does not sync between devices. Use Export backup and Import backup to move it.
- To add a new list, append founders to `data/founders.json` with a new `list_id`. Existing browser progress is keyed by `id`, so keep IDs stable.
