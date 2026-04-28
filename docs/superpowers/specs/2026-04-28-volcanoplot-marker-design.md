# Volcano Plot Marker Feature Design

## Context
Users need to mark specific genes/proteins on the volcano plot for emphasis and comparison. Currently, the only visual feedback is selection (black ring + larger size). Users want persistent labels on the plot, controlled from the data table, with state surviving session switching.

## Decisions Made
1. **Interaction**: Marking controlled only from table checkboxes (no plot interaction needed)
2. **Persistence**: Backend session store (markers saved to session JSON)
3. **Label rendering**: Plotly text trace (`mode: 'text'`) with dark background for readability

## Architecture

### Data Flow
```
Table checkbox toggled → PATCH /api/sessions/{id}/markers → session.json updated
                                                              ↓
VolcanoPlot receives markedProteins Set → text trace renders gene_name labels
```

### Components

#### 1. ProteinTable (`ProteinTable.tsx`)
- Add a new column "Mark" as the first column (before Protein)
- Each row has a checkbox — checked if the protein's `master_protein_accessions` is in `markedProteins`
- Add a "Clear All Markers" button above the table header, visible when at least 1 marker exists
- New props: `markedProteins: Set<string>`, `onToggleMark: (protein: DEResult) => void`, `onClearAllMarks: () => void`

#### 2. VolcanoPlot (`VolcanoPlot.tsx`)
- Add a second scatter trace with `mode: 'text'` that renders gene_name labels for all proteins in `markedProteins`
- Text trace config: `textposition: 'top center'`, dark semi-transparent background via `textfont.color: '#fff'` with a subtle `bgcolor` on the text
- Size: 10px, bold font
- New prop: `markedProteins: Set<string>`

#### 3. Results Page (`page.tsx`)
- Add `markedProteins: Set<string>` state
- On session load, fetch markers from session config and initialize state
- On checkbox toggle, call API to save immediately (debounced to avoid excessive calls)
- Pass markedProteins + callbacks to ProteinTable and VolcanoPlot

#### 4. Backend API
- **PATCH `/api/sessions/{id}/visualization-state`**
  - Body: `{ markers: ["P00367", ...], volcano_filters: { foldChange, pValue, adjPValue, s0 } }`
  - Saves both fields to `sessions/{session_id}/session.json`
  - Both fields are optional in the body — caller can update just markers or just filters
- **GET `/api/sessions/{session_id}`** already returns the full `Session` model — the new fields will be included automatically

#### 5. Backend Session Model (`SessionConfig` or new sub-model)
- Add `volcano_filters: Optional[dict]` and `markers: list[str] = []` to the `Session` model (not `SessionConfig`, since these are visualization-level settings, not pipeline config)

### State Persistence
- Both markers and volcano filters stored in `sessions/{session_id}/session.json`
- When user switches sessions, the visualization page fetches session data and restores both filters and markers
- On filter change or marker toggle, API call saves immediately (markers debounced at ~300ms to avoid excessive calls on rapid clicking)
- localStorage fallback: if backend call fails, still use localStorage so the UI doesn't break

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/components/visualization/VolcanoPlot.tsx` | Add text trace for marked proteins |
| `frontend/src/components/visualization/ProteinTable.tsx` | Add Mark column, Clear All button |
| `frontend/src/app/analysis/visualization/page.tsx` | Add markers state, API integration, restore on load |
| `backend/app/models/session.py` | Add `volcano_filters` and `markers` fields to Session model |
| `backend/app/api/routes/sessions.py` | Add PATCH /{id}/visualization-state endpoint |
| `frontend/src/types/api.ts` | Add markers + volcano_filters to Session type |
| `frontend/src/lib/api.ts` | Add `updateSessionVisualizationState()` function |