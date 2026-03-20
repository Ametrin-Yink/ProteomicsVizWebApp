# 09 - Testing Requirements

**Purpose:** Define comprehensive testing strategy and requirements

---

## Test Organization

```
tests/
├── e2e/                          # Playwright E2E tests
│   ├── 01-welcome.spec.ts
│   ├── 02-data-input.spec.ts
│   ├── 03-processing.spec.ts
│   ├── 04-results.spec.ts
│   ├── 05-qc-plots.spec.ts
│   ├── 06-bioinformatics.spec.ts
│   ├── 07-pdf-export.spec.ts
│   └── 08-session-manager.spec.ts
├── integration/                  # Integration tests
│   ├── test_api.py
│   ├── test_processing.py
│   └── test_r_integration.py
└── unit/                         # Unit tests
    ├── test_file_parser.py
    ├── test_validators.py
    └── test_data_processor.py
```

---

## E2E Tests (Playwright)

### Test Suite 1: Welcome Page
```typescript
// e2e/01-welcome.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Welcome Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads without errors', async ({ page }) => {
    await expect(page).toHaveTitle(/Proteomics/);
    await expect(page.locator('[data-testid="welcome-title"]')).toBeVisible();
  });

  test('creates new session', async ({ page }) => {
    await page.click('[data-testid="new-analysis-btn"]');
    await expect(page).toHaveURL(/\/analysis/);
    await expect(page.locator('[data-testid="session-panel"]')).toBeVisible();
  });

  test('shows TBD for unimplemented templates', async ({ page }) => {
    await page.hover('[data-testid="template-other"]');
    await expect(page.locator('[data-testid="tbd-tooltip"]')).toBeVisible();
  });
});
```

### Test Suite 2: Data Input
```typescript
// e2e/02-data-input.spec.ts

test.describe('Data Input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analysis');
  });

  test('uploads proteomics files', async ({ page }) => {
    const fileInput = page.locator('[data-testid="proteomics-upload"]');
    await fileInput.setInputFiles('SampleData/PSM_SampleData_DMSO_1.csv');
    
    await expect(page.locator('[data-testid="upload-success"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-table"]')).toContainText('PSM_SampleData_DMSO_1.csv');
  });

  test('validates minimum replicates', async ({ page }) => {
    // Upload only 2 replicates per condition
    await uploadFiles(page, [
      'PSM_SampleData_DMSO_1.csv',
      'PSM_SampleData_DMSO_2.csv',
      'PSM_SampleData_INCZ123456_1.csv',
      'PSM_SampleData_INCZ123456_2.csv',
    ]);
    
    await expect(page.locator('[data-testid="validation-error"]')).toContainText('at least 3 replicates');
    await expect(page.locator('[data-testid="start-analysis-btn"]')).toBeDisabled();
  });

  test('validates same experiment', async ({ page }) => {
    // Upload files from different experiments
    await uploadFiles(page, [
      'PSM_SampleData_DMSO_1.csv',
      'PSM_OtherExperiment_DMSO_1.csv',
    ]);
    
    await expect(page.locator('[data-testid="validation-error"]')).toContainText('same experiment');
  });
});
```

### Test Suite 3: Processing
```typescript
// e2e/03-processing.spec.ts

test.describe('Processing Pipeline', () => {
  test('completes all 9 steps', async ({ page }) => {
    // Setup session with valid data
    await setupTestSession(page);
    
    // Start processing
    await page.click('[data-testid="start-analysis-btn"]');
    
    // Verify all steps complete
    for (let step = 1; step <= 9; step++) {
      await expect(page.locator(`[data-testid="step-${step}"]`)).toHaveClass(/completed/);
    }
    
    // Verify auto-redirect
    await expect(page).toHaveURL(/\/analysis\/visualization/);
  });

  test('shows real-time progress', async ({ page }) => {
    await setupTestSession(page);
    await page.click('[data-testid="start-analysis-btn"]');
    
    // Verify progress updates
    await expect(page.locator('[data-testid="progress-bar"]')).toHaveAttribute('value', /[0-9]+/);
    
    // Verify step status changes
    await expect(page.locator('[data-testid="step-1"]')).toHaveClass(/completed/, { timeout: 30000 });
  });
});
```

### Test Suite 4: Results
```typescript
// e2e/04-results.spec.ts

test.describe('Results Visualization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analysis/visualization');
    await loadTestSession(page);
  });

  test('volcano plot displays', async ({ page }) => {
    await expect(page.locator('[data-testid="volcano-plot"]')).toBeVisible();
    
    // Verify plot has data points
    const points = await page.locator('.scatterlayer .trace').count();
    expect(points).toBeGreaterThan(0);
  });

  test('volcano plot interactions', async ({ page }) => {
    // Click selection mode
    await page.click('[data-testid="mode-click"]');
    
    // Click on a point
    await page.click('.scatterlayer .trace .point:first-child');
    
    // Verify selection
    await expect(page.locator('[data-testid="selection-count"]')).toContainText('1');
    
    // Verify protein info panel
    await expect(page.locator('[data-testid="protein-info"]')).toBeVisible();
  });

  test('protein table pagination', async ({ page }) => {
    await expect(page.locator('[data-testid="protein-table"]')).toBeVisible();
    
    // Verify pagination
    await page.click('[data-testid="next-page"]');
    await expect(page.locator('[data-testid="page-number"]')).toContainText('2');
  });
});
```

### Test Suite 5: QC Plots
```typescript
// e2e/05-qc-plots.spec.ts

test.describe('QC Plots', () => {
  test('all plots display with real data', async ({ page }) => {
    await page.goto('/analysis/visualization?tab=qc');
    
    // Verify all 6 plots visible
    await expect(page.locator('[data-testid="pca-plot"]')).toBeVisible();
    await expect(page.locator('[data-testid="pvalue-dist-plot"]')).toBeVisible();
    await expect(page.locator('[data-testid="cv-plot"]')).toBeVisible();
    await expect(page.locator('[data-testid="psm-intensity-plot"]')).toBeVisible();
    await expect(page.locator('[data-testid="protein-intensity-plot"]')).toBeVisible();
    await expect(page.locator('[data-testid="completeness-plot"]')).toBeVisible();
    
    // Verify no "no data" messages
    await expect(page.locator('[data-testid="no-data"]')).not.toBeVisible();
  });

  test('PCA shows variance percentages', async ({ page }) => {
    await expect(page.locator('[data-testid="pca-variance"]')).toContainText('%');
  });
});
```

### Test Suite 6: Bioinformatics
```typescript
// e2e/06-bioinformatics.spec.ts

test.describe('Bioinformatics', () => {
  test('GSEA results display', async ({ page }) => {
    await page.goto('/analysis/visualization?tab=bioinformatics');
    
    await expect(page.locator('[data-testid="gsea-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="gsea-plot"]')).toBeVisible();
  });

  test('database switching works', async ({ page }) => {
    await page.selectOption('[data-testid="database-select"]', 'KEGG');
    await expect(page.locator('[data-testid="loading"]')).toBeVisible();
    await expect(page.locator('[data-testid="gsea-table"]')).toBeVisible();
  });
});
```

---

## Integration Tests

### API Tests
```python
# tests/integration/test_api.py

import pytest
from fastapi.testclient import TestClient

@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)

class TestSessionAPI:
    def test_create_session(self, client):
        response = client.post("/api/v1/sessions", json={
            "name": "Test Session",
            "template": "protein_pairwise_comparison"
        })
        assert response.status_code == 201
        assert "id" in response.json()["data"]
    
    def test_upload_file(self, client):
        # Create session first
        session = client.post("/api/v1/sessions", json={
            "name": "Test",
            "template": "protein_pairwise_comparison"
        }).json()["data"]
        
        # Upload file
        with open("SampleData/PSM_SampleData_DMSO_1.csv", "rb") as f:
            response = client.post(
                f"/api/v1/sessions/{session['id']}/upload/proteomics",
                files={"files": ("PSM_SampleData_DMSO_1.csv", f, "text/csv")}
            )
        
        assert response.status_code == 201
        assert len(response.json()["data"]["uploaded"]) == 1
```

### Processing Tests
```python
# tests/integration/test_processing.py

@pytest.mark.asyncio
class TestProcessingPipeline:
    async def test_step_1_combine_replicates(self):
        from app.services.data_processor import Step1Combiner
        
        combiner = Step1Combiner()
        result = await combiner.process([
            "SampleData/PSM_SampleData_DMSO_1.csv",
            "SampleData/PSM_SampleData_DMSO_2.csv",
        ])
        
        assert result.output_path.exists()
        df = pd.read_csv(result.output_path, sep='\t')
        assert 'Sample_Origination' in df.columns
        assert len(df) > 0
```

### R Integration Tests
```python
# tests/integration/test_r_integration.py

@pytest.mark.skipif(
    not r_packages_installed(),
    reason="R packages not installed"
)
class TestRIntegration:
    def test_msqrob2_available(self):
        result = subprocess.run(
            ['Rscript', '-e', 'library(msqrob2); cat("OK")'],
            capture_output=True,
            text=True
        )
        assert result.returncode == 0
        assert "OK" in result.stdout
    
    def test_protein_abundance_script(self):
        result = subprocess.run(
            ['Rscript', 'scripts/msqrob2_protein.R', 
             'tests/fixtures/input.tsv', 
             'tests/fixtures/output.tsv'],
            capture_output=True,
            text=True
        )
        assert result.returncode == 0
        assert Path('tests/fixtures/output.tsv').exists()
```

---

## Unit Tests

### File Parser Tests
```python
# tests/unit/test_file_parser.py

import pytest
from app.utils.file_parser import parse_psm_filename, validate_csv_columns

class TestFileParser:
    def test_parse_valid_filename(self):
        result = parse_psm_filename("PSM_SampleData_DMSO_1.csv")
        assert result.experiment == "SampleData"
        assert result.condition == "DMSO"
        assert result.replicate == 1
    
    def test_parse_invalid_filename(self):
        with pytest.raises(ValidationError):
            parse_psm_filename("invalid_file.csv")
    
    def test_validate_required_columns(self):
        df = pd.DataFrame(columns=['Sequence', 'Modifications', 'Charge'])
        missing = validate_csv_columns(df)
        assert 'Contaminant' in missing
```

### Validator Tests
```python
# tests/unit/test_validators.py

class TestValidators:
    def test_validate_same_experiment(self):
        files = [
            ParsedFilename("SampleData", "DMSO", 1),
            ParsedFilename("SampleData", "INCZ", 1),
        ]
        assert validate_same_experiment(files) is True
    
    def test_validate_different_experiments(self):
        files = [
            ParsedFilename("SampleData", "DMSO", 1),
            ParsedFilename("OtherData", "DMSO", 1),
        ]
        assert validate_same_experiment(files) is False
    
    def test_validate_minimum_replicates(self):
        files = [
            ParsedFilename("SampleData", "DMSO", 1),
            ParsedFilename("SampleData", "DMSO", 2),
            ParsedFilename("SampleData", "INCZ", 1),
            ParsedFilename("SampleData", "INCZ", 2),
        ]
        assert validate_minimum_replicates(files, min_replicates=3) is False
```

---

## Test Data Fixtures

```python
# tests/conftest.py

import pytest
import shutil
import tempfile

@pytest.fixture
def temp_session_dir():
    """Create temporary session directory for tests."""
    temp_dir = tempfile.mkdtemp()
    yield Path(temp_dir)
    shutil.rmtree(temp_dir)

@pytest.fixture
def sample_psm_data():
    """Load sample PSM data."""
    return pd.read_csv("SampleData/PSM_SampleData_DMSO_1.csv", nrows=100)

@pytest.fixture
def mock_session():
    """Create mock session for testing."""
    return Session(
        id="test-session-id",
        name="Test Session",
        template="protein_pairwise_comparison",
        state="created",
    )
```

---

## Coverage Requirements

| Module | Coverage Target |
|--------|----------------|
| Backend services | 80% |
| API routes | 90% |
| Frontend components | 70% |
| Utility functions | 90% |
| E2E critical paths | 100% |

---

## Test Commands

```bash
# Backend tests
cd backend && pytest

# With coverage
cd backend && pytest --cov=app --cov-report=html

# Frontend unit tests
cd frontend && npm run test

# E2E tests
cd frontend && npx playwright test

# E2E with UI
cd frontend && npx playwright test --ui

# Specific test file
cd frontend && npx playwright test e2e/04-results.spec.ts

# All tests
npm run test:all
```

---

## Next Steps

See [10-processing-pipeline.md](10-processing-pipeline.md) for processing details.
