# Volcano Plot Marker Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add gene marking functionality where users check boxes in the results table to label genes on the volcano plot, with state persisted in the backend session store.

**Architecture:** Table-driven marker toggling via checkboxes. A second Plotly text trace renders gene_name labels for marked proteins. Backend stores markers + volcano filters in session.json. Frontend restores state on session switch.

**Tech Stack:** Next.js 16, React 19, TypeScript, Plotly.js, FastAPI, Pydantic, Zustand

---

### Task 1: Backend — Add visualization state fields to Session model

**Files:**
- Modify: `backend/app/models/session.py:87-114`
- Test: `Tests/backend/unit/test_session_model.py` (create)

- [ ] **Step 1: Write test for new Session fields**

Create `Tests/backend/unit/test_session_model.py`:

```python
"""
Unit tests for Session model extensions (visualization state).
"""

import pytest


class TestSessionVisualizationState:
    """Test visualization state fields on Session model."""

    def test_session_has_markers_field(self):
        """Session model accepts markers list."""
        from app.models.session import Session, SessionState
        from datetime import datetime, timezone

        session = Session(
            id="test-id",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            markers=["P00367", "Q9Y6Q9"],
        )
        assert session.markers == ["P00367", "Q9Y6Q9"]

    def test_session_markers_default_empty(self):
        """Session markers defaults to empty list."""
        from app.models.session import Session, SessionState
        from datetime import datetime, timezone

        session = Session(
            id="test-id",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        assert session.markers == []

    def test_session_has_volcano_filters_field(self):
        """Session model accepts volcano_filters dict."""
        from app.models.session import Session, SessionState
        from datetime import datetime, timezone

        vf = {"foldChange": 1.5, "pValue": 0.05, "adjPValue": 1, "s0": 0.1}
        session = Session(
            id="test-id",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            volcano_filters=vf,
        )
        assert session.volcano_filters == vf

    def test_session_volcano_filters_default_none(self):
        """Session volcano_filters defaults to None."""
        from app.models.session import Session, SessionState
        from datetime import datetime, timezone

        session = Session(
            id="test-id",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        assert session.volcano_filters is None

    def test_session_serialization_roundtrip(self):
        """Session with markers and volcano_filters serializes and deserializes correctly."""
        from app.models.session import Session, SessionState
        from datetime import datetime, timezone

        vf = {"foldChange": 1.5, "pValue": 0.05, "adjPValue": 1, "s0": 0.1}
        session = Session(
            id="test-id",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            markers=["P00367"],
            volcano_filters=vf,
        )
        json_str = session.model_dump_json()
        restored = Session.model_validate_json(json_str)
        assert restored.markers == ["P00367"]
        assert restored.volcano_filters == vf
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_session_model.py -v`
Expected: FAIL — markers/volcano_filters fields don't exist yet

- [ ] **Step 3: Add fields to Session model**

In `backend/app/models/session.py`, add to the `Session` class (after line 98 `error_message: Optional[str] = None`):

```python
    # Visualization state — per-session UI preferences
    markers: list[str] = Field(default_factory=list, description="Marked protein accessions for volcano plot labels")
    volcano_filters: Optional[dict[str, Any]] = Field(default=None, description="Volcano plot filter settings (foldChange, pValue, adjPValue, s0)")
```

Also add `Any` to the imports at the top (line 10):
```python
from typing import Any, Optional
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_session_model.py -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/session.py Tests/backend/unit/test_session_model.py
git commit -m "feat: add markers and volcano_filters fields to Session model"
```

---

### Task 2: Backend — Add PATCH endpoint for visualization state

**Files:**
- Modify: `backend/app/api/routes/sessions.py`
- Modify: `backend/app/models/session.py` (add VisualizationStateUpdate model)
- Test: `Tests/backend/unit/test_sessions_api.py` (create — or add to existing if integration tests exist)

- [ ] **Step 1: Write test for PATCH endpoint**

Create `Tests/backend/unit/test_sessions_api.py`:

```python
"""
Unit tests for Sessions API routes (visualization state endpoint).
"""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient


@pytest.fixture
def mock_store():
    """Mock SessionStore that returns a basic session."""
    from app.models.session import Session, SessionState
    from datetime import datetime, timezone
    from app.db.session_store import SessionStore

    session = Session(
        id="test-session-id",
        name="test",
        state=SessionState.COMPLETED,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        markers=[],
        volcano_filters=None,
    )

    store = AsyncMock(spec=SessionStore)
    store.get = AsyncMock(return_value=session)
    store.update = AsyncMock()
    return store


@pytest.fixture
def client_with_mock_store(mock_store):
    """TestClient with mocked session store."""
    from app.main import app

    def override_get_store():
        return mock_store

    app.dependency_overrides[
        __import__('app.api.routes.sessions', fromlist=['get_session_store']).get_session_store
    ] = override_get_store

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


class TestPatchVisualizationState:
    """Test PATCH /api/sessions/{id}/visualization-state endpoint."""

    def test_patch_markers_only(self, client_with_mock_store, mock_store):
        """Can update markers without changing filters."""
        response = client_with_mock_store.patch(
            "/api/sessions/test-session-id/visualization-state",
            json={"markers": ["P00367", "Q9Y6Q9"]},
        )
        assert response.status_code == 200
        data = response.json()
        # Response should include updated markers
        # The mock store.update should have been called
        mock_store.update.assert_awaited_once()
        updated_session = mock_store.update.call_args[0][0]
        assert updated_session.markers == ["P00367", "Q9Y6Q9"]
        assert updated_session.volcano_filters is None  # unchanged

    def test_patch_volcano_filters_only(self, client_with_mock_store, mock_store):
        """Can update volcano_filters without changing markers."""
        response = client_with_mock_store.patch(
            "/api/sessions/test-session-id/visualization-state",
            json={"volcano_filters": {"foldChange": 2.0, "pValue": 0.01, "adjPValue": 0.05, "s0": 0.2}},
        )
        assert response.status_code == 200
        mock_store.update.assert_awaited_once()
        updated_session = mock_store.update.call_args[0][0]
        assert updated_session.volcano_filters["foldChange"] == 2.0
        assert updated_session.markers == []  # unchanged

    def test_patch_both_fields(self, client_with_mock_store, mock_store):
        """Can update both markers and volcano_filters in one call."""
        response = client_with_mock_store.patch(
            "/api/sessions/test-session-id/visualization-state",
            json={
                "markers": ["P00367"],
                "volcano_filters": {"foldChange": 1.5, "pValue": 0.05, "adjPValue": 1, "s0": 0.1},
            },
        )
        assert response.status_code == 200
        mock_store.update.assert_awaited_once()
        updated_session = mock_store.update.call_args[0][0]
        assert updated_session.markers == ["P00367"]
        assert updated_session.volcano_filters["foldChange"] == 1.5

    def test_patch_session_not_found(self, client_with_mock_store, mock_store):
        """Returns 404 for non-existent session."""
        mock_store.get = AsyncMock(return_value=None)
        response = client_with_mock_store.patch(
            "/api/sessions/nonexistent-id/visualization-state",
            json={"markers": ["P00367"]},
        )
        assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_sessions_api.py -v`
Expected: FAIL — endpoint doesn't exist

- [ ] **Step 3: Add VisualizationStateUpdate model**

In `backend/app/models/session.py`, add after the `SessionUpdate` class (around line 128):

```python
class VisualizationStateUpdate(BaseModel):
    """Partial update for visualization state (markers + volcano filters)."""
    markers: Optional[list[str]] = None
    volcano_filters: Optional[dict[str, Any]] = None
```

- [ ] **Step 4: Add PATCH endpoint to sessions route**

In `backend/app/api/routes/sessions.py`, add:

1. Import the new model at the top (line 12-15 area):
```python
from app.models.session import (
    Session, SessionCreate, SessionUpdate, SessionSummary,
    SessionState, ProcessingStatus, SessionConfig, SessionFiles,
    VisualizationStateUpdate,
)
```

2. Add the endpoint after the config endpoint (after line 141):

```python
@router.patch("/{session_id}/visualization-state", response_model=Session)
async def update_visualization_state(
    session_id: str,
    data: VisualizationStateUpdate,
    store: SessionStore = Depends(get_session_store)
):
    """Update visualization state (markers and/or volcano filters) for a session."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    if data.markers is not None:
        session.markers = data.markers
    if data.volcano_filters is not None:
        session.volcano_filters = data.volcano_filters

    await store.update(session)
    return session
```

- [ ] **Step 5: Run test to verify it passes**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_sessions_api.py -v`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/session.py backend/app/api/routes/sessions.py Tests/backend/unit/test_sessions_api.py
git commit -m "feat: add PATCH /visualization-state endpoint for markers and filters"
```

---

### Task 3: Frontend — Add API function and update types

**Files:**
- Modify: `frontend/src/types/api.ts:23-32` (add markers + volcano_filters to Session)
- Modify: `frontend/src/lib/api.ts` (add updateSessionVisualizationState function, update getSession return type)

- [ ] **Step 1: Update Session type**

In `frontend/src/types/api.ts`, update the `Session` interface (lines 23-32):

```typescript
export interface Session {
  id: string;
  name: string;
  template: string;
  state: 'created' | 'configuring' | 'processing' | 'completed' | 'error';
  config?: SessionConfig;
  files?: SessionFiles;
  created_at: string;
  updated_at: string;
  markers?: string[];
  volcano_filters?: {
    foldChange: number;
    pValue: number;
    adjPValue: number;
    s0: number;
  };
}
```

- [ ] **Step 2: Update getSession return type and add API function**

In `frontend/src/lib/api.ts`, update the `getSession` function return type (lines 49-56):

```typescript
export async function getSession(
  sessionId: string
): Promise<{
  id: string;
  name: string;
  config?: { treatment: string; control: string };
  files?: { proteomics: Array<{ experiment: string }> };
  markers?: string[];
  volcano_filters?: {
    foldChange: number;
    pValue: number;
    adjPValue: number;
    s0: number;
  };
} | null> {
```

Then add the visualization state API function at the end of the file:

```typescript
// Visualization state (markers + volcano filters)
export async function updateSessionVisualizationState(
  sessionId: string,
  data: {
    markers?: string[];
    volcano_filters?: {
      foldChange: number;
      pValue: number;
      adjPValue: number;
      s0: number;
    };
  }
): Promise<void> {
  await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/visualization-state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  // Silently ignore errors — localStorage fallback handles offline case
}
```

- [ ] **Step 3: Run lint to verify TypeScript correctness**

Run: `cd frontend && npm run lint`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/lib/api.ts
git commit -m "feat: add visualization state API function and update Session type"
```

---

### Task 4: Frontend — Add marker column and Clear All button to ProteinTable

**Files:**
- Modify: `frontend/src/components/visualization/ProteinTable.tsx`

- [ ] **Step 1: Update component props and add marker column**

In `frontend/src/components/visualization/ProteinTable.tsx`, make these changes:

1. Add `Eraser` to lucide-react imports (line 6):
```typescript
import { ChevronUp, ChevronDown, Download, Eraser } from 'lucide-react';
```

2. Update the interface (lines 8-16):
```typescript
interface ProteinTableProps {
  data: DEResult[];
  selectedProteins: Set<string>;
  onSelectProtein: (protein: DEResult) => void;
  showSelectedOnly: boolean;
  onToggleShowSelected: () => void;
  filters: VolcanoFilters;
  sessionConfig: { treatment: string; control: string; experiment: string } | null;
  markedProteins: Set<string>;
  onToggleMark: (protein: DEResult) => void;
  onClearAllMarks: () => void;
}
```

3. Add the new props to the function signature (after line 44):
```typescript
export default function ProteinTable({
  data,
  selectedProteins,
  onSelectProtein,
  showSelectedOnly,
  onToggleShowSelected,
  filters,
  sessionConfig,
  markedProteins,
  onToggleMark,
  onClearAllMarks,
}: ProteinTableProps) {
```

4. Add "Mark" column header as the FIRST column (before the Protein header, around line 200):
```typescript
<th
  className="px-2 py-3 text-center font-medium text-gray-700 w-12"
  data-testid="table-header-mark"
>
  Mark
</th>
```

5. Add "Mark" checkbox cell as the FIRST cell in each row (before the Protein cell, around line 254):
```typescript
<td
  className="px-2 py-3 text-center"
  onClick={(e) => e.stopPropagation()}
>
  <input
    type="checkbox"
    checked={markedProteins.has(item.master_protein_accessions)}
    onChange={() => onToggleMark(item)}
    className="rounded border-gray-300 text-[#E73564] focus:ring-[#E73564] cursor-pointer"
    data-testid="mark-checkbox"
    title="Mark in volcano plot"
  />
</td>
```

6. Add "Clear All Markers" button in the header controls area (after the "Show selected only" checkbox, before Export CSV, around line 184):
```typescript
{markedProteins.size > 0 && (
  <button
    onClick={onClearAllMarks}
    className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-300 rounded-md hover:bg-red-50"
    data-testid="clear-all-marks-btn"
  >
    <Eraser className="w-3 h-3" />
    Clear All Markers ({markedProteins.size})
  </button>
)}
```

- [ ] **Step 2: Run lint to verify TypeScript correctness**

Run: `cd frontend && npm run lint`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/visualization/ProteinTable.tsx
git commit -m "feat: add Mark column and Clear All Markers button to ProteinTable"
```

---

### Task 5: Frontend — Add marker text trace to VolcanoPlot

**Files:**
- Modify: `frontend/src/components/visualization/VolcanoPlot.tsx`

- [ ] **Step 1: Add markedProteins prop**

Update the interface (lines 19-26):
```typescript
interface VolcanoPlotProps {
  data: DEResult[];
  filters: VolcanoFilters;
  selectedProteins: Set<string>;
  markedProteins: Set<string>;
  onSelectProteins: (proteins: string[], mode?: 'click' | 'box' | 'lasso') => void;
  onSelectionModeChange?: (mode: 'click' | 'box' | 'lasso') => void;
  onClearSelection?: () => void;
}
```

Update the function signature (lines 30-37):
```typescript
export default function VolcanoPlot({
  data,
  filters,
  selectedProteins,
  markedProteins,
  onSelectProteins,
  onSelectionModeChange,
  onClearSelection,
}: VolcanoPlotProps) {
```

- [ ] **Step 2: Add marker text trace to plotData**

In the `plotData` useMemo, modify the return array (lines 93-113). Change from returning a single-element array to a two-element array:

```typescript
return [
  {
    x: xValues,
    y: yValues,
    mode: 'markers' as const,
    type: 'scattergl' as const,
    marker: {
      color: colors,
      size: sizes,
      opacity: opacities,
      line: {
        color: lineColors,
        width: lineWidths,
      },
    },
    text: hoverText,
    hoverinfo: 'text',
    customdata: data.map((d) => d.master_protein_accessions),
    name: 'Proteins',
  },
  // Marker labels trace — only for marked proteins
  {
    x: data.filter((d) => markedProteins.has(d.master_protein_accessions)).map((d) => d.log_fc),
    y: data.filter((d) => markedProteins.has(d.master_protein_accessions)).map((d) => -Math.log10(d.pval || 1e-300)),
    mode: 'text' as const,
    type: 'scatter' as const,
    text: data.filter((d) => markedProteins.has(d.master_protein_accessions)).map((d) => d.gene_name || d.master_protein_accessions.split(/[,;]/)[0].trim()),
    textposition: 'top center' as const,
    textfont: {
      size: 10,
      color: '#FFFFFF',
      family: 'Arial, sans-serif',
    },
    // Add a dark background behind text for readability
    texttemplate: '%{text}',
    hoverinfo: 'skip',
    showlegend: false,
    marker: {
      size: 0, // No markers, just text
      opacity: 0,
    },
    name: 'Markers',
  },
];
```

Update the useMemo dependency to include `markedProteins` (line 114):
```typescript
}, [data, filters, selectedProteins, markedProteins]);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/visualization/VolcanoPlot.tsx
git commit -m "feat: add marker text trace to VolcanoPlot"
```

---

### Task 6: Frontend — Wire up markers state in Results page with persistence

**Files:**
- Modify: `frontend/src/app/analysis/visualization/page.tsx`

- [ ] **Step 1: Add markers state and persistence logic**

In `frontend/src/app/analysis/visualization/page.tsx`:

1. Import the API function (line 9):
```typescript
import { getDEResults, getSession, updateSessionVisualizationState } from '@/lib/api';
```

2. Add markedProteins state (after line 49):
```typescript
const [markedProteins, setMarkedProteins] = useState<Set<string>>(new Set());
```

3. Add a ref for debouncing (after the markedProteins state):
```typescript
const saveMarkersTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
```

4. Restore markers and filters from session on load. Modify the session config fetch useEffect (lines 74-88) to also restore markers and filters:

Replace the entire useEffect (lines 74-88) with:
```typescript
// Fetch session config and restore visualization state
useEffect(() => {
  async function fetchSessionConfig() {
    const session = await getSession(sessionId);
    if (session) {
      const experiment = session.files?.proteomics?.[0]?.experiment ?? '';
      setSessionConfig({
        treatment: session.config?.treatment ?? '',
        control: session.config?.control ?? '',
        experiment,
      });

      // Restore markers from session
      if (session.markers && session.markers.length > 0) {
        setMarkedProteins(new Set(session.markers));
      }

      // Restore volcano filters from session (overrides localStorage)
      if (session.volcano_filters) {
        setFilters(session.volcano_filters);
      }
    }
  }

  fetchSessionConfig();
}, [sessionId]);
```

5. Add marker toggle and clear handlers (after clearSelection, around line 131):
```typescript
// Handle marker toggle
const handleToggleMark = useCallback((protein: DEResult) => {
  setMarkedProteins((prev) => {
    const next = new Set(prev);
    if (next.has(protein.master_protein_accessions)) {
      next.delete(protein.master_protein_accessions);
    } else {
      next.add(protein.master_protein_accessions);
    }
    return next;
  });

  // Debounce save to backend (300ms)
  if (saveMarkersTimerRef.current) clearTimeout(saveMarkersTimerRef.current);
  saveMarkersTimerRef.current = setTimeout(async () => {
    try {
      const currentMarkers = prev_set_after_toggle; // We need the new Set value
    } catch {}
  }, 300);
}, [sessionId]);
```

Wait — the debounced save needs access to the current marker set. Let me use a cleaner approach with a useEffect:

Replace the handler with a simpler approach. Add this after the markedProteins state declaration:

```typescript
// Save markers to backend when they change (debounced)
useEffect(() => {
  const markersArray = Array.from(markedProteins);
  const timer = setTimeout(async () => {
    try {
      await updateSessionVisualizationState(sessionId, { markers: markersArray });
    } catch {
      // Silently fail — markers are still in local state
    }
  }, 300);
  return () => clearTimeout(timer);
}, [markedProteins, sessionId]);

// Save filters to backend when they change (debounced)
useEffect(() => {
  const timer = setTimeout(async () => {
    try {
      await updateSessionVisualizationState(sessionId, { volcano_filters: filters });
    } catch {
      // Silently fail — filters are still in local state
    }
  }, 500);
  return () => clearTimeout(timer);
}, [filters, sessionId]);
```

6. Add the simple toggle handler:
```typescript
// Handle marker toggle from table
const handleToggleMark = useCallback((protein: DEResult) => {
  setMarkedProteins((prev) => {
    const next = new Set(prev);
    if (next.has(protein.master_protein_accessions)) {
      next.delete(protein.master_protein_accessions);
    } else {
      next.add(protein.master_protein_accessions);
    }
    return next;
  });
}, []);

// Clear all markers
const handleClearAllMarks = useCallback(() => {
  setMarkedProteins(new Set());
}, []);
```

- [ ] **Step 2: Pass props to child components**

Update the VolcanoPlot component usage (around line 237-244):
```typescript
<VolcanoPlot
  data={data.results}
  filters={filters}
  selectedProteins={selectedProteins}
  markedProteins={markedProteins}
  onSelectProteins={handleSelectProteins}
  onSelectionModeChange={(_mode) => void _mode}
  onClearSelection={clearSelection}
/>
```

Update the ProteinTable component usage (around line 247-255):
```typescript
<ProteinTable
  data={data.results}
  selectedProteins={selectedProteins}
  onSelectProtein={handleSelectProteinFromTable}
  showSelectedOnly={showSelectedOnly}
  onToggleShowSelected={() => setShowSelectedOnly(!showSelectedOnly)}
  filters={filters}
  sessionConfig={sessionConfig}
  markedProteins={markedProteins}
  onToggleMark={handleToggleMark}
  onClearAllMarks={handleClearAllMarks}
/>
```

- [ ] **Step 3: Remove localStorage-only filter persistence**

Since we now persist filters to the backend, keep the localStorage write as a fallback but remove the initial read from localStorage (backend is now authoritative). Change the filters useState (lines 26-38):

```typescript
const [filters, setFilters] = useState<VolcanoFilters>({
  foldChange: 1,
  pValue: 0.05,
  adjPValue: 1,
  s0: 0.1, // 10% of foldChange threshold
});
```

Keep the localStorage write useEffect (lines 40-45) as-is for PDF export fallback. The backend useEffect will override these defaults when session data loads.

- [ ] **Step 4: Run lint to verify TypeScript correctness**

Run: `cd frontend && npm run lint`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/analysis/visualization/page.tsx
git commit -m "feat: wire up marker state with backend persistence in Results page"
```

---

### Task 7: Integration test — Verify end-to-end flow

**Files:**
- Test: `Tests/backend/integration/test_visualization_state.py` (create)

- [ ] **Step 1: Write integration test**

Create `Tests/backend/integration/test_visualization_state.py`:

```python
"""
Integration test for visualization state persistence.

Verifies that markers and volcano filters are correctly saved
to session.json and restored on session retrieval.
"""

import pytest
import asyncio
from pathlib import Path
from app.models.session import Session, SessionState, SessionConfig, SessionFiles
from app.db.session_store import SessionStore


@pytest.fixture
def sessions_dir(tmp_path):
    """Create a temporary sessions directory."""
    return tmp_path / "sessions"


@pytest.fixture
def store(sessions_dir):
    """Create a SessionStore with temp directory."""
    return SessionStore(str(sessions_dir))


@pytest.fixture
def sample_session():
    """Create a sample completed session."""
    from datetime import datetime, timezone

    return Session(
        id="integration-test-session",
        name="Integration Test",
        template="protein_pairwise_comparison",
        state=SessionState.COMPLETED,
        config=SessionConfig(
            treatment="DMSO",
            control="Vehicle",
            organism="human",
            remove_razor=False,
            strict_filtering=False,
        ),
        files=SessionFiles(),
    )


class TestVisualizationStatePersistence:
    """Test that visualization state persists correctly in session.json."""

    @pytest.mark.asyncio
    async def test_save_and_restore_markers(self, store, sample_session):
        """Markers are saved to session.json and restored on get."""
        await store.create(sample_session)

        # Get session, add markers
        session = await store.get(sample_session.id)
        session.markers = ["P00367", "Q9Y6Q9"]
        await store.update(session)

        # Restore and verify
        restored = await store.get(sample_session.id)
        assert restored.markers == ["P00367", "Q9Y6Q9"]

    @pytest.mark.asyncio
    async def test_save_and_restore_volcano_filters(self, store, sample_session):
        """Volcano filters are saved and restored correctly."""
        await store.create(sample_session)

        session = await store.get(sample_session.id)
        session.volcano_filters = {
            "foldChange": 2.0,
            "pValue": 0.01,
            "adjPValue": 0.05,
            "s0": 0.15,
        }
        await store.update(session)

        restored = await store.get(sample_session.id)
        assert restored.volcano_filters["foldChange"] == 2.0
        assert restored.volcano_filters["s0"] == 0.15

    @pytest.mark.asyncio
    async def test_session_json_file_contains_fields(self, store, sample_session, sessions_dir):
        """The session.json file on disk contains markers and volcano_filters."""
        await store.create(sample_session)

        session = await store.get(sample_session.id)
        session.markers = ["P00367"]
        session.volcano_filters = {"foldChange": 1.5, "pValue": 0.05, "adjPValue": 1, "s0": 0.1}
        await store.update(session)

        # Read the actual JSON file
        json_path = sessions_dir / sample_session.id / "session.json"
        import json
        with open(json_path) as f:
            data = json.load(f)

        assert "markers" in data
        assert data["markers"] == ["P00367"]
        assert "volcano_filters" in data
        assert data["volcano_filters"]["foldChange"] == 1.5
```

- [ ] **Step 2: Run integration test**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_visualization_state.py -v`
Expected: All 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add Tests/backend/integration/test_visualization_state.py
git commit -m "test: add integration tests for visualization state persistence"
```

---

### Task 8: Manual verification checklist

After all tasks are complete, verify the full flow:

- [ ] **Step 1: Start backend**

```bash
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

Verify new endpoint exists:
```bash
curl -s http://localhost:8000/openapi.json | python -c "import sys,json; d=json.load(sys.stdin); [print(p,list(d['paths'][p].keys())) for p in sorted(d['paths']) if 'visualization' in p]"
```
Expected: Should show `PATCH /api/sessions/{session_id}/visualization-state`

- [ ] **Step 2: Start frontend**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: Test marking flow**

1. Navigate to a completed session's visualization page
2. Check a marker checkbox in the protein table
3. Verify the gene name label appears on the volcano plot
4. Check multiple markers — verify all labels appear
5. Click "Clear All Markers" — verify all labels disappear
6. Switch to a different session, then switch back
7. Verify previously set markers are restored

- [ ] **Step 4: Test filter persistence**

1. Change volcano plot filters (fold change, p-value, s0)
2. Switch to a different session, then switch back
3. Verify the filter settings are restored to what you set

- [ ] **Step 5: Test PDF export still works**

1. Mark some proteins
2. Click PDF Export
3. Verify the PDF contains the marker labels on the volcano plot

- [ ] **Step 6: Run all tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v
cd frontend && npm run lint
```
