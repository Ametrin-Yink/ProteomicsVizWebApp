# 02 - Absolute Red Lines (NEVER VIOLATE)

**⚠️ CRITICAL: These rules are NON-NEGOTIABLE**

Violating any of these will cause system failure, data corruption, or invalid results.

---

## R Integration (CRITICAL)

### NEVER SKIP R Package Installation

**REQUIRED Bioconductor packages:**
- `msqrob2` v1.12.0
- `QFeatures` v1.1.2+
- `limma`

**Verification Command:**
```bash
Rscript -e "library(msqrob2); library(QFeatures); library(limma); cat('OK\n')"
```

**Why:** These packages are required for Steps 6-7 (protein abundance and differential expression). Without them, the entire analysis pipeline fails.

### NEVER USE rpy2

**ALWAYS use subprocess method:**
```python
# CORRECT ✅
result = subprocess.run(
    ['Rscript', 'scripts/msqrob2_protein.R', input_file, output_file],
    capture_output=True,
    text=True,
    encoding='utf-8'
)

# WRONG ❌
import rpy2.robjects as ro
# rpy2 causes stability issues
```

**Why:** rpy2 has memory leaks and stability issues with complex Bioconductor packages.

### ALWAYS Handle Encoding

**UTF-8 with latin-1 fallback:**
```python
result = subprocess.run(..., encoding='utf-8')
if result.returncode != 0:
    try:
        error_msg = result.stderr
    except UnicodeDecodeError:
        error_msg = result.stderr.encode('latin-1').decode('utf-8', errors='replace')
```

**Why:** R can output non-UTF-8 characters that crash Python string handling.

---

## File Patterns (IMMUTABLE)

### Peptide Filename Pattern

**Format:** `PSM_ExperimentName_Condition_ReplicateNumber.csv`

**Example:** `PSM_SampleData_DMSO_1.csv`
- Experiment: `SampleData`
- Condition: `DMSO`
- Replicate: `1`

**Why:** R scripts parse filenames to extract metadata. Changing this breaks the entire pipeline.

### Abundance Column Naming

**Format:** `Abundance F{code} Sample`

**Examples:**
- `Abundance F49 Sample`
- `Abundance F18 Sample`

**Why:** R scripts search for columns matching this exact pattern. Different files have different F-codes based on TMT channel.

### Minimum Replicates

**Minimum: 3 replicates per condition**

**Validation Error:** "At least 3 replicates per condition required!"

**Why:** Statistical validity requires minimum 3 replicates for reliable differential expression analysis.

---

## TypeScript (STRICT MODE)

### MUST Have strict: true

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    // ... other options
  }
}
```

**Why:** Type safety prevents runtime errors and enables better IDE support.

### NEVER Use as any or @ts-ignore

```typescript
// WRONG ❌
const data = response.data as any;

// WRONG ❌
// @ts-ignore
const value = obj.property;

// CORRECT ✅
const data: DiffExpressionResult = response.data;

// CORRECT ✅
if ('property' in obj) {
  const value = obj.property;
}
```

**Why:** These suppressions hide bugs and break type safety guarantees.

---

## State Management (Zustand)

### NEVER Mutate State Directly

```typescript
// WRONG ❌
const state = useSessionStore.getState();
state.session.name = 'New Name';  // Forbidden!

// CORRECT ✅
const updateSession = useSessionStore((state) => state.updateSession);
updateSession({ name: 'New Name' });
```

**Why:** Direct mutation breaks Zustand's change detection and React reactivity.

### ALWAYS Use Actions

```typescript
// stores/sessionStore.ts
export const useSessionStore = create<SessionState>((set, get) => ({
  // State
  sessions: [],
  currentSession: null,
  
  // Actions only
  setSessions: (sessions) => set({ sessions }),
  updateSession: (id, updates) => {
    const { sessions } = get();
    const updated = sessions.map(s => 
      s.id === id ? { ...s, ...updates } : s
    );
    set({ sessions: updated });
  },
}));
```

---

## Python Async I/O

### NEVER Use Blocking I/O in Async Functions

```python
# WRONG ❌
async def process_file(file_path: Path):
    content = open(file_path).read()  # Blocking!
    return content

# CORRECT ✅
async def process_file(file_path: Path):
    content = await asyncio.to_thread(read_file, file_path)
    return content

# CORRECT ✅
async def process_file(file_path: Path):
    loop = asyncio.get_event_loop()
    content = await loop.run_in_executor(None, read_file, file_path)
    return content
```

**Why:** Blocking I/O blocks the entire event loop, freezing the server.

### ALWAYS Use asyncio.to_thread()

For any blocking operation:
- File I/O
- Database queries (if not async)
- External API calls (if not async)
- Subprocess calls

---

## File Upload

### Maximum File Size: 500MB

```python
# backend/app/core/config.py
MAX_UPLOAD_SIZE = 500 * 1024 * 1024  # 500MB
```

**Why:** Prevents memory exhaustion and DoS attacks.

### ALWAYS Validate CSV Columns

**Required columns:**
1. `Sequence`
2. `Modifications`
3. `Charge`
4. `Contaminant`
5. `Master Protein Accessions`
6. `Quan Info`
7. `Abundance F{code} Sample` (dynamic)

**Why:** Missing columns cause R script failures.

---

## Data Format

### ALWAYS Use TSV Internally

```
User Upload: CSV
      ↓
Internal: Convert to TSV
      ↓
R Processing: TSV
      ↓
Output Download: CSV
```

**Why:** TSV handles special characters better than CSV (commas in data).

### ALWAYS Transform Column-Based to Row-Based

**R outputs column-based:**
```json
{
  "samples": ["A", "B"],
  "pc1": [1.0, 2.0],
  "pc2": [0.5, 1.5]
}
```

**Frontend needs row-based:**
```typescript
const transformed = samples.map((sample, i) => ({
  sample,
  pc1: pc1Values[i] || 0,
  pc2: pc2Values[i] || 0,
  condition: conditions[i] || 'Unknown',
}));
```

**Why:** Plotly and React components expect row-based data.

---

## Session Management

### ALWAYS Clean Up Session Directories

```python
# When user deletes session
def delete_session(session_id: str):
    session_path = SESSIONS_DIR / session_id
    if session_path.exists():
        shutil.rmtree(session_path)  # Delete entire directory
```

**Why:** Prevents disk space exhaustion from orphaned session data.

---

## External APIs

### ALWAYS Implement Biomart Fallback

```python
def _uniprot_to_gene_symbol(self, uniprot_ids: List[str]) -> Dict[str, str]:
    try:
        result = gseapy.biomart(
            name='uniprot_gn',
            attrs=['uniprot_gn', 'external_gene_name'],
            filters={'uniprot_gn': uniprot_ids[:1000]}
        )
        if result is not None and len(result) > 0:
            return dict(zip(result['uniprot_gn'], result['external_gene_name']))
    except Exception as e:
        logger.warning(f"Biomart failed: {e}")
    
    # Fallback: return UniProt IDs as-is
    return {uid: uid for uid in uniprot_ids}
```

**Why:** Biomart requires internet and can fail silently.

---

## Testing

### NEVER Mock Data in Production

**Remove all MOCK_* constants before claiming completion:**
```typescript
// Remove before production!
const MOCK_DATA = [...];
```

### ALWAYS Verify with Real Data

- Screenshots must show real data, not mock data
- All plots must display actual results
- Empty plots indicate data flow issues

---

## API Design

### NEVER Change Endpoint URLs Without Frontend Sync

**Keep frontend and backend in sync:**
```typescript
// frontend/src/lib/api.ts
const API_BASE = '/api/v1';  // Version your API

// CORRECT ✅
getQCData: (sessionId: string) => 
  api.get(`/sessions/${sessionId}/qc/plots`),

// WRONG ❌
getQCData: (sessionId: string) => 
  api.get(`/qc/data`),  // Mismatch with backend!
```

### ALWAYS Make API Response Fields Optional

```typescript
// CORRECT ✅
interface QCData {
  pca?: PCAPoint[];      // Optional
  pvalueDist?: PValueBin[];
  // ...
}

// WRONG ❌
interface QCData {
  pca: PCAPoint[];       // Required - breaks if missing
  pvalueDist: PValueBin[];
}
```

**Why:** Maintains backward compatibility when adding new fields.

---

## Summary Table

| Category | Rule | Violation Consequence |
|----------|------|----------------------|
| R Integration | Never skip msqrob2/QFeatures/limma | Pipeline failure |
| R Integration | Never use rpy2 | Stability issues, crashes |
| Files | Never modify filename pattern | Parsing errors |
| Files | Never change abundance column format | R script failure |
| TypeScript | Never remove strict: true | Type errors, bugs |
| TypeScript | Never use as any/@ts-ignore | Hidden bugs |
| State | Never mutate Zustand directly | Reactivity breaks |
| Python | Never blocking I/O in async | Server freezes |
| Upload | Never allow files > 500MB | Memory exhaustion |
| Testing | Never mock data in production | False confidence |
| API | Never change endpoints without sync | 404 errors |

---

## Next Steps

See [03-coding-standards.md](03-coding-standards.md) for detailed coding conventions.
