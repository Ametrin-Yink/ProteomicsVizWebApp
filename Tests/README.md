# Test suite

The authoritative testing standard is
[docs/engineering/TESTING.md](../docs/engineering/TESTING.md), and runnable
commands are summarized in [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md).

- `Tests/backend/unit/`: hermetic backend behavior and regression tests.
- `Tests/backend/integration/routes/`: API/store/filesystem contracts.
- `Tests/backend/integration/pipeline/`: R smoke and live scientific workflows.
- `Tests/fixtures/`: committed isolated fixtures.
- `frontend/src/**/*.test.ts(x)`: frontend unit/component tests.
- `frontend/e2e/`: Playwright critical journeys.

Tests must use isolated runtime roots and must not read real user samples or mutate normal sessions, reports, or file-library data. TMT and DIA have committed representative known-answer integration lanes. PTM is supported and has backend/frontend regression coverage plus real-data end-to-end verification; a comparable committed PTM known-answer lane remains a testing gap.
