# Proteomics Visualization Web App — Frontend

Next.js 16 frontend for the Proteomics Visualization platform. See the [root README](../README.md) for full project overview.

## Tech Stack

Next.js 16, React 19, TypeScript, Tailwind CSS v4, Zustand (state management), Plotly.js (visualizations)

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The backend API must be running on port 8000 (proxied via `next.config.ts`).

## Code Quality

```bash
npm run lint        # ESLint
npm run lint:fix    # ESLint with auto-fix
npx tsc --noEmit    # Type check
```

## Key Directories

| Path | Purpose |
|------|---------|
| `src/app/` | Next.js App Router pages |
| `src/components/` | React components (plots, UI, session, visualization, analysis, processing) |
| `src/stores/` | Zustand stores (session, UI, analysis, processing) |
| `src/lib/` | API client, utilities, constants |
| `src/hooks/` | Custom hooks (WebSocket) |
| `src/types/` | TypeScript type definitions |

## Design System

Colors defined in `globals.css` as CSS customizations on Tailwind theme:
- `primary` / `#E73564` — upregulated, primary actions
- `secondary` / `#00ADEF` — downregulated, links
- Semantic: `success`, `warning`, `error`, `info`
- Use design system tokens, never hardcoded Tailwind colors
