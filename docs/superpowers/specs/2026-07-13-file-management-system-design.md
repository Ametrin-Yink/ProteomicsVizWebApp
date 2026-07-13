# File Management System — Design Spec

**Date:** 2026-07-13
**Status:** Approved
**Author:** User & Claude

---

## 1. Overview

Add a global file library to ProteomicsVizWebApp, replacing per-session drag-and-drop uploads with a centralized file explorer. Users manage files once in the library, then select from it when creating analyses. The library is a folder on disk indexed by DuckDB, supporting 20,000+ files at scale.

### Motivation

- **Current:** Files are uploaded per-session via drag-and-drop in the wizard. No reuse across sessions. No way to organize files outside of session directories.
- **Target:** A "Files" tab in the top navigation opens a full file explorer. Users create folders, upload, rename, move, delete. In the pipeline wizard, users select files from the library instead of uploading. Metadata pages can load CSV templates from the library.

---

## 2. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Global file library** — shared across all sessions | Single source of truth, files uploaded once |
| 2 | **Copy to session** — files copied into `sessions/{id}/uploads/` when selected | Session owns a snapshot; library changes don't break analyses; Retry always works |
| 3 | **Raw files kept until session deletion** | Enables Retry and re-analysis; disk is cheap |
| 4 | **Configurable path** — `FILE_LIBRARY_DIR` in `.env`, default `backend/file_library/` | Flexibility for large data drives |
| 5 | **FASTA stays separate** — PTM wizard only, not in the library | Reference data, not PSM data; mixing creates confusion |
| 6 | **Standard CSV metadata** — same format as current import/export | No new format to learn; backward compatible |
| 7 | **Full hierarchy folders** — arbitrary nesting | Matches real project organization needs |
| 8 | **Replace drag-and-drop** — wizard shows a file picker from the library | Clean separation: manage files in Files page, pick them in wizard |
| 9 | **Manager only** — no file preview | Lighter build; name/size/type/date is sufficient |
| 10 | **Session-first flow** — Home → create session → wizard → pick files from library | Minimal change to existing wizard flow |
| 11 | **DuckDB-backed index** — handles 20K+ files | JSON doesn't scale to this volume; DuckDB is already in the stack |
| 12 | **Scan on page load** — sync DuckDB index from filesystem on every Files page visit | Files may be dropped directly into the folder via Windows Explorer |

---

## 3. Backend Design

### 3.1 Storage Layout

```
{FILE_LIBRARY_DIR}/                     # .env: FILE_LIBRARY_DIR, default backend/file_library/
├── .library_index.duckdb               # DuckDB metadata index
├── DIA_Experiments/                    # Example: user-created folder
│   ├── 2025_Q1/
│   │   ├── sample_01.txt
│   │   └── sample_02.txt
│   └── 2025_Q2/
│       └── ...
├── TMT_Experiments/
│   └── ...
└── Metadata_Tables/
    └── dia_metadata_template.csv
```

### 3.2 Configuration

New field in `Settings` (`backend/app/core/config.py`):

```python
file_library_dir: Path = Field(
    default=Path(__file__).resolve().parent.parent.parent / "file_library",
    description="Directory for the global file library",
)
```

Also add to `ensure_directories()`.

### 3.3 DuckDB Index Schema

```sql
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,         -- relative to library root, normalized forward slashes
    name TEXT NOT NULL,
    size BIGINT NOT NULL DEFAULT 0,
    file_type TEXT NOT NULL,           -- 'txt', 'csv', 'folder'
    modified_at TIMESTAMP NOT NULL,
    parent_path TEXT NOT NULL,
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_parent ON files(parent_path);
CREATE INDEX IF NOT EXISTS idx_name ON files(name);
CREATE INDEX IF NOT EXISTS idx_type ON files(file_type);
```

### 3.4 DuckDB Index Service

New file: `backend/app/services/file_index_service.py`

```python
class FileIndexService:
    """Manages the DuckDB index of the file library."""

    def __init__(self, library_dir: Path):
        self.library_dir = library_dir
        self.db_path = library_dir / ".library_index.duckdb"
        self._ensure_schema()  # CREATE TABLE IF NOT EXISTS on first use

    def scan_and_sync(self) -> ScanResult:
        """Walk the filesystem, diff against DuckDB, return changes."""
        # 1. os.walk(library_dir), skip .library_index.duckdb
        # 2. Query DuckDB for all known paths
        # 3. New files: INSERT. Changed (mtime/size): UPDATE. Deleted: DELETE.
        # 4. Return ScanResult(files_added, files_removed, files_updated, total)
        # First call populates the index from scratch if .duckdb is empty/new.

    def list_directory(self, path: str) -> list[FileEntry]:
        """SELECT * FROM files WHERE parent_path = ? ORDER BY file_type, name"""

    def search(self, query: str) -> list[FileEntry]:
        """SELECT * FROM files WHERE name LIKE ? ESCAPE '\' """

    def get_entry(self, path: str) -> FileEntry | None:
        """SELECT * FROM files WHERE path = ?"""

    def insert_entry(self, path: str, size: int, file_type: str, modified_at: datetime):
        """INSERT INTO files ..."""

    def update_entry(self, path: str, new_path: str, new_parent: str, size: int, modified_at: datetime):
        """UPDATE files SET ... WHERE path = ?"""

    def delete_entry(self, path: str):
        """DELETE FROM files WHERE path = ? (prefix match with / for folders)"""

    def count(self) -> int:
        """SELECT COUNT(*) FROM files WHERE file_type != 'folder'"""
```

### 3.5 API Routes

New router: `backend/app/api/routes/files.py`, mounted at `/api/files` in `main.py`.

| Method | Endpoint | Request Body | Response | Purpose |
|--------|----------|-------------|----------|---------|
| `GET` | `/tree?path=/` | — | `{path, entries: [{name, type, size, modified_at}]}` | List directory |
| `POST` | `/folders` | `{parent_path, name}` | `{path, name}` | Create folder |
| `POST` | `/upload` | multipart: `files`, `target_path` | `{files: [{name, size, type}]}` | Upload files |
| `PUT` | `/rename` | `{path, new_name}` | `{path, new_name}` | Rename file/folder |
| `PUT` | `/move` | `{source_path, target_parent}` | `{path, new_parent}` | Move file/folder |
| `DELETE` | `/delete` | `{path}` | `{deleted: path}` | Delete file/folder |
| `POST` | `/scan` | — | `{total, added, removed, updated}` | Force re-scan |
| `GET` | `/search?q=term` | — | `{results: [{name, path, type, size}]}` | Search by name |
| `POST` | `/select` | `{session_id, paths: [...]}` | `{files: [{filename, size, columns, file_type, tmt_channels?}]}` | Copy files to session, parse, return metadata |

### 3.6 File Operations Detail

**Create Folder:**
1. Validate `name` against pattern `[a-zA-Z0-9_\- .]+`
2. `os.mkdir(library_dir / parent_path / name)`
3. `index.insert_entry(path, 0, 'folder', datetime.now())`

**Upload:**
1. For each file in multipart: validate extension (`.txt`, `.csv` only), validate size (< 500MB), validate not empty
2. `aiofiles.write(file_path)`
3. `index.insert_entry(path, size, ext, mtime)`

**Rename:**
1. Validate `new_name` against pattern
2. `os.rename(old_path, new_path)`
3. If folder: `index.update_entry` for all children (UPDATE paths with prefix replace)
4. If file: `index.update_entry` for the single entry

**Move:**
1. Validate target is not a descendant of source
2. `shutil.move(source, target)`
3. `asyncio.to_thread` for large moves
4. Update index for all moved entries

**Delete:**
1. If folder: `shutil.rmtree()`, cascade-delete from index (DELETE WHERE path LIKE 'prefix%')
2. If file: `os.unlink()`, delete from index

**Copy to Session (`/select`):**
1. Load session, create `sessions/{id}/uploads/` if needed
2. For each path: `shutil.copy2(library_path, session_upload_path)`
3. Run `parse_proteomics_file()` in thread to validate and get columns/channels
4. Build `ProteomicsFileInfo`, append to `session.files.proteomics`
5. Save session
6. Return file metadata list

### 3.7 Scan & Sync Strategy

**When scans happen:**

| Trigger | Behavior |
|---------|----------|
| Files page first loads | Frontend calls `POST /scan` (full sync), then `GET /tree` (read from index) |
| User clicks Refresh | Frontend calls `POST /scan` (full sync), then `GET /tree` |
| After any mutation (upload/rename/move/delete) | Index updated directly in the same request — no scan needed |
| Navigating subfolders (`GET /tree`) | Read from index directly — no scan. Very fast. |

**Full scan logic (`POST /scan`):**

```
os.walk(library_dir), skip .library_index.duckdb
  ├── Collect all paths with mtime/size
  ├── Query DuckDB for all known rows
  ├── Diff: new → INSERT, changed → UPDATE, deleted → DELETE
  └── Return ScanResult(total, added, removed, updated)
```

For 20K files on SSD: ~1–2 seconds. UI shows a spinner/skeleton during scan.

**`GET /tree`** reads directly from the index: `SELECT * FROM files WHERE parent_path = ?`. Sub-millisecond.

### 3.8 Security

- All paths normalized to forward slashes relative to library root
- Path traversal prevention: reject paths containing `..`, validate all paths resolve inside `FILE_LIBRARY_DIR`
- File name sanitization: reuse existing `sanitize_filename()` from `file_parser.py`
- Only `.txt` and `.csv` accepted for upload; only folders, `.txt`, `.csv` displayed

---

## 4. Frontend Design

### 4.1 Navigation Change

Add "Files" to `TopNavigation.tsx`:

```typescript
const navLinks = [
  { href: '/', label: 'Home', id: 'home' },
  { href: '/files', label: 'Files', id: 'files' },   // NEW
  { href: '/reports', label: 'Reports', id: 'reports' },
  { href: '/about', label: 'About', id: 'about' },
];
```

### 4.2 New Page: `/files`

**Route:** `frontend/src/app/files/page.tsx`

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│  Toolbar: [New Folder] [Upload] [Delete] [Rename] [🔍 Search...] [🔄 Refresh]  │
├────────────────────┬─────────────────────────────────────┤
│  Folder Tree       │  File List                          │
│  (~30% width)      │  (~70% width)                       │
│                    │                                     │
│  Collapsible tree  │  Table: ☐ | Name | Size | Modified  │
│  with hierarchy    │  Sortable columns                   │
│  Context menu      │  Breadcrumb nav                     │
│                    │  Context menu                       │
├────────────────────┴─────────────────────────────────────┤
│  Status: 12,847 files · 3.2 GB · Last scan: 2 min ago    │
└──────────────────────────────────────────────────────────┘
```

**Components:**
- `FileLibraryToolbar` — action buttons, search input, refresh
- `FolderTree` — recursive collapsible tree, drop target for moves, context menu
- `FileList` — sortable table, multi-select checkboxes, breadcrumbs, drop target for uploads, context menu
- `ContextMenu` — Open, Rename, Move..., Delete, Copy Path, Properties

**Interactions:**
- Click folder in tree → loads contents in file list
- Drag files from desktop → uploads to current folder (`.txt`/`.csv` only)
- Drag within tree → moves file/folder
- Right-click → context menu
- Search → filters file list by name substring as-you-type (calls `GET /search?q=`)
- Refresh → calls `POST /scan`, updates status bar
- Multi-select → shift-click range, ctrl-click toggle; enabled bulk Delete

**Loading State:** Skeleton table rows during initial scan. Status bar shows "Indexing..."

**Empty State:** Icon + "Your file library is empty" + instructions for uploading or dropping files directly.

### 4.3 New Component: `FileLibraryPicker`

Modal version of the file explorer for selecting files within the wizard.

**Props:** `sessionId`, `fileType` ('tmt' | 'dia' | 'csv-only'), `onSelect(files)`, `onClose`

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│  Select Files for Analysis                          [✕ Close] │
│  ─────────────────────────────────────────────────────────── │
│  Filter: [All files ▾]  [🔍 Search...]                       │
│  ─────────────────────────────┬──────────────────────────────│
│  Folder Tree                  │  File List (with checkboxes)  │
│                               │  ☑ sample_01.txt   2.3 MB    │
│                               │  ☑ sample_02.txt   2.1 MB    │
│                               │  ☐ sample_03.txt   1.8 MB    │
│  ─────────────────────────────┴──────────────────────────────│
│  [Select All]  [Clear Selection]                              │
│  Selected: 2 files · 4.4 MB                                   │
│                                          [Cancel]  [✓ Select] │
└──────────────────────────────────────────────────────────────┘
```

**Behavior:**
- Same folder tree + file list as Files page, with checkboxes
- Dropdown filter: "All files", "CSV only", "TXT only"
- Search narrows tree to matching folders
- **Select All** — checks every visible file in filtered results
- **Clear Selection** — unchecks every visible file
- Selections persist across folder navigation (global selection set)
- "Select" button disabled until ≥ 1 file chosen
- On confirm → calls `POST /api/files/select` → copies files to session → calls `onSelect`
- Copy progress shown with a spinner and "Copying N of M..."

### 4.4 Modified Wizard — Upload Step

**File:** `frontend/src/app/new/upload/page.tsx`

**Changes:**
- Remove `FileUploadZone` component usage for TMT/DIA
- Replace with:
  ```
  [Browse File Library]  button
  3 files selected · 6.8 MB total
  ```
- Clicking opens `FileLibraryPicker`
- Selected files render in `ExperimentTable` and `ValidationPanel` as they do today
- PTM section unchanged (FASTA still wizard-only per decision #5)

### 4.5 Modified Metadata Page

**File:** `frontend/src/app/new/metadata/page.tsx`

**Changes:**
- Add "Import from Library" button next to existing "Import CSV" / "Export CSV" buttons
- Opens `FileLibraryPicker` filtered to `.csv` only
- Selected CSV is fetched, parsed client-side (same parser as current CSV import)
- Table populates, then auto-save kicks in (existing 800ms debounce)

### 4.6 API Client

New client in `frontend/src/lib/api-client.ts`:

```typescript
export const fileLibraryApi = {
  listDirectory: (path: string) => api.get(`/files/tree`, { params: { path } }),
  createFolder: (parentPath: string, name: string) => api.post(`/files/folders`, { parent_path: parentPath, name }),
  upload: (files: File[], targetPath: string, onProgress?: (pct: number) => void) => { /* multipart */ },
  rename: (path: string, newName: string) => api.put(`/files/rename`, { path, new_name: newName }),
  move: (sourcePath: string, targetParent: string) => api.put(`/files/move`, { source_path: sourcePath, target_parent: targetParent }),
  delete: (path: string) => api.delete(`/files/delete`, { data: { path } }),
  scan: () => api.post(`/files/scan`),
  search: (query: string) => api.get(`/files/search`, { params: { q: query } }),
  selectForSession: (sessionId: string, paths: string[]) => api.post(`/files/select`, { session_id: sessionId, paths }),
};
```

---

## 5. Error Handling

### 5.1 File Conflicts

| Scenario | HTTP Status | Behavior |
|----------|-------------|----------|
| Upload duplicate filename in same folder | `409` | Toast: "X already exists in this folder." |
| Move into folder with existing same-named file | `409` | Toast: "A file named X already exists in the target folder." |
| Rename to existing name in same folder | `409` | Toast: "A file named X already exists in this folder." |
| Copy to session, session already has that filename | — | Append `_1`, `_2` suffix (existing behavior) |

### 5.2 Invalid Files

| Scenario | HTTP Status | Behavior |
|----------|-------------|----------|
| Upload `.xlsx`, `.pdf`, etc. | `400` | Toast: "Only .txt and .csv files are allowed." |
| Upload `.fasta` to library | `400` | Toast: "FASTA files must be uploaded in the PTM wizard." |
| Upload > 500MB | `413` | Toast: "File exceeds 500MB maximum." |
| Upload 0-byte file | `400` | Toast: "File is empty." |
| Unparseable file at select time | `422` | Toast: "X could not be parsed as a valid PSM file." File not added to session. |

### 5.3 Folder Operations

| Scenario | HTTP Status | Behavior |
|----------|-------------|----------|
| Delete non-empty folder | — | Confirmation dialog: "Delete folder 'X' and all N files inside?" |
| Move folder into itself or descendant | `400` | Toast: "Cannot move a folder into itself." |
| Invalid folder name (`..`, `/`, `\`, empty) | `400` | Toast: "Invalid folder name." |
| Permission error during scan | — | Log warning, skip folder, toast: "Could not read folder: Permission denied." |

### 5.4 Copy-to-Session Failures

| Scenario | Behavior |
|----------|----------|
| Disk full during copy | Revert partial copies, toast: "Failed to copy files: disk full." |
| Session not found | `404`, modal closes, toast: "Session not found." |
| Large copy (500+ files) | Progress bar "Copying N of M..." with async operation |
| Modal closed mid-copy | Copy continues; disable close button during transfer |

---

## 6. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                   │
│                                                                   │
│  /files                     /new/upload        /new/metadata      │
│  ┌─────────────────┐       ┌──────────────┐   ┌──────────────┐   │
│  │ FileLibraryPage │       │ UploadStep   │   │ MetadataPage │   │
│  │ - FolderTree    │       │  [Browse...] │   │ [Import...]  │   │
│  │ - FileList      │       │     │         │   │     │        │   │
│  │ - Toolbar       │       │     ▼         │   │     ▼        │   │
│  └────────┬────────┘       │ FileLibrary   │   │ FileLibrary  │   │
│           │                │ Picker Modal  │   │ Picker Modal │   │
│           │                └──────┬────────┘   └──────┬───────┘   │
│           │                       │                    │          │
│           ▼                       ▼                    ▼          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    fileLibraryApi (api-client.ts)           │  │
│  └────────────────────────────┬───────────────────────────────┘  │
│                               │                                   │
└───────────────────────────────┼───────────────────────────────────┘
                                │  HTTP /api/files/*
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND                                    │
│                                                                   │
│  POST /api/files/upload                                           │
│  GET  /api/files/tree?path=                                       │
│  POST /api/files/select  ←── copies to session + parses           │
│  ...                                                              │
│           │                                                       │
│           ▼                                                       │
│  ┌────────────────────┐    ┌──────────────────────┐               │
│  │ FileIndexService   │    │ parse_proteomics_file│               │
│  │ (DuckDB index)     │    │ (existing)           │               │
│  └────────┬───────────┘    └──────────────────────┘               │
│           │                                                       │
│           ▼                                                       │
│  ┌────────────────────────────────────────────┐                   │
│  │         {FILE_LIBRARY_DIR}/                 │                   │
│  │         ├── .library_index.duckdb           │                   │
│  │         ├── folder1/file1.txt               │                   │
│  │         └── folder2/file2.csv               │                   │
│  └────────────────────────────────────────────┘                   │
│                                                                   │
│  ┌────────────────────────────────────────────┐                   │
│  │         sessions/{id}/uploads/              │  (copies)        │
│  │         ├── file1.txt                       │                   │
│  │         └── file2.csv                       │                   │
│  └────────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `backend/app/services/file_index_service.py` | DuckDB index scan, CRUD, search |
| `backend/app/api/routes/files.py` | File library API router |
| `frontend/src/app/files/page.tsx` | Files page |
| `frontend/src/components/files/FileLibraryPage.tsx` | Main file explorer layout |
| `frontend/src/components/files/FolderTree.tsx` | Collapsible folder tree |
| `frontend/src/components/files/FileList.tsx` | Sortable file table |
| `frontend/src/components/files/FileLibraryToolbar.tsx` | Action toolbar |
| `frontend/src/components/files/FileLibraryPicker.tsx` | Selection modal for wizard |
| `frontend/src/components/files/ContextMenu.tsx` | Right-click context menu |
| `frontend/src/lib/file-library-client.ts` | API client functions |

### Modified Files

| File | Change |
|------|--------|
| `backend/app/core/config.py` | Add `file_library_dir` setting |
| `backend/app/main.py` | Mount `files.router` at `/api/files` |
| `frontend/src/components/layout/TopNavigation.tsx` | Add "Files" nav link |
| `frontend/src/app/new/upload/page.tsx` | Replace `FileUploadZone` with library picker for TMT/DIA |
| `frontend/src/app/new/metadata/page.tsx` | Add "Import from Library" button |
| `frontend/src/lib/api-client.ts` | Add `fileLibraryApi` |

### Unchanged / Preserved

| Component | Reason |
|-----------|--------|
| PTM upload sections (enrichment, global, FASTA) | FASTA stays wizard-only (decision #5) |
| `ExperimentTable` | Still renders parsed files after selection |
| `ValidationPanel` | Still validates after selection |
| `TmtChannelMapping` | Still works; gains "Import from Library" button |
| `DiaMetadataTable` | Still works; gains "Import from Library" button |
| `FileUploadZone` (PTM mode only) | PTM still uploads directly in wizard |
| Existing CSV import/export on metadata page | Kept as fallback alongside new library import |

---

## 8. Out of Scope (Explicitly)

- File content preview/rendering
- FASTA files in the library
- Metadata auto-detection from file contents in the library
- Batch metadata editing
- File versioning
- Sharing files between users
- Cloud/object storage backends
- Drag-and-drop upload in the wizard (replaced entirely)
- Old `FileUploadZone` for TMT/DIA (removed)

---

## 9. Testing Strategy

### Backend Tests

- `Tests/backend/unit/services/test_file_index_service.py` — DuckDB schema creation, insert, update, delete, search, scan-and-sync diff logic
- `Tests/backend/unit/routes/test_files_routes.py` — CRUD endpoints, validation, error cases
- `Tests/backend/integration/test_file_library_e2e.py` — Full CRUD flow against temp directory, copy-to-session flow with real fixture files

### Frontend Tests

- `FileLibraryPage` renders empty state, folder tree, file list
- `FileLibraryPicker` modal: select, search, Select All, Clear Selection
- Upload step renders "Browse File Library" button (not FileUploadZone for TMT/DIA)
- Metadata page shows "Import from Library" button

### Key Test Data

- Reuse existing `Tests/fixtures/tmt_sample_10000rows.txt` and `dia_sample_01_10000rows.txt` through `dia_sample_12_10000rows.txt`
- Temp directory via `tmp_path` fixture for library root
