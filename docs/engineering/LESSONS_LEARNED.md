# Engineering lessons

These are current lessons, not an implementation diary.

## Contracts fail at boundaries

- Frontend routes, FastAPI, generated OpenAPI, and Caddy allowlists must change together.
- Every configuration field must exist in both backend models, orchestration forwarding, frontend persistence/restoration, and a non-default test.
- R/Python/frontend artifact formats require stable filenames, columns, identifiers, numeric types, and missing-value conventions.
- `/qc/plots` is the canonical endpoint; old `/qc/data` assumptions caused empty visualizations.

## Real vendor data defeats convenient assumptions

- DuckDB and pandas inference differ; read conservatively and cast numeric values explicitly.
- Vendor headers and TMT keys contain spaces, punctuation, and prefixes. Quote identifiers through shared helpers.
- Normalize reporter channel keys at the UI/API boundary.
- Do not leak mapping/helper columns into session state or scientific conversion.
- Validate Parquet codecs in the actual Python-to-R production environment.

## Filtering uses the design

- Missingness uses expected replicates from metadata, not only surviving rows.
- Minimum PSM support means distinct surviving `Unique_PSM` values for the authoritative protein/group ID.
- Zero survivors under plausible thresholds are a diagnostic signal: inspect mappings, identifiers, intermediate counts, and SQL.
- Shared handlers are safe only when their contracts are identical. Test complete registered pipelines through one continuous context.

## State and recovery need ownership

- Effects and async requests must not create duplicate sessions or apply old responses after switching.
- Error and cancel states need a clear exit path.
- Retry is a clean stage-1 replay, not partial resume.
- Tests never attach to real runtime data.

## Reports are bearer capabilities

- Hidden controls and predictable IDs are not security. The token, backend router, frontend shell, and gateway all express the same boundary.
- Keep management IDs private and bearer URLs out of logs/referrers/caches.
- Protein computations are report-scoped and bounded; PTM shared reports are read-only.
- `Download Results` downloads an artifact. `Export` publishes the complete session report.

## Deployment is product behavior

- Develop on Windows and build Linux dependencies/output on AlmaLinux from an exact revision.
- Use immutable releases and persistent data outside them.
- Deploy the full 40-character SHA actually present on the remote.
- Startup may produce brief failed probes, but success requires final health/route checks and the deployment script’s explicit success message.
- Preserve the previous release and all result sessions during validation.
