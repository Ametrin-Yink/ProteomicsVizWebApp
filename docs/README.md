# Documentation

These documents describe the current application. Completed design plans and implementation checklists were removed because they duplicated or contradicted the running system; Git history remains the archive.

| Audience | Document | Purpose |
|---|---|---|
| Users and developers | [Project README](../README.md) | Product scope, setup, and entry points |
| Analysts | [Pipeline workflows](PIPELINES.md) | Inputs, stages, filters, outputs, and export behavior |
| Developers | [Development and verification](DEVELOPMENT.md) | Environment and required checks |
| Developers and operators | [Server access and development cycle](SERVER_ACCESS_AND_DEV_CYCLE.md) | SSH tunnel, Git workflow, server pull, and deployment boundary |
| Contributors | [Contributing](CONTRIBUTING.md) | Change workflow and coding rules |
| Operators and security reviewers | [Shared reports](REPORT_SHARING.md) | Capability model, ports, limitations, and verification |
| Operators | [Deployment runbook](../deploy/README.md) | AlmaLinux setup, releases, rollback, and diagnostics |
| API consumers | [OpenAPI contract](api/openapi.yaml) | Generated route-level API schema |
| Coding agents | [Repository instructions](../AGENTS.md) | Concise working rules and non-negotiable boundaries |
| Maintainers | [Engineering architecture](engineering/ARCHITECTURE.md) | Architecture and links to detailed engineering contracts |

## Engineering references

- [Architecture](engineering/ARCHITECTURE.md)
- [API and frontend state](engineering/API_AND_STATE.md)
- [Error handling and recovery](engineering/ERROR_HANDLING.md)
- [Testing standard](engineering/TESTING.md)
- [Engineering lessons](engineering/LESSONS_LEARNED.md)

Update the nearest current document with every behavior, API, operational, or dependency change. Regenerate `api/openapi.yaml` after route or schema changes. Do not add a dated plan to this directory after the work is complete.
