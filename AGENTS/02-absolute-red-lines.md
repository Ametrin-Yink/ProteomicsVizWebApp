# 02 - Absolute Red Lines (NEVER VIOLATE)

## R Integration

- **NEVER use rpy2** — Always use `subprocess.run(['Rscript', ...])`
- **REQUIRED packages:** msqrob2, QFeatures, limma, MSstats
- **Verify:** `Rscript -e "library(msqrob2); library(QFeatures); library(limma); library(MSstats); cat('OK\n')"`
- **Encoding:** UTF-8 with latin-1 fallback for R subprocess output

## File Patterns (IMMUTABLE)

- **Filename:** `PSM_ExperimentName_Condition_ReplicateNumber.csv` (e.g. `PSM_SampleData_DMSO_1.csv`)
- **Abundance column:** `Abundance F{code} Sample` (dynamic F-code per TMT channel)
- **Minimum replicates:** 3 per condition

## TypeScript

- **strict: true** required in tsconfig.json
- **NEVER use `as any` or `@ts-ignore`**

## Zustand State Management

- **NEVER mutate state directly** — Always use store actions
- **Use Immer middleware** for immutable updates
- **Use selectors:** `useStore((state) => state.sessions)` — never get entire store

## Python Async

- **NEVER blocking I/O in async functions** — Use `asyncio.to_thread()`
- **File upload max:** 500MB

## Data Format

- **Internal:** TSV (handles special characters better than CSV)
- **API response:** R outputs column-based → Frontend transforms to row-based for Plotly

## Biomart Fallback

- Always implement fallback when Biomart is offline — return UniProt IDs as-is
