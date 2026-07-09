# Spec: Fix Session Switching Bugs

**Status**: Verified | **Date**: 2026-07-09 | **Branch**: `fix/session-switching`

## Problem Summary

Six bugs cause state leakage and poor error handling when switching between sessions or deleting sessions in the sidebar. All root causes trace to two fundamental issues:

1. **Next.js App Router preserves component instances** when only search params change on the same route segment (e.g., `/analysis/visualization?session_id=A` → `/analysis/visualization?session_id=B`). React `useState` and `useRef` values survive the navigation.

2. **No centralized session-lifecycle handling** — session deletion doesn't redirect, 404s are silently ignored, and Zustand stores lack cross-route reset hooks.

## Verified Bug Inventory

### Bug 1 — Selected protein persists across sessions (User-reported)
**Severity**: HIGH | **Files**: `visualization/page.tsx`

**Root cause**: `ResultsContent` is preserved when switching sessions on the same route. `selectedProteins` (line 48, `useState<Set<string>>`) and `selectedProteinData` (line 49) are never cleared. The `comparisonInitialized` ref (line 28) blocks `selectedComparison` re-initialization — the first session sets it to `true`, and all subsequent session switches skip the auto-select logic. This causes the wrong comparison to be used for data fetching.

**Evidence**: `comparisonInitialized.current` stays `true` across search-param navigation. The effect at line 92 checks `if (!comparisonInitialized.current)` — always false after the first mount.

### Bug 2 — No redirect after deleting current session (User-reported)
**Severity**: HIGH | **Files**: `SessionManager.tsx`

**Root cause**: `handleDeleteSession` (line 128-143) deletes from backend + store but never calls `router.push()`. The URL bar still shows `?session_id=<deleted-uuid>`. The processing page's polling loop then fires 404s every 3 seconds indefinitely (line 318 silently swallows the error).

**Evidence**: Zero navigation calls in `handleDeleteSession`. `deleteSession` store action (sessionStore.ts:121-131) only nullifies `currentSession` — no URL change.

### Bug 3 — No "session not found" on visualization/processing/wizard pages
**Severity**: HIGH | **Files**: `visualization/page.tsx`, `processing/page.tsx`, `new/upload/page.tsx`, `new/metadata/page.tsx`

**Root cause**: Only `/analysis/page.tsx` (line 135-141) properly catches 404 and redirects. All other pages either show generic errors or silently fail:

| Page | 404 Behavior |
|------|-------------|
| `/analysis` | Catches → toast + redirect to `/` (correct) |
| `/analysis/visualization` | Generic "Error Loading Results" box, no redirect |
| `/analysis/processing` | `console.error` only, polling loop retries 404s forever |
| `/new/upload` | 404 falls through `if (sessionResp.ok)` without entering catch block — silent |
| `/new/metadata` | Same silent pattern |

**Evidence**: `processing/page.tsx:318` — `console.error('Polling error:', err)`. `upload/page.tsx:224-272` — 404 response: `sessionResp.ok` is false, entire restore block skipped, catch never entered.

### Bug 4 — All visualization local state leaks (discovered during investigation)
**Severity**: MEDIUM | **Files**: `visualization/page.tsx`, `visualization/gsea/page.tsx`, `visualization/bionet/page.tsx`, `visualization/qc/page.tsx`, `visualization/compare/page.tsx`

**Root cause**: Same as Bug 1 — component preservation. However, GSEA page handles this BETTER (no `comparisonInitialized` ref, `selectedPathway` explicitly cleared on data fetch). The main volcano page is worst-affected.

**Additional finding — Transient data write leak**: The markers-save effect (visualization/page.tsx:280-294) fires with NEW `apiPrefix` + OLD `markedProteins` before the session-config effect completes. If the config fetch takes >300ms, old session's markers are written to the new session's backend storage. Same pattern for filters (line 297-307).

### Bug 5 — Zustand stores leak (discovered during investigation)
**Severity**: MEDIUM | **Files**: `analysis-store.ts`, `processing-store.ts`

**Root cause**: Store resets only fire on specific page mounts:
- `analysis-store.reset()` — only in `/analysis/page.tsx:34-39`
- `processing-store.reset()` — only in `/analysis/processing/page.tsx:234-238`

Sidebar navigation from visualization→visualization skips both. Worse, wizard pages call `addUploadedFile` (which APPENDS, analysis-store.ts:163) and `setConfig` (which MERGES partial updates) without a preceding `reset()`. Old session's files and config survive into the new session.

### Bug 6 — Wizard pages silently swallow 404 (discovered during investigation)
**Severity**: MEDIUM | **Files**: `new/upload/page.tsx`, `new/metadata/page.tsx`

**Root cause**: Empty catch blocks (`// Session restoration failed, user can start fresh`). The 404 case doesn't even enter the catch — `if (sessionResp.ok)` silently skips restoration, `isRestoring` becomes false, and the redirect guard sends the user to `/new/type?session=<bad-uuid>` with zero feedback.

---

## Solution Design

### Principle: Force remount on session change (single-line fix for Bugs 1+4)

Add `key={sessionId}` to the content wrapper in the visualization layout. When session ID changes, React unmounts ALL page content and mounts fresh instances — clearing every `useState`, `useRef`, and effect across all 5 visualization pages simultaneously.

### Principle: Centralized session validation (fixes Bug 3)

Create `useSessionValidation` hook — validates session exists on mount, redirects to `/` on 404. Used everywhere sessions are viewed.

### Principle: Redirect on deletion (fixes Bug 2)

In `handleDeleteSession`, compare deleted session ID against URL search params. If the user is viewing the deleted session, navigate to `/`.

### Principle: Store reset + 404 handling on wizard pages (fixes Bugs 5+6)

Reset Zustand stores BEFORE restoring session data. Explicitly check 404 status code and redirect.

---

## Implementation

### File 1 (NEW): `frontend/src/hooks/use-session-validation.ts`

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/stores/ui-store';

/**
 * Validates that a session exists on the backend.
 * On 404: shows error toast and redirects to home.
 * Must be used inside a Suspense boundary (uses useSearchParams internally or accepts sessionId).
 */
export function useSessionValidation(sessionId: string | null | undefined) {
  const router = useRouter();
  const { addToast } = useUIStore();

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    const controller = new AbortController();

    fetch(`/api/sessions/${sessionId}`, { signal: controller.signal })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 404) {
          addToast('error', 'Session not found.');
          router.push('/');
        }
      })
      .catch(() => {
        // Network errors are handled by data-fetching components
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionId, router, addToast]);
}
```

### File 2: `frontend/src/app/analysis/visualization/layout.tsx`

**Changes**:
1. Import `Fragment` from React (already imported via `React` namespace)
2. Import and call `useSessionValidation`
3. Wrap `{children}` with Fragment keyed on sessionId

```diff
 function LayoutWithProvider({ children }: { children: React.ReactNode }) {
   const searchParams = useSearchParams();
   const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';
   const apiPrefix = sessionId ? sessionApiPrefix(sessionId) : '';

+  useSessionValidation(sessionId || null);

   return (
     <ApiProvider apiPrefix={apiPrefix}>
       <Navigation />
-      {children}
+      <React.Fragment key={sessionId || 'no-session'}>
+        {children}
+      </React.Fragment>
     </ApiProvider>
   );
 }
```

**Why Fragment not div**: Page components use `flex-1` for layout. A `div` wrapper would break flex sizing. Fragment adds no DOM node.

**Effect**: When `sessionId` changes from UUID-A to UUID-B:
1. `apiPrefix` context updates → data effects re-fire with new API endpoint
2. Fragment `key` changes → React unmounts old page component, mounts new one
3. All `useState`, `useRef`, and effects from old session are destroyed
4. New mount → fresh state, `comparisonInitialized.current = false`, clean data fetch

### File 3: `frontend/src/components/session/SessionManager.tsx`

**Changes**:
1. Add `useSearchParams` import
2. Extract current page's session ID from URL
3. Redirect in `handleDeleteSession` and `handleDeleteSelected` when deleted session matches

```diff
-import { useRouter } from 'next/navigation';
+import { useRouter, useSearchParams } from 'next/navigation';

 // Inside SessionManager component, after useRouter():
+const searchParams = useSearchParams();
+const pageSessionId = searchParams.get('session_id') || searchParams.get('session') || '';

 // In handleDeleteSession, after successful deletion:
   const handleDeleteSession = async (sessionId: string) => {
     try {
       await sessionsApi.delete(sessionId);
       deleteSession(sessionId);
       const { addToast } = useUIStore.getState();
       addToast('success', 'Session deleted successfully');
+
+      // Redirect if user is viewing the deleted session
+      if (pageSessionId === sessionId) {
+        router.push('/');
+      }
     } catch (error) {
       // ... existing error handling
     }
   };

 // In handleDeleteSelected, after successful deletion:
   const handleDeleteSelected = async () => {
     // ... existing code ...
       addToast('success', `${count} session${count > 1 ? 's' : ''} deleted`);
+
+      // Redirect if user is viewing one of the deleted sessions
+      if (idsToDelete.includes(pageSessionId)) {
+        router.push('/');
+      }
     } catch (error) {
       // ... existing error handling
     }
   };
```

### File 4: `frontend/src/app/analysis/processing/page.tsx`

**Changes**: Add `useSessionValidation` call in `ProcessingContent`.

```diff
+import { useSessionValidation } from '@/hooks/use-session-validation';

 // Inside ProcessingContent, after sessionId extraction:
   const sessionId = searchParams.get('session_id') || '';
+  useSessionValidation(sessionId);
```

### File 5: `frontend/src/app/new/upload/page.tsx`

**Changes**:
1. Extract content into a thin wrapper with `key={sessionId}` to force remount
2. Fix silent catch block to check 404 explicitly
3. Add `resetAnalysis()` on mount
4. Add `useSessionValidation` call

```diff
+import { useSearchParams } from 'next/navigation';
+import { useSessionValidation } from '@/hooks/use-session-validation';

-function UploadContent() {
+function UploadContentInner() {
   // ... existing component code (unchanged) ...
 }

+function UploadContent() {
+  const searchParams = useSearchParams();
+  const sessionId = searchParams.get('session') || '';
+  return <UploadContentInner key={sessionId || 'no-session'} />;
+}

 export default function UploadPage() {
   return (
     <Suspense fallback={...}>
       <UploadContent />
     </Suspense>
   );
 }
```

**Inside `UploadContentInner`**, fix the `restoreSession` effect:

```diff
   const restoreSession = async () => {
     try {
       const sessionResp = await fetch(`/api/sessions/${sessionId}`);
+      if (sessionResp.status === 404) {
+        addToast('error', 'Session not found. Please start a new analysis.');
+        router.push('/');
+        return;
+      }
       if (sessionResp.ok) {
         const raw = await sessionResp.json();
         // ... existing restore logic ...
       }
     } catch {
-      // Session restoration failed, user can start fresh
+      // Network error — allow continuing offline
     } finally {
       setIsRestoring(false);
     }
   };
```

**Add resetAnalysis on mount** (before the restoreSession effect to ensure ordering):

```diff
+  const resetAnalysis = useAnalysisStore((s) => s.reset);
+
+  // Reset analysis store when session changes — prevents stale file/config leakage
+  useEffect(() => {
+    resetAnalysis();
+    // eslint-disable-next-line react-hooks/exhaustive-deps
+  }, [sessionId]);
+
+  useSessionValidation(sessionId || null);
```

### File 6: `frontend/src/app/new/metadata/page.tsx`

**Same three changes as File 5**:
1. Thin wrapper with `key={sessionId}`
2. Fix catch block to check `sessionResp.status === 404`
3. Add `resetAnalysis()` on mount + `useSessionValidation`

```diff
+import { useSearchParams } from 'next/navigation';
+import { useSessionValidation } from '@/hooks/use-session-validation';

-function MetadataContent() {
+function MetadataContentInner() {
   // ... existing component code (unchanged) ...

   // Fix restore effect:
   const restore = async () => {
     try {
       const sessionResp = await fetch(`/api/sessions/${sessionId}`);
+      if (sessionResp.status === 404) {
+        addToast('error', 'Session not found. Please start a new analysis.');
+        router.push('/');
+        return;
+      }
       if (sessionResp.ok) {
         // ... existing restore logic ...
       }
     } catch {
-      // Restoration failed; user can continue editing
+      // Network error — allow continuing offline
     } finally {
       setIsRestoring(false);
     }
   };

+  const resetAnalysis = useAnalysisStore((s) => s.reset);
+
+  useEffect(() => {
+    resetAnalysis();
+    // eslint-disable-next-line react-hooks/exhaustive-deps
+  }, [sessionId]);
+
+  useSessionValidation(sessionId || null);
 }

+function MetadataContent() {
+  const searchParams = useSearchParams();
+  const sessionId = searchParams.get('session') || '';
+  return <MetadataContentInner key={sessionId || 'no-session'} />;
+}

 export default function MetadataPage() {
   return (
     <Suspense fallback={...}>
       <MetadataContent />
     </Suspense>
   );
 }
```

---

## Files Changed Summary

| # | File | Change Type |
|---|------|-------------|
| 1 | `frontend/src/hooks/use-session-validation.ts` | **NEW** — reusable hook |
| 2 | `frontend/src/app/analysis/visualization/layout.tsx` | Fragment key + useSessionValidation |
| 3 | `frontend/src/components/session/SessionManager.tsx` | Redirect on delete match |
| 4 | `frontend/src/app/analysis/processing/page.tsx` | useSessionValidation |
| 5 | `frontend/src/app/new/upload/page.tsx` | Keyed wrapper + 404 fix + resetAnalysis + useSessionValidation |
| 6 | `frontend/src/app/new/metadata/page.tsx` | Keyed wrapper + 404 fix + resetAnalysis + useSessionValidation |

**Files NOT touched** (covered by layout-level Fragment key):
- `visualization/page.tsx` (volcano)
- `visualization/gsea/page.tsx`
- `visualization/bionet/page.tsx`
- `visualization/qc/page.tsx`
- `visualization/compare/page.tsx`
- `visualization/ptm-placeholder/page.tsx`

---

## Bug → Fix Mapping

| Bug | Root Cause | Fix | File(s) |
|-----|-----------|-----|---------|
| 1 | Component preserved, `comparisonInitialized` ref blocks re-init | `Fragment key={sessionId}` forces full remount | layout.tsx |
| 2 | No navigation after delete | Check `pageSessionId` against deleted ID, redirect | SessionManager.tsx |
| 3 | No centralized 404 handling | `useSessionValidation` hook | layout.tsx, processing.tsx, upload.tsx, metadata.tsx |
| 4 | Component preserved, all local state leaks | `Fragment key={sessionId}` forces full remount | layout.tsx |
| 5 | Stores reset only on specific pages; wizard pages merge/append stale data | `resetAnalysis()` on wizard page mount, before restore | upload.tsx, metadata.tsx |
| 6 | Empty catch blocks, 404 silently falls through `if (sessionResp.ok)` | Explicit 404 check + redirect | upload.tsx, metadata.tsx |

---

## Verification Checklist

### Manual Testing

- [ ] **Bug 1**: Open completed session A → select protein in volcano → click completed session B in sidebar → verify NO protein selected, comparison reset to first comparison of session B
- [ ] **Bug 1 (variant)**: Open session A → change volcano filter values → switch to session B → verify filters are session B's saved values (not session A's)
- [ ] **Bug 2**: Open completed session → delete it from sidebar → verify redirect to home page with success toast
- [ ] **Bug 2 (bulk)**: Select 2+ sessions in sidebar, including the one currently viewed → delete selected → verify redirect to home
- [ ] **Bug 3**: Navigate to `/analysis/visualization?session_id=00000000-0000-0000-0000-000000000000` → verify "Session not found" toast + redirect to `/`
- [ ] **Bug 3**: Navigate to `/analysis/processing?session_id=00000000-0000-0000-0000-000000000000` → verify redirect to `/`
- [ ] **Bug 3**: Navigate to `/new/upload?session=00000000-0000-0000-0000-000000000000` → verify redirect to `/`
- [ ] **Bug 4**: Open session A → go to GSEA tab, change database → click session B in sidebar (navigating to volcano) → switch to GSEA tab → verify database is back to default
- [ ] **Bug 4**: Open session A → go to BioNet tab, change cutoffs → click session B in sidebar → verify BioNet defaults
- [ ] **Bug 5**: Open session A (uploadable) → upload files → click session B (also uploadable) in sidebar → verify no files from session A appear in upload list
- [ ] **Bug 6**: Delete a session → navigate directly to `/new/upload?session=<deleted-id>` → verify redirect to home with error toast

### Automated Checks

```bash
# Frontend lint
cd frontend && npm run lint

# TypeScript check
cd frontend && npx tsc --noEmit

# Backend tests (no backend changes, verify nothing broken)
backend/.venv/Scripts/python.exe -m pytest Tests/backend/ -v --tb=short
```

### Edge Cases

- [ ] Session switch between two completed sessions (A→B): both same pipeline type
- [ ] Session switch between sessions with different pipeline types (TMT→DIA)
- [ ] Session switch between completed and processing sessions (different routes)
- [ ] Rapidly click 3 different sessions in sidebar (race conditions)
- [ ] Delete session from sidebar while on processing page for that session
- [ ] Delete session from sidebar while on wizard upload page for that session
- [ ] Browser back/forward after session deletion
- [ ] Network offline → session validation should skip gracefully, data pages show their own error states
