# ProteomicsViz frontend

Next.js 16, React 19, TypeScript, Tailwind CSS v4, Zustand, Plotly, Cytoscape, and Radix UI.

## Development

From the repository root:

```powershell
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open `http://localhost:3000`. The development proxy expects FastAPI on `http://127.0.0.1:8000`.

## Checks

```powershell
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:e2e
```

## Structure

| Path | Purpose |
|---|---|
| `src/app/` | Next.js routes for private sessions and public reports |
| `src/components/` | Analysis, visualization, report, file, session, and UI components |
| `src/lib/` | API clients, figure builders, constants, and utilities |
| `src/stores/` | Zustand domain stores |
| `src/types/` | Shared frontend types |
| `e2e/` | Playwright critical journeys |

Visualization components receive their API scope through `ApiProvider`. Shared-report pages must use the capability API prefix and must not infer permissions by parsing the URL. PTM shared reports intentionally expose only Volcano and QC navigation.

`NEXT_PUBLIC_REPORT_BASE_URL` is a build-time production value. Leave `NEXT_PUBLIC_API_URL` unset in production so shared pages use same-origin Caddy routing.

Use design tokens from `globals.css`; do not introduce hardcoded near-equivalent colors. The primary/upregulated color is `#E73564`, and the secondary/downregulated color is `#00ADEF`.
