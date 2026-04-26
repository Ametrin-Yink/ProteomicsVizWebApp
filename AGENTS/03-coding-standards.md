# 03 - Coding Standards

## Naming

| Type | Convention | Example |
|------|------------|---------|
| React components | PascalCase | `VolcanoPlot.tsx` |
| Custom hooks | camelCase with `use` prefix | `useSession.ts` |
| TypeScript types/interfaces | PascalCase | `DiffExpressionResult` |
| Python classes | PascalCase | `SessionManager` |
| Python functions/variables | snake_case | `process_file` |
| Constants (both) | UPPER_SNAKE_CASE | `MAX_UPLOAD_SIZE` |
| Non-component TS files | kebab-case | `api-client.ts` |
| Python files | snake_case | `session_manager.py` |

## Import Order (TypeScript)

1. React / external libraries
2. Internal absolute (`@/`)
3. Relative (`./`)
4. Types (`import type`)

## Code Style

- **TypeScript:** strict mode, no `as any`, no `@ts-ignore`
- **Python:** type hints on all functions, Google-style docstrings
- **React:** select from Zustand stores with selectors (never get entire store)
- **Python async:** wrap blocking I/O in `asyncio.to_thread()`

## File Organization

### Frontend
```
frontend/src/
├── app/              # Next.js App Router pages
├── components/
│   ├── ui/           # shadcn/ui primitives
│   ├── plots/        # Plotly wrappers
│   ├── forms/        # Upload, config forms
│   └── analysis/     # Analysis-specific
├── hooks/            # Custom hooks
├── lib/              # API client, utils, constants
├── stores/           # Zustand stores
└── types/            # TypeScript definitions
```

### Backend
```
backend/app/
├── api/routes/       # Endpoint handlers
├── core/             # Config, exceptions
├── db/               # Session persistence
├── models/           # Domain models
├── schemas/          # Pydantic request/response
├── services/         # Business logic
└── utils/            # Validators, parsers
```
