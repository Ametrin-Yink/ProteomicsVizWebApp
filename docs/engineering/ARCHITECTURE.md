# Architecture

ProteomicsViz is a full-stack scientific application for TMT protein, DIA protein, and PTM TMT analysis. Users configure comparisons, run persistent six-stage pipelines, inspect interactive results, and publish completed sessions as report snapshots.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, Zustand, Plotly, Cytoscape, Radix UI |
| Backend | FastAPI, Python 3.12, Pydantic v2, asyncio, DuckDB, Parquet |
| Scientific | R 4.5+, MSstats, msqrob2/QFeatures, MSstatsPTM, limma |
| On-demand analysis | gseapy GSEA, MSstatsBioNet, comparison services |
| Testing | pytest, Vitest, Playwright |
| Production | AlmaLinux systemd services behind Caddy |

## Repository layout

```text
ProteomicsViz/
|-- AGENTS.md                    # concise repository instructions for coding agents
|-- backend/
|   |-- app/api/routes/          # private, management, and shared capability APIs
|   |-- app/models/              # Pydantic session and analysis contracts
|   |-- app/services/            # pipelines, tasks, reports, analyses, persistence
|   |-- scripts/                 # R programs and dependency/OpenAPI helpers
|   `-- requirements.txt
|-- frontend/
|   |-- src/app/                 # private application and public report routes
|   |-- src/components/          # workflow and visualization UI
|   |-- src/lib/                 # API clients, figure builders, utilities
|   |-- src/stores/              # Zustand domain stores
|   `-- e2e/                     # Playwright journeys
|-- Tests/                       # backend tests and committed fixtures
|-- deploy/                      # Caddy, systemd, bootstrap, release script
`-- docs/                        # current product, engineering, API, and operations docs
```

Runtime sessions, reports, uploads, reference databases, caches, virtual environments, R libraries, Node dependencies, and build output are artifacts rather than source.

## Runtime boundaries

The backend owns validation, persistence, task scheduling, scientific orchestration, report snapshots, and capability enforcement. R is always invoked as a subprocess through repository wrappers. The frontend owns workflow state and interactive presentation but is not a security boundary.

The registered pipelines are `msstats`, `msqrob2`, and `ptm`. GSEA, BioNet, and Compare are on-demand analyses, not pipeline stages. Detailed data ownership and stage contracts are in [Pipeline workflows](../PIPELINES.md).

The processed-abundance, QC, GSEA heatmap, scalable comparison-correlation, and transactional reprocessing design is documented in [Visualization data and reprocessing plan](VISUALIZATION_DATA_REWORK_PLAN.md). Immutable Parquet is the runtime visualization boundary for DIA/TMT protein visualization. Its TSV files may exist only as transient Python/R materializations or subprocess inputs and are not compatibility read paths for unsupported sessions. PTM result/detail TSV artifacts remain part of the current PTM contract until that separately scoped redesign.

Reports separate internal management IDs from random bearer tokens. Protein reports can run bounded snapshot-scoped analyses; PTM shared reports are read-only. Caddy enforces the same boundary at the network edge. See [Shared report security](../REPORT_SHARING.md).

## Production topology

```text
Internal users
    |
    | :8000 shared-report allowlist
    v
  Caddy ----------------------> Next.js 127.0.0.1:3000
    |                                  |
    | private :8001 via SSH            | server-side API proxy
    v                                  v
Full application                 FastAPI 127.0.0.1:8100
                                         |
                                         +--> DuckDB/Parquet
                                         +--> Rscript children
                                         `--> persistent /home/proteomicsviz/data
```

FastAPI and Next.js run as separate systemd services. Releases are immutable directories selected by `/home/proteomicsviz/current`; persistent data is outside releases. Operational details are in [deploy/README.md](../../deploy/README.md).
