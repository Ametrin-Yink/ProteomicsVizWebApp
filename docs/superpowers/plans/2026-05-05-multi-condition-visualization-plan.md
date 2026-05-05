# Multi-Condition Visualization Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the visualization layer from pairwise (single comparison) to multi-condition (N comparisons) by fixing the broken volcano comparison selector, adding comparison selectors to GSEA and QC pages, removing pipeline GSEA in favor of on-demand, computing per-comparison QC p-value distributions, and replacing hardcoded pairwise labels/colors across all visualization components.

**Architecture:** Backend QC step 8 iterates all per-comparison DE files and stores per-comparison p-value distributions. Backend step 9 (GSEA) is removed from pipeline templates — all GSEA is on-demand via the existing `POST /gsea/run` endpoint. Frontend pages gain comparison selectors using a shared comparison label contract (`formatGroup(g1) + "_vs_" + formatGroup(g2)` for file IDs, `formatGroup(g1) + " vs " + formatGroup(g2)` for display). Visualization components accept `comparisonLabel` props or use dynamic color palettes instead of hardcoded Treatment/Control references.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Plotly.js, Zustand (frontend); FastAPI, Python 3.12, Pydantic, pandas, numpy (backend)

---

### Task 1: Types cleanup — make treatment/control optional, add pvalue_distributions

**Files:**
- Modify: `frontend/src/types/api.ts:41-43,108-114`
- Modify: `frontend/src/types/index.ts:49-50`

- [ ] **Step 1: Make `treatment` and `control` optional in `api.ts` SessionConfig**

In `frontend/src/types/api.ts`, change lines 41-43 from:
```typescript
export interface SessionConfig {
  treatment: string;
  control: string;
```
to:
```typescript
export interface SessionConfig {
  treatment?: string;
  control?: string;
```

- [ ] **Step 2: Add `pvalue_distributions` field to `QCData` in api.ts**

In `frontend/src/types/api.ts`, add after line 159 (`data_completeness?: DataCompleteness;`):
```typescript
  pvalue_distributions?: Record<string, PValueDistribution>;
```

- [ ] **Step 3: Mirror the same changes in `types/index.ts`**

In `frontend/src/types/index.ts`, change lines 49-50 from:
```typescript
export interface SessionConfig {
  treatment: string;
  control: string;
```
to:
```typescript
export interface SessionConfig {
  treatment?: string;
  control?: string;
```

- [ ] **Step 4: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: May produce errors in files that access `treatment`/`control` without optional chaining. Fix those in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/types/index.ts
git commit -m "feat: make treatment/control optional, add pvalue_distributions to QCData type"
```

---

### Task 2: Backend QC data model — add pvalue_distributions field

**Files:**
- Modify: `backend/app/models/data.py:124-142`

- [ ] **Step 1: Add `pvalue_distributions` to backend `QCData` model**

In `backend/app/models/data.py`, add after line 133 (`psm_completeness`):
```python
    pvalue_distributions: Optional[dict[str, PValueDistribution]] = None
```

The full `QCData` class becomes:
```python
class QCData(BaseModel):
    """Complete QC metrics data."""

    pca: Optional[PCAResult] = None
    pvalue_distribution: Optional[PValueDistribution] = None
    psm_cv: Optional[dict[str, list[float]]] = None
    protein_cv: Optional[dict[str, list[float]]] = None
    intensity_distributions: Optional[IntensityDistribution] = None
    data_completeness: Optional[list[DataCompleteness]] = None
    psm_completeness: Optional[list[DataCompleteness]] = None
    pvalue_distributions: Optional[dict[str, PValueDistribution]] = None
    # Summary statistics
    total_psms: Optional[int] = None
    avg_psms_per_sample: Optional[float] = None
    total_proteins: Optional[int] = None
    avg_proteins_per_sample: Optional[int] = None
    average_cv: Optional[float] = None
    average_protein_cv: Optional[float] = None
    average_psm_cv: Optional[float] = None
    completeness_rate: Optional[float] = None
```

- [ ] **Step 2: Run backend tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/data.py
git commit -m "feat: add pvalue_distributions dict to QCData model"
```

---

### Task 3: Backend QC calculator — accept multiple DE files for p-value aggregation

**Files:**
- Modify: `backend/app/services/qc_calculator.py:34-132`

- [ ] **Step 1: Change `calculate_all_metrics` to accept a list of DE paths**

In `backend/app/services/qc_calculator.py`, change the method signature and body at lines 34-40 from:
```python
    async def calculate_all_metrics(
        self,
        protein_abundances_path: Path,
        diff_expression_path: Path,
        psm_abundances_path: Optional[Path] = None,
    ) -> QCData:
```
to:
```python
    async def calculate_all_metrics(
        self,
        protein_abundances_path: Path,
        diff_expression_paths: list[Path],
        psm_abundances_path: Optional[Path] = None,
    ) -> QCData:
```

- [ ] **Step 2: Update the docstring**

Replace lines 41-49 with:
```python
        """
        Calculate all QC metrics.

        Args:
            protein_abundances_path: Path to Protein_Abundances.tsv
            diff_expression_paths: List of paths to Diff_Expression_*.tsv files
            psm_abundances_path: Optional path to PSM_Abundances.tsv

        Returns:
            QCData object with all metrics
        """
```

- [ ] **Step 3: Update the body — load the first DE file for single pvalue_distribution (backward compat)**

Replace lines 56-57 from:
```python
        diff_df = await asyncio.to_thread(pd.read_csv, diff_expression_path, sep="\t")
```
to:
```python
        # Load first DE file for backward-compatible pvalue_distribution field
        first_diff_df = await asyncio.to_thread(pd.read_csv, diff_expression_paths[0], sep="\t") if diff_expression_paths else None
```

- [ ] **Step 4: Compute per-comparison pvalue distributions**

After the `diff_df` load (now just before the concurrency gather), add:
```python
        # Compute per-comparison p-value distributions
        pvalue_distributions: dict[str, PValueDistribution] = {}
        for diff_path in diff_expression_paths:
            # Extract comparison label: Diff_Expression_<label>.tsv → <label>
            label = diff_path.stem.replace("Diff_Expression_", "")
            try:
                comp_df = await asyncio.to_thread(pd.read_csv, diff_path, sep="\t")
                pvalue_distributions[label] = self._calculate_pvalue_distribution(comp_df)
            except Exception:
                logger.warning(f"Could not compute p-value distribution for {diff_path.name}", exc_info=True)
```

- [ ] **Step 5: Update the usage of `diff_df` in the QCData constructor**

Replace line 113 from:
```python
            pvalue_distribution=self._calculate_pvalue_distribution(diff_df),
```
to:
```python
            pvalue_distribution=self._calculate_pvalue_distribution(first_diff_df) if first_diff_df is not None else PValueDistribution(bins=[], counts=[]),
```

- [ ] **Step 6: Add `pvalue_distributions` to the QCData constructor**

Add after the `pvalue_distribution` line (after line 113):
```python
            pvalue_distributions=pvalue_distributions if pvalue_distributions else None,
```

- [ ] **Step 7: Run backend tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
```
Expected: Tests pass. If any tests construct `QCData` directly, they may need updating — fix those.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/qc_calculator.py
git commit -m "feat: compute per-comparison p-value distributions in QC calculator"
```

---

### Task 4: Backend QC step — iterate all comparisons

**Files:**
- Modify: `backend/app/services/steps/qc_metrics.py`

- [ ] **Step 1: Replace `_resolve_de_output` with all-comparisons glob**

In `backend/app/services/steps/qc_metrics.py`, replace the entire file content:

```python
"""Step 8: QC metrics calculation."""

from pathlib import Path

from app.services.pipeline_engine import StepContext
from app.services.qc_calculator import QCCalculator


async def step_qc_metrics(ctx: StepContext) -> None:
    qc_output = ctx.results_dir / "QC_Results.json"
    psm_qc_path = ctx.psm_file_path
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"

    # Gather all per-comparison DE files
    de_paths = sorted(ctx.results_dir.glob("Diff_Expression_*.tsv"))
    if not de_paths:
        # Fall back to legacy single file
        legacy = ctx.results_dir / "Diff_Expression.tsv"
        if legacy.exists():
            de_paths = [legacy]
        else:
            raise FileNotFoundError(
                f"No Diff_Expression files found in {ctx.results_dir}"
            )

    qc_calc = QCCalculator()
    qc_data = await qc_calc.calculate_all_metrics(
        protein_abundances_path=protein_output,
        diff_expression_paths=de_paths,
        psm_abundances_path=psm_qc_path,
    )
    qc_calc.save_qc_data(qc_data, qc_output)
    ctx.result.qc_results_path = str(qc_output)
    ctx.step_outputs[8] = qc_output
```

- [ ] **Step 2: Run backend tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/steps/qc_metrics.py
git commit -m "feat: iterate all comparisons in QC step for per-comparison p-value distributions"
```

---

### Task 5: Backend pipeline registry — remove step 9 (GSEA)

**Files:**
- Modify: `backend/app/services/pipeline_registry.py`

- [ ] **Step 1: Remove step 9 from both pipeline templates**

In `backend/app/services/pipeline_registry.py`, remove the step 9 lines from both `register()` calls.

For the MULTI_CONDITION pipeline (lines 27-59), remove:
```python
        PipelineStep(9, "gsea", "GSEA Analysis", step_gsea_analysis),
```

For the MSSTATS pipeline (lines 66-98), remove:
```python
        PipelineStep(9, "gsea", "GSEA Analysis", step_gsea_analysis),
```

- [ ] **Step 2: Remove the `step_gsea_analysis` import**

Change line 16 from:
```python
    step_gsea_analysis,
```
Remove the import line entirely.

- [ ] **Step 3: Run backend tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
```
Expected: Tests referencing 9-step pipeline may need updating to expect 8 steps.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/pipeline_registry.py
git commit -m "feat: remove GSEA step 9 from pipeline templates (now on-demand only)"
```

---

### Task 6: Backend QC API — add comparison parameter

**Files:**
- Modify: `backend/app/api/routes/visualization.py:507-538`

- [ ] **Step 1: Add `comparison` query parameter to `get_qc_plots`**

Change lines 507-508 from:
```python
@router.get("/{session_id}/qc/plots")
async def get_qc_plots(
    session_id: str, store: SessionStore = Depends(get_session_store)
):
```
to:
```python
@router.get("/{session_id}/qc/plots")
async def get_qc_plots(
    session_id: str,
    comparison: str = Query("", description="Comparison label for per-comparison p-value distribution"),
    store: SessionStore = Depends(get_session_store),
):
```

- [ ] **Step 2: Add comparison filtering logic**

After line 523 (`qc_data = load_qc_results(results_dir)`), add:
```python
    # Filter p-value distribution to requested comparison
    if comparison and qc_data.get("pvalue_distributions"):
        dist = qc_data["pvalue_distributions"].get(comparison)
        if dist:
            qc_data["pvalue_distribution"] = dist
```

- [ ] **Step 3: Run backend tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/routes/visualization.py
git commit -m "feat: add comparison parameter to QC plots endpoint"
```

---

### Task 7: Backend GSEA API — add comparison parameter to listing endpoint

**Files:**
- Modify: `backend/app/api/routes/visualization.py:942-1006`

- [ ] **Step 1: Add `comparison` query parameter to `get_gsea_results`**

Change lines 942-952 from:
```python
@router.get("/{session_id}/gsea/{database}")
async def get_gsea_results(
    session_id: str,
    database: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    sort_by: str = Query("nes"),
    sort_order: str = Query("desc"),
    significant_only: bool = Query(False),
    search: str = Query(""),
    store: SessionStore = Depends(get_session_store),
):
```
to:
```python
@router.get("/{session_id}/gsea/{database}")
async def get_gsea_results(
    session_id: str,
    database: str,
    comparison: str = Query("", description="Comparison label for multi-condition"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    sort_by: str = Query("nes"),
    sort_order: str = Query("desc"),
    significant_only: bool = Query(False),
    search: str = Query(""),
    store: SessionStore = Depends(get_session_store),
):
```

- [ ] **Step 2: Add comparison subdirectory routing**

After line 963 (`results_dir = settings.sessions_dir / session_id / "results"`), add:
```python
    # Route to per-comparison directory when comparison is specified
    if comparison:
        results_dir = results_dir / "gsea" / comparison
```

- [ ] **Step 3: Run backend tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/routes/visualization.py
git commit -m "feat: add comparison parameter to GSEA results listing endpoint"
```

---

### Task 8: Frontend API layer — fix getSession comparison type

**Files:**
- Modify: `frontend/src/lib/api.ts:50-81`

- [ ] **Step 1: Fix `getSession` return type**

In `frontend/src/lib/api.ts`, change lines 50-68 from:
```typescript
export async function getSession(
  sessionId: string
): Promise<{
  id: string;
  name: string;
  config?: {
    treatment: string;
    control: string;
    comparisons?: Array<{ treatment: string; control: string }>;
  };
  files?: { proteomics: Array<{ experiment: string }> };
  markers?: string[];
  volcano_filters?: {
    foldChange: number;
    pValue: number;
    adjPValue: number;
    s0: number;
  };
}> {
```
to:
```typescript
export async function getSession(
  sessionId: string
): Promise<{
  id: string;
  name: string;
  config?: {
    treatment?: string;
    control?: string;
    comparisons?: Array<{ group1: Record<string, string>; group2: Record<string, string> }>;
  };
  files?: { proteomics: Array<{ experiment: string }> };
  markers?: string[];
  volcano_filters?: {
    foldChange: number;
    pValue: number;
    adjPValue: number;
    s0: number;
  };
}> {
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: May produce errors in files that access `.treatment`/`.control` on comparison objects. Fix in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "fix: correct getSession comparison type to match backend format"
```

---

### Task 9: Frontend VolcanoPlot — accept comparisonLabel prop, fix labels

**Files:**
- Modify: `frontend/src/components/visualization/VolcanoPlot.tsx:12-28,184-267`

- [ ] **Step 1: Add `comparisonLabel` prop to VolcanoPlotProps**

Change the interface at lines 12-19:
```typescript
interface VolcanoPlotProps {
  data: DEResult[];
  filters: VolcanoFilters;
  selectedProteins: Set<string>;
  markedProteins: Set<string>;
  onSelectProteins: (proteins: string[]) => void;
  onClearSelection?: () => void;
  comparisonLabel?: string;
}
```

- [ ] **Step 2: Accept it in the component destructuring**

Change line 21-28:
```typescript
export default function VolcanoPlot({
  data,
  filters,
  selectedProteins,
  markedProteins,
  onSelectProteins,
  onClearSelection,
  comparisonLabel,
}: VolcanoPlotProps) {
```

- [ ] **Step 3: Derive group labels from comparisonLabel**

Add after the destructuring:
```typescript
  const parts = comparisonLabel ? comparisonLabel.split(' vs ') : [];
  const group1Label = parts[0] || 'Treatment';
  const group2Label = parts[1] || 'Control';
```

- [ ] **Step 4: Fix the X-axis title (line 192)**

Change from:
```typescript
        title: { text: 'log₂(Treatment/Control)', font: { size: 14 } },
```
to:
```typescript
        title: { text: `log₂(${group1Label}/${group2Label})`, font: { size: 14 } },
```

- [ ] **Step 5: Fix the legend labels (lines 262-267)**

Change from:
```typescript
            <span>Upregulated (Treatment &gt; Control)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#00ADEF' }}></span>
            <span>Downregulated (Control &gt; Treatment)</span>
```
to:
```typescript
            <span>Upregulated ({group1Label} &gt; {group2Label})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#00ADEF' }}></span>
            <span>Downregulated ({group2Label} &gt; {group1Label})</span>
```

- [ ] **Step 6: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: Passes. VolcanoPage.tsx will need updating next.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/visualization/VolcanoPlot.tsx
git commit -m "feat: add comparisonLabel prop to VolcanoPlot, replace hardcoded Treatment/Control labels"
```

---

### Task 10: Frontend ProteinTable — accept comparisonLabel for export filename

**Files:**
- Modify: `frontend/src/components/visualization/ProteinTable.tsx:8-18,133-151`

- [ ] **Step 1: Add `comparisonLabel` to ProteinTableProps**

Change line 15 from:
```typescript
  sessionConfig: { treatment: string; control: string; experiment: string } | null;
```
to:
```typescript
  sessionConfig: { treatment?: string; control?: string; experiment: string } | null;
  comparisonLabel?: string;
```

- [ ] **Step 2: Update the destructuring**

Change lines 40-51 to include `comparisonLabel`:
```typescript
export default function ProteinTable({
  data,
  selectedProteins,
  onSelectProtein,
  showSelectedOnly,
  onToggleShowSelected,
  filters,
  sessionConfig,
  comparisonLabel,
  markedProteins,
  onToggleMark,
  onClearAllMarks,
}: ProteinTableProps) {
```

- [ ] **Step 3: Fix CSV export filename (lines 147-149)**

Change from:
```typescript
    const filename = sessionConfig
      ? `${sessionConfig.experiment}_${sessionConfig.treatment}_vs_${sessionConfig.control}`
      : 'protein_results';
```
to:
```typescript
    const filename = sessionConfig
      ? `${sessionConfig.experiment}_${comparisonLabel || 'results'}`
      : 'protein_results';
```

- [ ] **Step 4: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visualization/ProteinTable.tsx
git commit -m "feat: use comparisonLabel in ProteinTable export filename"
```

---

### Task 11: Frontend AbundancePlot — dynamic color palette for N conditions

**Files:**
- Modify: `frontend/src/components/visualization/AbundancePlot.tsx:44-48`

- [ ] **Step 1: Replace hardcoded named colors with dynamic palette**

In `frontend/src/components/visualization/AbundancePlot.tsx`, replace lines 44-49:
```typescript
    const namedColors: Record<string, string> = {
      Control: '#00ADEF',
      Treatment: '#E73564',
      DMSO: '#00ADEF',
    };

    // Fallback colors in order for unlabeled conditions
    const fallbackColors = ['#00ADEF', '#E73564'];
```
with:
```typescript
    const TABLEAU_10 = [
      '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
      '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
    ];

    function getColorForCondition(condition: string, index: number): string {
      return TABLEAU_10[index % TABLEAU_10.length];
    }
```

- [ ] **Step 2: Update the color assignment loop**

Replace lines 53-69:
```typescript
    return Object.entries(conditionData).map(([condition, values], idx) => {
      let color = namedColors[condition];
      if (!color) {
        // For unlabeled conditions, alternate between blue and pink
        color = fallbackColors[idx % fallbackColors.length];
      }
      return {
```
with:
```typescript
    return Object.entries(conditionData).map(([condition, values], idx) => {
      const color = getColorForCondition(condition, idx);
      return {
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/visualization/AbundancePlot.tsx
git commit -m "feat: replace hardcoded Control/Treatment colors with dynamic Tableau-10 palette in AbundancePlot"
```

---

### Task 12: Frontend QCPlots — dynamic color palette + per-comparison p-value

**Files:**
- Modify: `frontend/src/components/visualization/QCPlots.tsx:13-50,105-139`

- [ ] **Step 1: Replace treatment/control props with conditionList and selectedComparison**

Change lines 13-17 from:
```typescript
interface QCPlotsProps {
  data: QCData;
  treatment?: string;
  control?: string;
}
```
to:
```typescript
interface QCPlotsProps {
  data: QCData;
  conditionList?: string[];
  selectedComparison?: string;
}
```

- [ ] **Step 2: Add Tableau-10 palette and color mapping**

Replace the component opening at lines 25-50 with:
```typescript
export default function QCPlots({ data, conditionList, selectedComparison }: QCPlotsProps) {
  const TABLEAU_10 = [
    '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
    '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
  ];

  // Build a deterministic condition→color map from the condition list
  const conditionColors = useMemo(() => {
    const map: Record<string, string> = {};
    (conditionList || []).forEach((cond, i) => {
      map[cond] = TABLEAU_10[i % TABLEAU_10.length];
    });
    return map;
  }, [conditionList]);

  const getConditionColor = useCallback((condition: string) => {
    // Exact match first
    if (conditionColors[condition]) return conditionColors[condition];
    // Case-insensitive fallback
    const key = Object.keys(conditionColors).find(
      k => k.toLowerCase() === condition.toLowerCase()
    );
    if (key) return conditionColors[key];
    // If no match, hash the condition name to a color
    let hash = 0;
    for (let i = 0; i < condition.length; i++) {
      hash = ((hash << 5) - hash) + condition.charCodeAt(i);
      hash |= 0;
    }
    return TABLEAU_10[Math.abs(hash) % TABLEAU_10.length];
  }, [conditionColors]);
```

- [ ] **Step 3: Remove the hardcoded treatmentColor/controlColor/proteinTreatmentColor/proteinControlColor**

Delete lines 27-28 (the `treatmentColor` / `controlColor` constants) and lines 40-41 (the `proteinTreatmentColor` / `proteinControlColor` constants).

- [ ] **Step 4: Simplify `getProteinConditionColor` — use same palette with different saturation**

Replace the `getProteinConditionColor` callback (lines 43-50) with:
```typescript
  const getProteinConditionColor = useCallback((condition: string) => {
    // Use a shifted palette variant for protein CV (offset by 4 positions)
    const PROTEIN_TABLEAU = [
      '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948',
      '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC', '#4E79A7',
    ];
    if (conditionColors[condition]) {
      const idx = (conditionList || []).indexOf(condition);
      return idx >= 0 ? PROTEIN_TABLEAU[idx % PROTEIN_TABLEAU.length] : '#94a3b8';
    }
    let hash = 0;
    for (let i = 0; i < condition.length; i++) {
      hash = ((hash << 5) - hash) + condition.charCodeAt(i);
      hash |= 0;
    }
    return PROTEIN_TABLEAU[Math.abs(hash) % PROTEIN_TABLEAU.length];
  }, [conditionColors, conditionList]);
```

- [ ] **Step 5: Update p-value distribution to use selectedComparison**

In the `pvalueDistPlot` `useMemo` (line 105-139), change the data source. Replace line 106:
```typescript
    if (!data.pvalue_distribution) return null;
```
with:
```typescript
    const pvDist = selectedComparison && data.pvalue_distributions
      ? data.pvalue_distributions[selectedComparison]
      : data.pvalue_distribution;
    if (!pvDist) return null;
```

And change all `data.pvalue_distribution` references inside this `useMemo` to `pvDist` (lines 109 and 112):
```typescript
      x: pvDist.bins.slice(0, -1).map((bin, i) =>
        (bin + pvDist.bins[i + 1]) / 2
      ),
      y: pvDist.counts,
```

- [ ] **Step 6: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/visualization/QCPlots.tsx
git commit -m "feat: dynamic color palette for N conditions, per-comparison p-value in QCPlots"
```

---

### Task 13: Frontend Volcano page — fix broken comparison selector

**Files:**
- Modify: `frontend/src/app/analysis/visualization/page.tsx:22,86-93,284-309`
- Modify: (caller of VolcanoPlot and ProteinTable)

- [ ] **Step 1: Fix the sessionConfig type (line 22)**

Change from:
```typescript
  const [sessionConfig, setSessionConfig] = useState<{ treatment: string; control: string; experiment: string; comparisons?: Array<{ treatment: string; control: string }> } | null>(null);
```
to:
```typescript
  const [sessionConfig, setSessionConfig] = useState<{ treatment?: string; control?: string; experiment: string; comparisons?: Array<{ group1: Record<string, string>; group2: Record<string, string> }> } | null>(null);
```

- [ ] **Step 2: Add `formatGroup` import (line 12)**

Change the import to include `formatGroup`:
```typescript
import { isSignificantVolcano, parseDelimited, formatGroup } from '@/lib/utils';
```

- [ ] **Step 3: Fix first comparison auto-select (lines 86-93)**

Replace:
```typescript
        // Auto-select first comparison on initial load
        if (!comparisonInitialized.current) {
          if (comparisons && comparisons.length > 0) {
            const first = comparisons[0];
            setSelectedComparison(`${first.treatment}_vs_${first.control}`);
          } else if (cfg.treatment && cfg.control) {
            setSelectedComparison('');
          }
          comparisonInitialized.current = true;
        }
```
with:
```typescript
        // Auto-select first comparison on initial load
        if (!comparisonInitialized.current) {
          if (comparisons && comparisons.length > 0) {
            const first = comparisons[0];
            setSelectedComparison(formatGroup(first.group1) + '_vs_' + formatGroup(first.group2));
          } else if (cfg.treatment && cfg.control) {
            setSelectedComparison('');
          }
          comparisonInitialized.current = true;
        }
```

- [ ] **Step 4: Fix comparison button rendering (lines 284-309)**

Replace the comparison button section:
```typescript
          {sessionConfig?.comparisons && sessionConfig.comparisons.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {sessionConfig.comparisons.map((c, i) => {
                const val = `${c.treatment}_vs_${c.control}`;
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedComparison(val)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      selectedComparison === val
                        ? 'bg-primary text-white'
                        : 'bg-surface text-text-secondary hover:bg-border'
                    }`}
                  >
                    {c.treatment} vs {c.control}
                  </button>
                );
              })}
            </div>
```
with:
```typescript
          {sessionConfig?.comparisons && sessionConfig.comparisons.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {sessionConfig.comparisons.map((c, i) => {
                const val = formatGroup(c.group1) + '_vs_' + formatGroup(c.group2);
                const label = formatGroup(c.group1) + ' vs ' + formatGroup(c.group2);
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedComparison(val)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      selectedComparison === val
                        ? 'bg-primary text-white'
                        : 'bg-surface text-text-secondary hover:bg-border'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
```

- [ ] **Step 5: Pass `comparisonLabel` to VolcanoPlot (line 327-334)**

Add the `comparisonLabel` prop. Compute it above the JSX:
```typescript
  const comparisonLabel = selectedComparison
    ? selectedComparison.replace(/_vs_/g, ' vs ')
    : (sessionConfig?.treatment && sessionConfig?.control
      ? `${sessionConfig.treatment} vs ${sessionConfig.control}`
      : undefined);
```

Then change the VolcanoPlot call:
```typescript
            <VolcanoPlot
              data={data.results}
              filters={filters}
              selectedProteins={selectedProteins}
              markedProteins={markedProteins}
              onSelectProteins={handleSelectProteins}
              onClearSelection={clearSelection}
              comparisonLabel={comparisonLabel}
            />
```

- [ ] **Step 6: Pass `comparisonLabel` to ProteinTable (line 347-358)**

Add the prop:
```typescript
            <ProteinTable
              data={data.results}
              selectedProteins={selectedProteins}
              onSelectProtein={handleSelectProteinFromTable}
              showSelectedOnly={showSelectedOnly}
              onToggleShowSelected={() => setShowSelectedOnly(!showSelectedOnly)}
              filters={filters}
              sessionConfig={sessionConfig}
              comparisonLabel={comparisonLabel}
              markedProteins={markedProteins}
              onToggleMark={handleToggleMark}
              onClearAllMarks={handleClearAllMarks}
            />
```

- [ ] **Step 7: Run TypeScript check and verify the page compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/analysis/visualization/page.tsx
git commit -m "fix: correct comparison selector in volcano page using formatGroup"
```

---

### Task 14: Frontend QC page — add comparison selector for p-value section

**Files:**
- Modify: `frontend/src/app/analysis/visualization/qc/page.tsx`

- [ ] **Step 1: Add comparison selector state and imports**

Add `formatGroup` to the import from utils (line 6-8 currently imports nothing from utils — add the import):
```typescript
import { formatGroup } from '@/lib/utils';
```

Add state variables after line 18:
```typescript
  const [conditionList, setConditionList] = useState<string[]>([]);
  const [comparisons, setComparisons] = useState<Array<{ group1: Record<string, string>; group2: Record<string, string> }>>([]);
  const [selectedComparison, setSelectedComparison] = useState<string>('');
```

- [ ] **Step 2: Fetch conditions and comparisons from session**

Replace lines 28-33 (the session fetch section) with:
```typescript
        // Fetch session config for condition list and comparisons
        const session = await getSession(sessionId);
        if (session?.config) {
          // Extract unique condition names from files
          const proteomicsFiles = session.files?.proteomics || [];
          const condSet = new Set<string>();
          proteomicsFiles.forEach((f: { condition?: string }) => {
            if (f.condition) condSet.add(f.condition);
          });
          setConditionList(Array.from(condSet));
          setComparisons(session.config.comparisons || []);
        }
```

- [ ] **Step 3: Remove treatment/control state and replace usage**

Remove lines 17-18:
```typescript
  const [treatment, setTreatment] = useState<string>('');
  const [control, setControl] = useState<string>('');
```

- [ ] **Step 4: Update QCPlots call to pass new props**

Replace line 153:
```typescript
          <QCPlots data={data} treatment={treatment || undefined} control={control || undefined} />
```
with:
```typescript
          <QCPlots data={data} conditionList={conditionList} selectedComparison={selectedComparison || undefined} />
```

- [ ] **Step 5: Add comparison selector above the QC Plots section**

Insert before the `<QCPlots ...>` element a comparison selector for p-value filtering:
```typescript
        {/* Comparison selector for p-value distribution */}
        {comparisons.length > 0 && (
          <div className="mb-4 bg-background rounded-lg border border-border p-4">
            <label className="block text-sm font-medium text-text-primary mb-3">
              P-value Distribution: Select Comparison
            </label>
            <div className="flex flex-wrap gap-2">
              {comparisons.map((c, i) => {
                const val = formatGroup(c.group1) + '_vs_' + formatGroup(c.group2);
                const label = formatGroup(c.group1) + ' vs ' + formatGroup(c.group2);
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedComparison(val)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      selectedComparison === val
                        ? 'bg-primary text-white'
                        : 'bg-surface text-text-secondary hover:bg-border'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
```

- [ ] **Step 6: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/analysis/visualization/qc/page.tsx
git commit -m "feat: add comparison selector for p-value distribution on QC page"
```

---

### Task 15: Frontend GSEA page — add comparison selector + Run GSEA button

**Files:**
- Modify: `frontend/src/app/analysis/visualization/gsea/page.tsx`
- Modify: `frontend/src/components/visualization/GSEAPlot.tsx:10-17,40-42`

- [ ] **Step 1: Add all new imports and state**

Add `formatGroup` import:
```typescript
import { formatGroup } from '@/lib/utils';
```

Add `getSession` and `runGSEA` to the API import:
```typescript
import { getGSEAData, getSession, runGSEA } from '@/lib/api';
```

Add new state variables after line 25:
```typescript
  const [sessionConfig, setSessionConfig] = useState<{
    comparisons?: Array<{ group1: Record<string, string>; group2: Record<string, string> }>;
  } | null>(null);
  const [selectedComparison, setSelectedComparison] = useState<string>('');
  const [gseaExistsMap, setGseaExistsMap] = useState<Record<string, boolean>>({});
  const [runDatabases, setRunDatabases] = useState<GSEADatabase[]>(['go_bp', 'kegg', 'reactome']);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [runParams, setRunParams] = useState({ min_size: 15, max_size: 500, permutations: 1000 });
  const [runningGSEA, setRunningGSEA] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
```

- [ ] **Step 2: Fetch session config on mount**

Add a new `useEffect` after line 43:
```typescript
  // Fetch session config for comparisons
  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then(session => {
      if (session?.config) {
        setSessionConfig({
          comparisons: session.config.comparisons,
        });
        // Auto-select first comparison
        const comps = session.config.comparisons;
        if (comps && comps.length > 0) {
          const first = comps[0];
          const val = formatGroup(first.group1) + '_vs_' + formatGroup(first.group2);
          setSelectedComparison(val);
        }
      }
    }).catch(() => {});
  }, [sessionId]);
```

- [ ] **Step 3: Pass comparison to getGSEAData in the fetch effect**

In the existing `fetchData` effect (lines 44-79), change the `getGSEAData` call at line 52 to include `comparison`:
```typescript
        const gseaData = await getGSEAData(sessionId, selectedDatabase, {
          page,
          per_page: pageSize,
          sort_by: sortBy,
          sort_order: sortOrder,
          significant_only: significantOnly,
          search: debouncedSearch,
          comparison: selectedComparison || undefined,
        });
```

- [ ] **Step 4: Add `selectedComparison` to the useEffect dependency array**

Change line 79 from:
```typescript
  }, [selectedDatabase, sessionId, page, sortBy, sortOrder, significantOnly, debouncedSearch]);
```
to:
```typescript
  }, [selectedDatabase, sessionId, selectedComparison, page, sortBy, sortOrder, significantOnly, debouncedSearch]);
```

- [ ] **Step 5: Add `handleRunGSEA` callback**

Add before the `if (!sessionId)` check:
```typescript
  const handleRunGSEA = async () => {
    if (!selectedComparison || runDatabases.length === 0) return;
    setRunningGSEA(true);
    setRunError(null);
    try {
      await runGSEA(sessionId, {
        comparison: selectedComparison,
        databases: runDatabases,
        min_size: runParams.min_size,
        max_size: runParams.max_size,
        permutations: runParams.permutations,
      });
      setGseaExistsMap(prev => ({ ...prev, [selectedComparison + '_' + selectedDatabase]: true }));
      // Re-fetch to show results
      const gseaData = await getGSEAData(sessionId, selectedDatabase, {
        page: 1,
        per_page: pageSize,
        comparison: selectedComparison,
      });
      setData(gseaData);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'GSEA run failed');
    } finally {
      setRunningGSEA(false);
    }
  };
```

- [ ] **Step 6: Add comparison selector and Run GSEA UI**

After the header section (after line 132), add:
```typescript
        {/* Comparison Selector */}
        {sessionConfig?.comparisons && sessionConfig.comparisons.length > 0 && (
          <div className="bg-background rounded-lg border border-border p-4 mb-4">
            <label className="block text-sm font-medium text-text-primary mb-3">
              Select Comparison
            </label>
            <div className="flex flex-wrap gap-2">
              {sessionConfig.comparisons.map((c, i) => {
                const val = formatGroup(c.group1) + '_vs_' + formatGroup(c.group2);
                const label = formatGroup(c.group1) + ' vs ' + formatGroup(c.group2);
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedComparison(val)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      selectedComparison === val
                        ? 'bg-primary text-white'
                        : 'bg-surface text-text-secondary hover:bg-border'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Run GSEA Section */}
        {selectedComparison && (
          <div className="bg-background rounded-lg border border-border p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-text-primary">Run GSEA for: {selectedComparison.replace(/_vs_/g, ' vs ')}</span>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs text-text-muted hover:text-text-secondary"
              >
                {showAdvanced ? 'Hide' : 'Show'} Advanced
              </button>
            </div>

            {/* Database checkboxes */}
            <div className="flex flex-wrap gap-2 mb-3">
              {DATABASES.map((db) => (
                <label key={db} className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={runDatabases.includes(db)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setRunDatabases(prev => [...prev, db]);
                      } else {
                        setRunDatabases(prev => prev.filter(d => d !== db));
                      }
                    }}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  {GSEADatabaseLabels[db]}
                </label>
              ))}
            </div>

            {/* Advanced parameters */}
            {showAdvanced && (
              <div className="grid grid-cols-3 gap-3 mb-3 p-3 bg-surface rounded-lg">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Min Size</label>
                  <input
                    type="number"
                    value={runParams.min_size}
                    onChange={(e) => setRunParams(prev => ({ ...prev, min_size: parseInt(e.target.value) || 15 }))}
                    className="w-full px-2 py-1 text-sm border border-border rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Max Size</label>
                  <input
                    type="number"
                    value={runParams.max_size}
                    onChange={(e) => setRunParams(prev => ({ ...prev, max_size: parseInt(e.target.value) || 500 }))}
                    className="w-full px-2 py-1 text-sm border border-border rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Permutations</label>
                  <input
                    type="number"
                    value={runParams.permutations}
                    onChange={(e) => setRunParams(prev => ({ ...prev, permutations: parseInt(e.target.value) || 1000 }))}
                    className="w-full px-2 py-1 text-sm border border-border rounded-md"
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleRunGSEA}
              disabled={runningGSEA || runDatabases.length === 0}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {runningGSEA ? 'Running GSEA...' : 'Run GSEA'}
            </button>

            {runError && (
              <p className="mt-2 text-sm text-error">{runError}</p>
            )}
          </div>
        )}
```

- [ ] **Step 7: Pass `comparison` to GSEAPlot when selected**

The `GSEAPlot` component at line 183 needs to receive the comparison. Check `GSEAPlot.tsx` to see if it already accepts a `comparison` prop — if not, add it (but based on its usage of `getGSEAPlotData`, it likely passes through to the API already). Change line 183:
```typescript
                <GSEAPlot pathway={selectedPathway} sessionId={sessionId} database={selectedDatabase} comparison={selectedComparison || undefined} onPathwayUpdated={setSelectedPathway} />
```

- [ ] **Step 8: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app/analysis/visualization/gsea/page.tsx
git commit -m "feat: add comparison selector and Run GSEA button to GSEA page"
```

---

### Task 16: GSEAPlot — accept and pass through comparison prop

**Files:**
- Modify: `frontend/src/components/visualization/GSEAPlot.tsx:10-17,24-42`

- [ ] **Step 1: Add `comparison` prop to GSEAPlotProps**

In `frontend/src/components/visualization/GSEAPlot.tsx`, change lines 10-15 from:
```typescript
interface GSEAPlotProps {
  pathway: GSEAResult | null;
  sessionId: string;
  database: GSEADatabase;
  onPathwayUpdated?: (pathway: GSEAResult) => void;
}
```
to:
```typescript
interface GSEAPlotProps {
  pathway: GSEAResult | null;
  sessionId: string;
  database: GSEADatabase;
  comparison?: string;
  onPathwayUpdated?: (pathway: GSEAResult) => void;
}
```

- [ ] **Step 2: Accept in destructuring**

Change line 17 from:
```typescript
export default function GSEAPlot({ pathway, sessionId, database, onPathwayUpdated }: GSEAPlotProps) {
```
to:
```typescript
export default function GSEAPlot({ pathway, sessionId, database, comparison, onPathwayUpdated }: GSEAPlotProps) {
```

- [ ] **Step 3: Pass comparison to API calls**

Change lines 41-42 from:
```typescript
          getGSEAPlotData(sessionId, database, currentPathway.term),
          getGSEAHeatmapData(sessionId, database, currentPathway.term),
```
to:
```typescript
          getGSEAPlotData(sessionId, database, currentPathway.term, comparison),
          getGSEAHeatmapData(sessionId, database, currentPathway.term, comparison),
```

- [ ] **Step 4: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visualization/GSEAPlot.tsx
git commit -m "feat: add comparison prop to GSEAPlot for multi-condition support"
```

---

### Task 17: Final verification — run all tests

**Files:** None (verification only)

- [ ] **Step 1: Run backend unit tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
```
Expected: All tests pass. If any fail, fix them.

- [ ] **Step 2: Run backend integration tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v
```
Expected: All tests pass.

- [ ] **Step 3: Run frontend TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Run frontend linter**

```bash
cd frontend && npm run lint
```
Expected: No new warnings.

- [ ] **Step 5: Run all e2e tests**

```bash
cd Tests && npx playwright test
```
Expected: All tests pass.

- [ ] **Step 6: Commit any test fixes**

```bash
git add -A
git commit -m "chore: fix tests after multi-condition visualization changes"
```

---

## Execution Order

Tasks must run in this order (dependencies):

```
Task 1 (Types cleanup)
  ├─→ Task 8 (API layer fix)
  ├─→ Task 9 (VolcanoPlot)
  ├─→ Task 10 (ProteinTable)
  ├─→ Task 11 (AbundancePlot)
  └─→ Task 12 (QCPlots)

Task 2 (QCData model)
  └─→ Task 3 (QC calculator)

Task 3 (QC calculator)
  └─→ Task 4 (QC step)

Task 4 (QC step) ─┬─→ Task 6 (QC API)
                   └─→ Task 13 (Volcano page)

Task 5 (Pipeline registry) ─→ standalone

Task 6 (QC API) ─→ Task 14 (QC page)

Task 7 (GSEA API) ─→ Task 15 (GSEA page)
Task 9 (VolcanoPlot) ─→ Task 15 (GSEAPlot passes comparison)

Tasks 1-8 complete ─→ Task 13 (Volcano page)
Tasks 1-12 complete ─→ Task 14 (QC page)
Tasks 1-16 complete ─→ Task 17 (Verification)
```

Recommended batch order:
- **Batch 1:** Tasks 1, 2, 5 (independent fundamentals)
- **Batch 2:** Tasks 3, 8 (depend on Batch 1)
- **Batch 3:** Tasks 4, 6, 7, 9, 10, 11, 12, 16 (depend on Batch 2)
- **Batch 4:** Tasks 13, 14, 15 (page-level changes, depend on component changes)
- **Batch 5:** Task 17 (verification)
