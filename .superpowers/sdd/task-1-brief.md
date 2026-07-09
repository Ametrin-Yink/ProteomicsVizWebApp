# Task 1: Backend Foundation — File Parser, Data Models, Config

## Context

Pipeline reform branch `pipeline-reform-tmt-dia`. Full spec at `docs/specs/pipeline-reform-tmt-dia.md`. This task implements the backend foundation: file format detection, data model updates, and config changes.

## Requirements

### 1. File Parser Rewrite (`backend/app/utils/file_parser.py`)

**Remove:**
- `PSM_FILENAME_PATTERN` regex
- `parse_psm_filename()` function
- `find_abundance_column()` function (old pattern `Abundance F{code} Sample`)
- Old `REQUIRED_COLUMNS` list
- Old `validate_psm_columns()` function

**Add these new functions:**

```python
TMT_ABUNDANCE_PATTERN = re.compile(r'^"?Abundance\s+(\d+)([NC])?"?$')

TMT_REQUIRED_COLUMNS = [
    "Sequence", "Modifications", "Charge", "Contaminant",
    "Master Protein Accessions", "Quan Info",
]

DIA_REQUIRED_COLUMNS = [
    "Sequence", "Modifications", "Charge", "Contaminant",
    "Master Protein Accessions", "Quan Info",
]

def detect_delimiter(file_path: Path) -> str:
    """Read first line, detect tab vs comma. Returns '\t' or ','."""

def detect_tmt_channels(columns: list[str]) -> list[str]:
    """Extract sorted TMT channel labels from abundance columns.
    Returns list like ['126', '127N', '127C', ..., '134N'].
    Pattern: ^"?Abundance\s+(\d+)([NC])?"?$"""

def read_file_columns(file_path: Path) -> list[str]:
    """Read column headers only (nrows=0) with auto-detected delimiter."""

def validate_tmt_columns(df: pd.DataFrame, filename: str) -> None:
    """Validate TMT file: required columns present + >=2 abundance columns matching TMT pattern.
    Abundance columns must be numeric or empty. Raise InvalidFileFormatError on failure."""

def validate_dia_columns(df: pd.DataFrame, filename: str) -> None:
    """Validate DIA file: required columns present + 'Quan Value' column present.
    'Quan Value' column must be numeric. Raise InvalidFileFormatError on failure."""

def parse_proteomics_file(file_path: Path, file_type: str) -> dict:
    """Parse a PD export file. Auto-detect delimiter. Validate columns per file_type.
    Returns dict with: columns (list), tmt_channels (list|None), has_quan_value (bool|None).
    Accepts .txt AND .csv files. Does NOT validate filename pattern.
    Does NOT extract metadata from filename."""
```

### 2. Data Model Changes (`backend/app/models/session.py`)

**ProteomicsFileInfo** — already partially done:
- `conditions: list[str]` REMOVED ✓
- `batch: str | None` added ✓
- `file_type: str | None` added ✓
- `experiment` default changed to `""` ✓
- `replicate` default changed to `0` ✓
- `migrate_condition_field` model_validator REMOVED ✓

**SessionConfig** — already partially done:
- `file_type: str | None` added ✓
- `tmt_channel_mapping: dict[str, dict[str, str | int]] | None` added ✓

**NEW — also add to `backend/app/models/analysis.py`:**
```python
# Add to AnalysisConfig class:
file_type: str | None = None
tmt_channel_mapping: dict[str, dict[str, str | int]] | None = None
```

**Update `Session` model:**
```python
pipeline: str = ""  # was "msqrob2"
```

### 3. Config Changes (`backend/app/core/config.py`)

```python
MIN_PROTEOMICS_FILES: int = 1   # was 6 — TMT needs only 1 file
MIN_DIA_FILES: int = 2          # NEW — DIA needs at least 2 files
```

### 4. Processing Route (`backend/app/api/routes/processing.py`)

**Rewrite `_derive_pipeline()`:**
```python
def _derive_pipeline(session: Session) -> PipelineTool:
    ft = getattr(session.config, "file_type", None) if session.config else None
    if ft == "tmt":
        return PipelineTool.MSSTATS
    if ft == "dia":
        return PipelineTool.MSQROB2
    # Legacy fallback for old sessions without file_type
    raw = getattr(session, "pipeline", None)
    if raw in ("msqrob2", "msstats"):
        return PipelineTool(raw)
    return PipelineTool.MSQROB2
```

**Add to `config_forward_fields` list:**
- `"file_type"`
- `"tmt_channel_mapping"`

**Update file-count validation** to check context-dependent minimums using `session.config.file_type`.

### 5. Session Manager (`backend/app/services/session_manager.py`)

```python
pipeline: str = ""  # default, was "msqrob2"
```

### 6. Upload Route (`backend/app/api/routes/upload.py`)

- Accept `.txt` files alongside `.csv`
- Remove `parse_psm_filename()` calls
- Remove old column validation; route to `validate_tmt_columns()` or `validate_dia_columns()` based on `session.config.file_type`
- Return detection results in response: `{filename, size, columns, file_type, tmt_channels?, has_quan_value?}`
- No filename pattern enforcement

## Tests (write FIRST — TDD)

### `Tests/backend/unit/test_file_parser.py` — rewrite:
1. `test_detect_delimiter_tab` — tab-delimited file
2. `test_detect_delimiter_comma` — comma-delimited file
3. `test_detect_tmt_channels_16plex` — 16 channels from TMT fixture
4. `test_detect_tmt_channels_no_channels` — file with no abundance columns
5. `test_validate_tmt_columns_valid` — valid TMT fixture passes
6. `test_validate_tmt_columns_missing_required` — missing Sequence column
7. `test_validate_tmt_columns_no_abundance` — no abundance columns
8. `test_validate_dia_columns_valid` — valid DIA fixture passes
9. `test_validate_dia_columns_missing_quan_value` — no Quan Value column
10. `test_read_file_columns` — returns column list from fixture

### `Tests/backend/unit/test_processing_routes.py` — add:
11. `test_derive_pipeline_tmt` — returns MSSTATS for file_type="tmt"
12. `test_derive_pipeline_dia` — returns MSQROB2 for file_type="dia"
13. `test_derive_pipeline_legacy` — falls back to session.pipeline

### `Tests/backend/unit/test_session_model.py` — update/add:
14. `test_proteomics_file_info_no_conditions_field` — ProteomicsFileInfo created without conditions
15. `test_proteomics_file_info_with_batch` — accepts batch field
16. `test_session_config_with_file_type` — accepts file_type="tmt"
17. `test_session_config_with_tmt_channel_mapping` — accepts channel mapping

## Test Fixtures

Already created at:
- `Tests/fixtures/tmt_sample_1000rows.txt` — 1000 rows from real TMT PD file (78 cols)
- `Tests/fixtures/dia_sample_1000rows.txt` — 1000 rows from real DIA PD file (61 cols)

## Constraints

- Write tests FIRST, make them fail, then implement
- Use backend venv Python: `backend/.venv/Scripts/python.exe`
- Run tests from project root: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_file_parser.py -v`
- Match existing code style (Pydantic v2, type annotations)
- No new dependencies
- The `InvalidFileFormatError` exception class exists at `backend/app/core/exceptions.py`
- The `SessionStore` is at `backend/app/db/session_store.py`
- Session model import path: `from app.models.session import Session, SessionConfig, ProteomicsFileInfo, SessionState`
