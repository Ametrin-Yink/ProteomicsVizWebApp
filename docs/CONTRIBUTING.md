# Contributing

## Principles

- State assumptions when behavior or scientific intent is ambiguous.
- Make the minimum change that satisfies an observable requirement.
- Add a regression test before fixing a bug whenever practical.
- Preserve unrelated user changes and avoid adjacent refactoring.
- Treat generated outputs, runtime sessions, reports, uploaded data, virtual environments, `node_modules`, and `.next` as non-source artifacts.

## Branch and review workflow

1. Update local `main` and create a focused feature or fix branch.
2. Implement and verify the change using [DEVELOPMENT.md](DEVELOPMENT.md).
3. Update the nearest current document if behavior, configuration, dependencies, APIs, or operations changed.
4. Open a pull request or perform the project’s equivalent review.
5. Merge only verified work to `main`; `main` is the production release branch.

Use a concise commit message that says what changed. The repository does not require a particular commit-message convention.

## Architecture constraints

- Invoke R through `Rscript`; do not add `rpy2`.
- Keep TypeScript strict and do not suppress errors with `as any` or `@ts-ignore`.
- Do not perform blocking filesystem or subprocess work directly on the async event loop.
- Keep session/report paths within configured roots and use atomic writes/publication where data safety matters.
- Preserve the public shared-report boundary in [REPORT_SHARING.md](REPORT_SHARING.md).
- Put backend tests under `Tests/`; colocate frontend unit/component tests under `frontend/src/`; keep browser tests in `frontend/e2e/`.

See [AGENTS.md](../AGENTS.md) for repository rules and
[docs/engineering/](engineering/ARCHITECTURE.md) for detailed engineering
guidance.
