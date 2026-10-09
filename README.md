# LvlUp Startup Sourcing Dashboard

The dashboard interface and research data are maintained separately. Add or update startup records in JSON without rewriting the UI.

## Files

- `index.html`: dashboard interface and rendering logic.
- `data/companies.json`: active startup records, scores, eligibility checks, sources, and diligence gaps.
- `data/research-runs.json`: research metadata, exclusions, and run history.
  
## Updating a sourcing batch

1. Add or revise candidate records in the `companies` array in `data/companies.json`.
2. Add a new record to the `runs` array in `data/research-runs.json`, update `current_run_id`, and retain older run entries.
3. Move unsuitable companies to `considered_and_excluded` with a reason instead of silently deleting the trail.
4. Commit the JSON changes. The deployed dashboard reads these files when it loads.

Keep inferred financing needs clearly labelled as inference, and leave eligibility as Unknown when a published criterion cannot be verified.

## Baseline

The existing India/UAE baseline is retained from the supplied research snapshot dated 9 October 2026: 8 active candidate records and 5 exclusion entries.
