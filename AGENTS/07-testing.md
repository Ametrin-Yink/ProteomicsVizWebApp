# 07 — Testing

## Test Organization

ALL tests go in `Tests/`. Never create `backend/tests/` or `frontend/tests/`.

```
Tests/
├── conftest.py                         # Shared pytest fixtures (client, sample_psm_data, test_data_dir, etc.)
├── backend/
│   ├── unit/
│   │   ├── pipeline/                   # Pipeline engine, registry, chains, orchestrator, structure
│   │   │   ├── test_pipeline_engine.py
│   │   │   ├── test_pipeline_registry.py
│   │   │   ├── test_pipeline_chains.py
│   │   │   ├── test_processing_orchestrator.py
│   │   │   ├── test_msqrob2_pipeline_structure.py
│   │   │   └── test_msstats_pipeline_structure.py
│   │   ├── processing/                 # Data processing, file parsing, QC, R wrappers, batch
│   │   │   ├── test_data_processor.py
│   │   │   ├── test_data_processor_steps.py
│   │   │   ├── test_file_parser.py
│   │   │   ├── test_qc_calculator.py
│   │   │   ├── test_base_r_wrapper.py
│   │   │   ├── test_msqrob2_wrapper.py
│   │   │   ├── test_msstats_wrapper.py
│   │   │   ├── test_msstats_batched.py
│   │   │   ├── test_step_msstats_batched.py
│   │   │   ├── test_run_batched.py
│   │   │   └── test_msstats_batch_settings.py
│   │   ├── services/                   # GSEA, compare, BioNet, reports
│   │   │   ├── test_gsea_service.py
│   │   │   ├── test_gsea_cache.py
│   │   │   ├── test_compare_service.py
│   │   │   ├── test_bionet_service.py
│   │   │   ├── test_report_generator.py
│   │   │   └── test_report_store.py
│   │   ├── routes/                     # API route handlers
│   │   │   ├── test_sessions_api.py
│   │   │   ├── test_processing_routes.py
│   │   │   ├── test_visualization_routes.py
│   │   │   └── test_gsea_routes.py
│   │   └── infrastructure/             # Sessions, tasks, validation, organisms, WebSocket
│   │       ├── test_session_manager.py
│   │       ├── test_session_model.py
│   │       ├── test_task_manager.py
│   │       ├── test_validators.py
│   │       ├── test_organism_scanner.py
│   │       └── test_websocket.py
│   └── integration/
│       ├── pipeline/                    # E2E pipeline + R integration
│       │   ├── test_tmt_pipeline_e2e.py
│       │   └── test_r_integration.py
│       └── routes/                      # API integration tests
│           ├── test_api.py
│           ├── test_bionet_routes.py
│           ├── test_compare_api.py
│           ├── test_report_routes.py
│           └── test_visualization_state.py
└── fixtures/                            # Committed test data
    ├── tmt_sample_1000rows.txt
    ├── tmt_sample_10000rows.txt
    └── dia_sample_1000rows.txt
```

## Running Tests

```bash
# Backend unit tests (run from project root)
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v

# Specific test group
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/pipeline -v

# Backend integration tests
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v

# Run everything
backend/.venv/Scripts/python.exe -m pytest Tests/backend/ -v --tb=short
```

## Fixtures

Shared fixtures are in `Tests/conftest.py`:

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `client` | function | FastAPI `TestClient` instance |
| `sample_psm_data` | function | 3-row PSM DataFrame |
| `test_data_dir` | session | Path to `Tests/fixtures/` |
| `tmt_fixture_path` | function | Path to `tmt_sample_1000rows.txt` |
| `dia_fixture_path` | function | Path to `dia_sample_1000rows.txt` |

Custom markers: `slow`, `integration`, `unit` — auto-assigned by `pytest_collection_modifyitems`.

## Conventions

- **HTTP client:** Use `TestClient` (shared `client` fixture), never `httpx.AsyncClient`
- **Test data:** Use committed `Tests/fixtures/` files. Never depend on external `SampleData/`
- **File formats:** `.txt` and `.csv` both accepted for TMT/DIA uploads
- **Fixtures are audited periodically** — remove unused ones from `conftest.py`
