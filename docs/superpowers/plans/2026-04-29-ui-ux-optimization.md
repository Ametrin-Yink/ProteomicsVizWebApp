# UI/UX Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize colors, layout, alignment, and UX flow across the ProteomicsViz frontend to match the design system defined in `globals.css`.

**Architecture:** Replace all hardcoded Tailwind color names (emerald, blue, zinc, rose) with design system utilities (`primary`, `secondary`, `success`, `warning`, `error`, `text`, `surface`, `border`). Standardize page shells, section card patterns, and remove dead code.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, Zustand, lucide-react

---

## File Structure

This plan modifies **37 files** and deletes **6 files**. Changes are organized by dependency layer:

| Layer | Files | Why first |
|---|---|---|
| 1. Dead code | 6 deletions, CSS cleanup | No dependencies, zero risk |
| 2. UI base components | Button, Card, Toast, Skeleton, EmptyState | Other components depend on these |
| 3. Layout + Session | TopNavigation, SessionManager, SessionCard | Visible on every page |
| 4. Processing components | ProgressBar, StatusIndicator, StepTracker, LogPanel | Independent of visualization |
| 5. Analysis page + components | analysis/page.tsx, ConfigPanel, ExperimentTable, FileUploadZone, ValidationPanel, CompoundDisplay | One logical flow |
| 6. Visualization layout + pages | visualization/layout.tsx, Results, QC, Bioinformatics pages | Page shells first |
| 7. Visualization components | VolcanoPlot, ProteinTable, PathwayTable, GSEADashboard, GSEAPlot, ProteinInfo, FilterPanel, PDFExport, QCPlots | Content inside the shells |
| 8. Home + About pages | page.tsx, about/page.tsx | Marketing pages, lowest dependency |

---

### Task 1: Dead Code Removal

**Files:**
- Delete: `frontend/src/app/layout-new.tsx`
- Delete: `frontend/src/app/layout-original.tsx`
- Delete: `frontend/src/app/page-new.tsx`
- Delete: `frontend/src/app/page-original.tsx`
- Delete: `frontend/src/components/layout/LeftSidebar.tsx`
- Delete: `color-reference.html`
- Modify: `frontend/src/app/globals.css`

- [ ] **Step 1.1: Delete duplicate layout/page files**

```bash
rm -f frontend/src/app/layout-new.tsx
rm -f frontend/src/app/layout-original.tsx
rm -f frontend/src/app/page-new.tsx
rm -f frontend/src/app/page-original.tsx
rm -f frontend/src/components/layout/LeftSidebar.tsx
rm -f color-reference.html
```

Verify no files import LeftSidebar:
```bash
cd frontend && grep -r "LeftSidebar" src/ --include="*.tsx" --include="*.ts"
```
Expected: No results (if there are imports, remove them before proceeding).

- [ ] **Step 1.2: Remove dead CSS from globals.css**

Read `frontend/src/app/globals.css`. Remove the following blocks entirely:

**Delete lines for `bounce` keyframe** (around lines 199-202):
```css
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-25%); }
}
```

**Delete `.animate-bounce` class** (around lines 225-227):
```css
.animate-bounce {
  animation: bounce 1s infinite;
}
```

**Delete `.gradient-text` class** (around lines 230-235):
```css
.gradient-text {
  background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

**Delete `.glass` class** (around lines 238-242):
```css
.glass {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
```

**Delete `.card-hover` class** (around lines 245-252):
```css
.card-hover {
  transition: transform var(--transition-base), box-shadow var(--transition-base);
}
.card-hover:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}
```

**Delete `body::after` lime indicator** (around lines 326-335):
```css
body::after {
  content: "";
  position: fixed;
  top: 0;
  right: 0;
  width: 10px;
  height: 10px;
  background: lime;
  z-index: 9999;
}
```

- [ ] **Step 1.3: Commit**

```bash
git add -A
git commit -m "chore: remove dead code (duplicate files, unused CSS classes, lime indicator)"
```

---

### Task 2: UI Base Components

**Files:**
- Modify: `frontend/src/components/ui/Button.tsx`
- Modify: `frontend/src/components/ui/Card.tsx`
- Modify: `frontend/src/components/ui/Toast.tsx`
- Modify: `frontend/src/components/ui/Skeleton.tsx`
- Modify: `frontend/src/components/ui/EmptyState.tsx`

- [ ] **Step 2.1: Update Button.tsx**

In `frontend/src/components/ui/Button.tsx`, update:

1. Change `rounded-lg` to `rounded-md` in base classes (line ~50):
```tsx
// Before:
'inline-flex items-center justify-center gap-2',
'font-semibold rounded-lg transition-all duration-200',
// After:
'inline-flex items-center justify-center gap-2',
'font-semibold rounded-md transition-all duration-200',
```

2. Update `danger` variant to use design system error color (lines ~83-87):
```tsx
// Before:
danger: cn(
  'bg-red-500 text-white',
  'hover:bg-red-600',
  'focus-visible:ring-red-500'
),
// After:
danger: cn(
  'bg-error text-white',
  'hover:bg-error/90',
  'focus-visible:ring-error'
),
```

- [ ] **Step 2.2: Update Card.tsx**

In `frontend/src/components/ui/Card.tsx`, update all hardcoded color values to design system tokens:

1. Change `bg-white` to `bg-background` (line ~41):
```tsx
// Before:
'bg-white rounded-xl overflow-hidden',
// After:
'bg-background rounded-lg overflow-hidden',
```

2. Change all `border-[#e2e8f0]` to `border-border` (lines ~48, ~56, ~60, ~115, ~167):
```tsx
// Every instance of:
'border border-[#e2e8f0]'
// Becomes:
'border border-border'
```

3. Change `hover:border-[#E73564]/30` to `hover:border-primary/30` (line ~78):
```tsx
// Before:
'hover:border-[#E73564]/30',
// After:
'hover:border-primary/30',
```

4. Change `text-[#1a1a2e]` to `text-text` and `text-[#64748b]` to `text-text-secondary` in CardHeader (lines ~122, ~127):
```tsx
// Before:
<h3 className="text-lg font-semibold text-[#1a1a2e] leading-tight">
// After:
<h3 className="text-lg font-semibold text-text leading-tight">

// Before:
<p className="mt-1 text-sm text-[#64748b]">
// After:
<p className="mt-1 text-sm text-text-secondary">
```

- [ ] **Step 2.3: Update Toast.tsx**

In `frontend/src/components/ui/Toast.tsx`, update the `toastColors` mapping (lines ~33-54):

```tsx
// Before:
const toastColors: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    icon: 'text-emerald-500',
  },
  error: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: 'text-red-500',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: 'text-amber-500',
  },
  info: {
    bg: 'bg-[#00ADEF]/10',
    border: 'border-[#00ADEF]/20',
    icon: 'text-[#00ADEF]',
  },
};

// After:
const toastColors: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: {
    bg: 'bg-success/5',
    border: 'border-success/20',
    icon: 'text-success',
  },
  error: {
    bg: 'bg-error/5',
    border: 'border-error/20',
    icon: 'text-error',
  },
  warning: {
    bg: 'bg-warning/5',
    border: 'border-warning/20',
    icon: 'text-warning',
  },
  info: {
    bg: 'bg-info/5',
    border: 'border-info/20',
    icon: 'text-info',
  },
};
```

Also update the toast message text color (line ~126):
```tsx
// Before:
<p className="text-sm font-medium text-[#1a1a2e]">
// After:
<p className="text-sm font-medium text-text">
```

And the close button colors (line ~134):
```tsx
// Before:
className="flex-shrink-0 text-[#94a3b8] hover:text-[#64748b] transition-colors"
// After:
className="flex-shrink-0 text-text-muted hover:text-text-secondary transition-colors"
```

- [ ] **Step 2.4: Update Skeleton.tsx**

In `frontend/src/components/ui/Skeleton.tsx`, change `bg-gray-200` to `bg-border`:

```tsx
// Before (line ~14):
animate-pulse bg-gray-200 rounded
// After:
animate-pulse bg-border rounded
```

- [ ] **Step 2.5: Update EmptyState.tsx**

In `frontend/src/components/ui/EmptyState.tsx`:

```tsx
// Before:
border-gray-200  →  border-border
bg-gray-50       →  bg-surface
```

Find all instances with grep and replace.

- [ ] **Step 2.6: Commit**

```bash
git add frontend/src/components/ui/
git commit -m "refactor(ui): standardize base components to design system tokens"
```

---

### Task 3: Layout Components

**Files:**
- Modify: `frontend/src/components/layout/TopNavigation.tsx`

- [ ] **Step 3.1: Update TopNavigation.tsx**

In `frontend/src/components/layout/TopNavigation.tsx`, replace the entire nav element (lines ~24-57):

```tsx
// Before:
<nav className="fixed top-0 left-0 right-0 z-50 bg-gray-700 text-white h-14 shadow-md">
  <div className="flex items-center h-full px-6">
    <Link href="/" className="flex items-center gap-2 mr-8" data-testid="app-logo">
      <FlaskConical className="w-6 h-6 text-cyan-400" />
      <span className="text-xl font-semibold tracking-tight" data-testid="app-name">
        ProteomicsViz
      </span>
    </Link>
    <div className="flex items-center gap-1">
      {navLinks.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(link.href + '/');
        return (
          <Link
            key={link.id}
            href={link.href}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-md transition-colors',
              isActive
                ? 'bg-gray-600 text-white'
                : 'text-gray-300 hover:bg-gray-600 hover:text-white'
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  </div>
</nav>

// After:
<nav className="fixed top-0 left-0 right-0 z-50 bg-foreground text-white h-14">
  <div className="flex items-center h-full px-6">
    <Link href="/" className="flex items-center gap-2 mr-8" data-testid="app-logo">
      <FlaskConical className="w-6 h-6 text-secondary" />
      <span className="text-xl font-semibold tracking-tight" data-testid="app-name">
        ProteomicsViz
      </span>
    </Link>
    <div className="flex items-center gap-1">
      {navLinks.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(link.href + '/');
        return (
          <Link
            key={link.id}
            href={link.href}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-md transition-colors',
              isActive
                ? 'bg-foreground/80 text-white'
                : 'text-text-muted hover:bg-foreground/60 hover:text-white'
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  </div>
</nav>
```

Changes:
- `bg-gray-700` → `bg-foreground`
- `shadow-md` removed (cleaner look, no shadow on fixed nav)
- `text-cyan-400` → `text-secondary`
- `bg-gray-600` → `bg-foreground/80`
- `text-gray-300 hover:bg-gray-600` → `text-text-muted hover:bg-foreground/60`

- [ ] **Step 3.2: Commit**

```bash
git add frontend/src/components/layout/TopNavigation.tsx
git commit -m "refactor(layout): update top navigation to design system colors"
```

---

### Task 4: Session Components

**Files:**
- Modify: `frontend/src/components/session/SessionManager.tsx`
- Modify: `frontend/src/components/session/SessionCard.tsx`

- [ ] **Step 4.1: Update SessionManager.tsx**

In `frontend/src/components/session/SessionManager.tsx`, make these replacements:

1. Bulk delete bar background (line ~443):
```tsx
// Before:
bg-[#fef2f2]
// After:
bg-error/5
```

2. Delete button override (line ~449):
```tsx
// Before:
className="!bg-red-600 hover:!bg-red-700"
// After:
className="!bg-error hover:!bg-error/90"
```

3. Session error text (line ~408):
```tsx
// Before:
text-red-500
// After:
text-error
```

All other hex values (`[#E73564]`, `[#00ADEF]`, `[#64748b]`, `[#1a1a2e]`, `[#94a3b8]`, `[#f8f9fc]`, `[#e2e8f0]`) should be replaced with design system tokens:

| Old | New |
|---|---|
| `[#E73564]` | `primary` |
| `[#00ADEF]` | `secondary` |
| `[#64748b]` | `text-secondary` |
| `[#1a1a2e]` | `text` |
| `[#94a3b8]` | `text-muted` |
| `[#f8f9fc]` | `surface` |
| `[#e2e8f0]` | `border` |

- [ ] **Step 4.2: Update SessionCard.tsx**

In `frontend/src/components/session/SessionCard.tsx`:

1. Status color map (around lines 46-94) — update to use design system tokens:
```tsx
// Before:
uploaded:  { color: 'text-emerald-500', bgColor: 'bg-emerald-50' },
completed: { color: 'text-emerald-500', bgColor: 'bg-emerald-50' },
queued:    { color: 'text-amber-500', bgColor: 'bg-amber-50' },
cancelled: { color: 'text-amber-500', bgColor: 'bg-amber-50' },
error:     { color: 'text-red-500', bgColor: 'bg-red-50' },

// After:
uploaded:  { color: 'text-success', bgColor: 'bg-success/5' },
completed: { color: 'text-success', bgColor: 'bg-success/5' },
queued:    { color: 'text-warning', bgColor: 'bg-warning/5' },
cancelled: { color: 'text-text-secondary', bgColor: 'bg-border/10' },
error:     { color: 'text-error', bgColor: 'bg-error/5' },
```

2. Rename input (around lines 390-395):
```tsx
// Before:
border-cyan-500 focus:ring-cyan-500/20
// After:
border-secondary focus:ring-secondary/20
```

3. Rename save button (around line 395):
```tsx
// Before:
text-emerald-600 hover:bg-emerald-50
// After:
text-success hover:bg-success/10
```

4. Rename button hover (around line 434):
```tsx
// Before:
hover:text-cyan-600 hover:bg-cyan-50
// After:
hover:text-secondary hover:bg-secondary/10
```

5. Replace all remaining hex color values (`[#E73564]`, `[#00ADEF]`, `[#64748b]`, `[#1a1a2e]`, `[#94a3b8]`, `[#f8f9fc]`, `[#e2e8f0]`) with design system tokens as in Task 4.1.

- [ ] **Step 4.3: Commit**

```bash
git add frontend/src/components/session/
git commit -m "refactor(session): standardize session components to design system tokens"
```

---

### Task 5: Processing Components

**Files:**
- Modify: `frontend/src/components/processing/ProgressBar.tsx`
- Modify: `frontend/src/components/processing/StatusIndicator.tsx`
- Modify: `frontend/src/components/processing/StepTracker.tsx`
- Modify: `frontend/src/components/processing/LogPanel.tsx`

- [ ] **Step 5.1: Update ProgressBar.tsx**

In `frontend/src/components/processing/ProgressBar.tsx`:

1. Progress bar gradient (line ~61):
```tsx
// Before:
'bg-gradient-to-r from-blue-500 to-blue-600',
// After:
'bg-gradient-to-r from-primary to-primary-dark',
```

2. Progress bar track (line ~50):
```tsx
// Before:
'rounded-full bg-zinc-200 dark:bg-zinc-800'
// After:
'rounded-full bg-border'
```

3. Percentage text (line ~73):
```tsx
// Before:
'font-medium text-zinc-700 dark:text-zinc-300'
// After:
'font-medium text-text'
```

Remove all `dark:` variants (no dark mode planned).

- [ ] **Step 5.2: Update StatusIndicator.tsx**

In `frontend/src/components/processing/StatusIndicator.tsx`, replace the status color map:

```tsx
// Before:
const statusConfig: Record<SessionStatus, { color: string; bgColor: string }> = {
  not_started: { color: 'text-zinc-400', bgColor: 'bg-zinc-100' },
  in_progress: { color: 'text-amber-500', bgColor: 'bg-amber-50' },
  completed:   { color: 'text-emerald-500', bgColor: 'bg-emerald-50' },
  error:       { color: 'text-rose-500', bgColor: 'bg-rose-50' },
  // ... others
};

// After:
const statusConfig: Record<SessionStatus, { color: string; bgColor: string }> = {
  not_started: { color: 'text-text-muted', bgColor: 'bg-border/20' },
  in_progress: { color: 'text-warning', bgColor: 'bg-warning/5' },
  completed:   { color: 'text-success', bgColor: 'bg-success/5' },
  error:       { color: 'text-error', bgColor: 'bg-error/5' },
  // ... others mapped similarly
};
```

Remove all `dark:` variants.

- [ ] **Step 5.3: Update StepTracker.tsx**

In `frontend/src/components/processing/StepTracker.tsx`:

1. Replace all status color references:
   - `zinc`/`amber`/`emerald`/`rose` → design system tokens per the same mapping as StatusIndicator
   - `blue-600` for in-progress indicators → `primary`

2. Remove all `dark:` variants.

- [ ] **Step 5.4: Update LogPanel.tsx**

In `frontend/src/components/processing/LogPanel.tsx`, this has the most changes:

1. **Replace the log level config** (lines ~26-50) — remove `borderColor` and left-border approach:

```tsx
// Before:
const logLevelConfig: Record<LogLevel, {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  info: {
    icon: <Info className="w-3.5 h-3.5" />,
    color: 'text-slate-700 dark:text-slate-300',
    bgColor: 'bg-slate-50 dark:bg-slate-900/30',
    borderColor: 'border-slate-300 dark:border-slate-700',
  },
  warning: {
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    color: 'text-amber-700 dark:text-amber-400',
    bgColor: 'bg-amber-50/50 dark:bg-amber-950/20',
    borderColor: 'border-amber-300 dark:border-amber-800',
  },
  error: {
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-50/50 dark:bg-red-950/20',
    borderColor: 'border-red-300 dark:border-red-800',
  },
};

// After:
const logLevelConfig: Record<LogLevel, {
  icon: React.ReactNode;
  dotColor: string;
  color: string;
  bgColor: string;
}> = {
  info: {
    icon: <Info className="w-3.5 h-3.5" />,
    dotColor: 'text-text-muted',
    color: 'text-text',
    bgColor: 'bg-surface',
  },
  warning: {
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    dotColor: 'text-warning',
    color: 'text-warning',
    bgColor: 'bg-warning/5',
  },
  error: {
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    dotColor: 'text-error',
    color: 'text-error',
    bgColor: 'bg-error/5',
  },
};
```

2. **Update LogEntryItem** — remove `border-l-2`, add colored dot:

```tsx
// In LogEntryItem, replace the entry wrapper:
// Before:
<div className={cn(
  'flex items-start gap-2 px-3 py-2 text-xs border-l-2',
  config.bgColor,
  config.borderColor
)}>
  <span className={cn('mt-0.5 flex-shrink-0', config.color)}>
    {config.icon}
  </span>

// After:
<div className={cn(
  'flex items-start gap-2 px-3 py-2 text-xs',
  config.bgColor,
  'border-b border-border/50'
)}>
  <span className={cn('mt-0.5 flex-shrink-0', config.dotColor)}>
    <Circle className="w-2 h-2 fill-current" />
  </span>
  <span className={cn('mt-0.5 flex-shrink-0', config.color)}>
    {config.icon}
  </span>
```

Add `Circle` to the lucide-react import.

3. **Update header** (lines ~152-162):
```tsx
// Before:
<div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
  <div className="flex items-center gap-2">
    <Terminal className="w-4 h-4 text-zinc-500" />
    <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
    <span className="px-2 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded-full text-xs text-zinc-600 dark:text-zinc-400">

// After:
<div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-border">
  <div className="flex items-center gap-2">
    <Terminal className="w-4 h-4 text-text-muted" />
    <h3 className="font-semibold text-sm text-text">
    <span className="px-2 py-0.5 bg-border/30 rounded-full text-xs text-text-secondary">
```

4. **Update the container** (line ~147):
```tsx
// Before:
'rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden',
// After:
'rounded-lg border border-border overflow-hidden',
```

5. **Update hover states** in header buttons:
```tsx
// Before:
hover:bg-zinc-200 dark:hover:bg-zinc-800
// After:
hover:bg-border/50
```

6. **Update empty state** (line ~195):
```tsx
// Before:
text-zinc-400
// After:
text-text-muted
```

7. **Update "show all" and "scroll to latest" buttons**:
```tsx
// Before:
bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100
// After:
bg-surface hover:bg-border/30
```

- [ ] **Step 5.5: Commit**

```bash
git add frontend/src/components/processing/
git commit -m "refactor(processing): standardize status colors, remove dark variants, fix LogPanel side-stripe ban"
```

---

### Task 6: Analysis Page + Components

**Files:**
- Modify: `frontend/src/app/analysis/page.tsx`
- Modify: `frontend/src/components/analysis/ConfigPanel.tsx`
- Modify: `frontend/src/components/analysis/ExperimentTable.tsx`
- Modify: `frontend/src/components/analysis/FileUploadZone.tsx`
- Modify: `frontend/src/components/analysis/ValidationPanel.tsx`
- Modify: `frontend/src/components/analysis/CompoundDisplay.tsx`

- [ ] **Step 6.1: Update analysis/page.tsx**

In `frontend/src/app/analysis/page.tsx`:

1. **Page shell** — change the outer wrapper (line ~202):
```tsx
// Before:
<div className="min-h-screen bg-gray-50 flex">
// After:
<div className="flex-1 overflow-y-auto bg-surface">
```

2. **Header** — update the sticky header (lines ~209-256):
```tsx
// Before:
<header className="bg-white border-b border-gray-200 sticky top-0 z-10">
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
// After:
<header className="bg-background border-b border-border sticky top-0 z-10">
  <div className="mx-auto px-6 max-w-7xl">
```

3. **Start Analysis button** (lines ~229-253):
```tsx
// Before:
${canStart && !isStartingAnalysis
  ? 'bg-cyan-600 text-white hover:bg-cyan-700 shadow-sm hover:shadow'
  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
}
// After:
${canStart && !isStartingAnalysis
  ? 'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
  : 'bg-border text-text-muted cursor-not-allowed'
}
```

4. **Loading state** (lines ~189-198):
```tsx
// Before:
<div className="min-h-screen flex items-center justify-center bg-gray-50">
  <div className="text-center">
    <Loader2 className="w-12 h-12 mx-auto mb-4 text-cyan-500 animate-spin" />
// After:
<div className="min-h-screen flex items-center justify-center bg-surface">
  <div className="text-center">
    <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
```

5. **Main content** (line ~259):
```tsx
// Before:
<main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
// After:
<main className="mx-auto px-6 py-8 max-w-7xl">
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
```

6. **Section cards** — all four sections use `rounded-xl shadow-sm border border-gray-200` with `px-6 py-4` headers and `p-6` content. Replace with the standard pattern:
```tsx
// Before each section:
<section className="bg-white rounded-xl shadow-sm border border-gray-200">
  <div className="px-6 py-4 border-b border-gray-200">
// After:
<section className="bg-background border border-border rounded-lg">
  <div className="px-5 py-3 border-b border-border">
```

And content areas:
```tsx
// Before:
<div className="p-6">
// After:
<div className="p-5">
```

7. **Remove the duplicate mobile CTA** — delete the entire mobile-only start button block (lines ~330-356):
```tsx
// DELETE this entire block:
<div className="px-6 py-4 border-t border-gray-200 lg:hidden">
  <button ...>Start Analysis</button>
</div>
```

8. **Right column config card** (line ~318):
```tsx
// Before:
<div className="bg-white rounded-xl shadow-sm border border-gray-200">
// After:
<div className="bg-background border border-border rounded-lg">
```

9. Suspense fallback (lines ~368-375):
```tsx
// Before:
<div className="min-h-screen flex items-center justify-center bg-gray-50">
  <Loader2 className="w-12 h-12 mx-auto mb-4 text-cyan-500 animate-spin" />
// After:
<div className="min-h-screen flex items-center justify-center bg-surface">
  <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
```

- [ ] **Step 6.2: Update ConfigPanel.tsx**

In `frontend/src/components/analysis/ConfigPanel.tsx`:

1. Toggle switches (lines ~77-79):
```tsx
// Before:
focus:ring-cyan-500 / bg-cyan-600
// After:
focus:ring-primary / bg-primary
```

2. Select elements (lines ~122-123, ~153-154, ~201):
```tsx
// Before:
focus:border-cyan-500 focus:ring-cyan-500
// After:
focus:border-primary focus:ring-primary
```

3. Tip/info box (line ~262):
```tsx
// Before:
bg-blue-50 border-blue-200 text-blue-700
// After:
bg-info/5 border-info/20 text-secondary
```

4. Status text (lines ~299-305):
```tsx
// Before:
text-green-600
// After:
text-success
```

5. Replace all remaining `gray-` references:
   - `border-gray-200` → `border-border`
   - `text-gray-600` → `text-text-secondary`
   - `text-gray-700` → `text-text`

- [ ] **Step 6.3: Update ExperimentTable.tsx**

In `frontend/src/components/analysis/ExperimentTable.tsx`:

1. Filter input/select (lines ~167-168, ~177, ~192):
```tsx
// Before:
focus:ring-cyan-500
// After:
focus:ring-primary
```

2. Checkboxes (lines ~219, ~248):
```tsx
// Before:
text-cyan-600 focus:ring-cyan-500
// After:
text-primary focus:ring-primary
```

3. Selected row (line ~240):
```tsx
// Before:
bg-cyan-50
// After:
bg-primary/5
```

4. Badges (lines ~260, ~265):
```tsx
// Before:
bg-blue-100 text-blue-800 (experiment)
bg-green-100 text-green-800 (condition)
// After:
bg-secondary/10 text-secondary (experiment)
bg-success/10 text-success (condition)
```

5. Replace `border-gray-200` → `border-border`, `text-gray-*` → design system tokens.

- [ ] **Step 6.4: Update FileUploadZone.tsx**

In `frontend/src/components/analysis/FileUploadZone.tsx`:

1. Dropzone (lines ~264-265):
```tsx
// Before:
bg-pink-50 / bg-pink-50/30 / hover:bg-pink-50/50
// After:
bg-primary/5 / bg-primary/5 / hover:bg-primary/10
```

2. Progress bar (lines ~365-366):
```tsx
// Before:
bg-cyan-500
// After:
bg-primary
```

3. Compound info box (lines ~403-412):
```tsx
// Before:
bg-blue-50 border-blue-200 text-blue-700
// After:
bg-info/5 border-info/20 text-secondary
```

4. Compound success (line ~415):
```tsx
// Before:
bg-green-50 border-green-200
// After:
bg-success/5 border-success/20
```

5. Replace all remaining `gray-` and `cyan-` references with design system tokens.

- [ ] **Step 6.5: Update ValidationPanel.tsx**

In `frontend/src/components/analysis/ValidationPanel.tsx`:

1. Status classes (lines ~14-16):
```tsx
// Before:
valid: 'text-green-600 bg-green-50 border-green-200'
invalid: 'text-red-600 bg-red-50 border-red-200'
// After:
valid: 'text-success bg-success/5 border-success/20'
invalid: 'text-error bg-error/5 border-error/20'
```

2. Status badges (lines ~84-86):
```tsx
// Before:
bg-green-100 text-green-800 / bg-amber-100 text-amber-800
// After:
bg-success/10 text-success / bg-warning/10 text-warning
```

3. Replicate progress (lines ~128, ~135):
```tsx
// Before:
bg-green-500 / bg-red-500; text-green-600 / text-red-600
// After:
bg-success / bg-error; text-success / text-error
```

4. Success box (lines ~163-164):
```tsx
// Before:
bg-green-50 border-green-200 text-green-800
// After:
bg-success/5 border-success/20 text-success
```

- [ ] **Step 6.6: Update CompoundDisplay.tsx**

In `frontend/src/components/analysis/CompoundDisplay.tsx`:

1. Loading spinner (line ~67):
```tsx
// Before:
border-b-2 border-blue-600
// After:
border-b-2 border-primary
```

2. Badge (line ~178):
```tsx
// Before:
bg-green-100 text-green-800
// After:
bg-success/10 text-success
```

3. Replace `border-gray-200` → `border-border`, `text-gray-*` → design system tokens.

- [ ] **Step 6.7: Commit**

```bash
git add frontend/src/app/analysis/page.tsx frontend/src/components/analysis/
git commit -m "refactor(analysis): standardize page shell, section cards, start button, and all component colors"
```

---

### Task 7: Visualization Layout + Pages

**Files:**
- Modify: `frontend/src/app/analysis/visualization/layout.tsx`
- Modify: `frontend/src/app/analysis/visualization/page.tsx`
- Modify: `frontend/src/app/analysis/visualization/qc/page.tsx`
- Modify: `frontend/src/app/analysis/visualization/bioinformatics/page.tsx`

- [ ] **Step 7.1: Update visualization/layout.tsx**

In `frontend/src/app/analysis/visualization/layout.tsx`:

1. **Page shell** (lines ~84-108):
```tsx
// Before:
<div className="min-h-screen bg-gray-50 flex">
  <SessionManager className="h-screen" />
  <div className="flex-1 flex flex-col">
    <nav className="flex items-center gap-2 text-sm text-gray-500 px-4 pt-4">
      <a href="/" className="hover:text-gray-700">Home</a>
      <span>/</span>
      <a href="/analysis" className="hover:text-gray-700">Analysis</a>
      <span>/</span>
      <span className="text-gray-700">Results</span>
    </nav>
// After:
<div className="flex-1 overflow-y-auto bg-surface">
  <SessionManager className="h-screen" />
  <div className="flex-1 flex flex-col">
    <nav className="flex items-center gap-2 text-sm px-6 pt-3">
      <a href="/" className="text-text-secondary hover:text-text">Home</a>
      <span className="text-text-muted">/</span>
      <a href="/analysis" className="text-text-secondary hover:text-text">Analysis</a>
      <span className="text-text-muted">/</span>
      <span className="text-text font-medium">Results</span>
    </nav>
```

2. **Tab navigation** (lines ~59-63):
```tsx
// Before:
isActive
  ? 'bg-blue-50 text-blue-700'
  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
// After:
isActive
  ? 'bg-primary/5 text-primary'
  : 'text-text-secondary hover:bg-surface hover:text-text'
```

3. **Tab container** (lines ~46-48):
```tsx
// Before:
<div className="bg-white border-b border-gray-200 sticky top-0 z-10">
  <div className="max-w-7xl mx-auto px-4">
// After:
<div className="bg-background border-b border-border sticky top-0 z-10">
  <div className="mx-auto px-6">
```

4. **Suspense fallback** (line ~100):
```tsx
// Before:
<div className="bg-white border-b border-gray-200 h-14" />
// After:
<div className="bg-background border-b border-border h-14" />
```

- [ ] **Step 7.2: Update visualization/page.tsx (Results)**

In `frontend/src/app/analysis/visualization/page.tsx`:

1. **Replace stat cards** (lines ~271-291) with a summary bar:

```tsx
// Before (four separate cards):
<div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8" data-testid="general-info-panel">
  <div className="bg-white rounded-lg border border-gray-200 p-4">
    <div className="text-sm text-gray-500 mb-1">Total Proteins Identified</div>
    <div className="text-2xl font-bold text-gray-900">{data.total_proteins}</div>
  </div>
  <div className="bg-white rounded-lg border border-gray-200 p-4">
    <div className="text-sm text-gray-500 mb-1">Total DE Proteins</div>
    <div className="text-2xl font-bold text-gray-900">{deCounts.total}</div>
  </div>
  <div className="bg-white rounded-lg border border-gray-200 p-4">
    <div className="text-sm text-gray-500 mb-1">Upregulated</div>
    <div className="text-2xl font-bold text-pink-600">{deCounts.up}</div>
  </div>
  <div className="bg-white rounded-lg border border-gray-200 p-4">
    <div className="text-sm text-gray-500 mb-1">Downregulated</div>
    <div className="text-2xl font-bold text-blue-600">{deCounts.down}</div>
  </div>
</div>

// After (single summary bar):
<div className="flex items-center gap-4 mb-6 text-sm bg-background border border-border rounded-lg px-5 py-3" data-testid="general-info-panel">
  <span className="font-semibold text-text">Results</span>
  <span className="text-border">|</span>
  <span className="text-text-secondary">
    {sessionConfig
      ? `${sessionConfig.experiment}: ${sessionConfig.treatment} vs ${sessionConfig.control}`
      : 'Treatment vs Control'}
  </span>
  <span className="text-border">|</span>
  <span className="text-text-secondary">{data.total_proteins.toLocaleString()} proteins</span>
  <span className="text-border">|</span>
  <span className="text-text-secondary">
    {deCounts.total} DE (
    <span className="text-primary font-semibold">{deCounts.up}↑</span>
    {' '}
    <span className="text-secondary font-semibold">{deCounts.down}↓</span>
    )
  </span>
</div>
```

2. **Remove the separate experiment/config subtitle** from the header (lines ~262-268) since it's now in the summary bar:
```tsx
// Before:
<div className="mb-8">
  <h1 className="text-3xl font-bold text-gray-900">Results</h1>
  <p className="text-gray-600 mt-2">{...}</p>
</div>

// After:
<div className="mb-6">
  <h1 className="text-xl font-semibold text-text">Differential Expression Results</h1>
</div>
```

3. **Content grid** (line ~294):
```tsx
// Before:
<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
// After:
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
```

4. **Loading state** — replace full-page spinner with inline loading. Change the loading block (lines ~200-208):
```tsx
// Before:
<div className="min-h-screen bg-gray-50 flex items-center justify-center">
  <div className="text-center">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
    <p className="mt-4 text-gray-600">Loading results...</p>
  </div>
</div>

// After — show the page shell with skeletons:
<div className="mx-auto px-6 py-8 max-w-7xl">
  <div className="h-8 bg-border/30 rounded-lg w-64 mb-6 animate-pulse" />
  <div className="h-12 bg-border/30 rounded-lg mb-6 animate-pulse" />
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div className="lg:col-span-2 space-y-6">
      <div className="h-48 bg-border/30 rounded-lg animate-pulse" />
      <div className="h-96 bg-border/30 rounded-lg animate-pulse" />
    </div>
    <div className="h-96 bg-border/30 rounded-lg animate-pulse" />
  </div>
</div>
```

5. **Error states** (lines ~211-219):
```tsx
// Before:
<div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
  <h2 className="text-lg font-semibold text-red-800 mb-2">Error Loading Results</h2>
  <p className="text-red-600">{error}</p>
// After:
<div className="bg-error/5 border border-error/20 rounded-lg p-5 max-w-md">
  <h2 className="text-base font-semibold text-error mb-2">Error Loading Results</h2>
  <p className="text-error">{error}</p>
```

6. **Suspense fallback** (lines ~365-370):
```tsx
// Before:
<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
// After:
<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
```

- [ ] **Step 7.3: Update QC page**

In `frontend/src/app/analysis/visualization/qc/page.tsx`:

1. Page shell replacements — same pattern as Results page:
   - `min-h-screen bg-gray-50` → page shell uses the layout wrapper, so inner content just needs `mx-auto px-6 py-8 max-w-7xl`
   - All `bg-gray-50` → `bg-surface`
   - All `border-gray-200` → `border-border`
   - All `text-gray-*` → design system tokens

2. Loading state — replace with skeleton pattern (same as Results page Step 7.2, step 4).

3. Loading spinner (line ~46):
```tsx
// Before:
border-blue-600
// After:
border-primary
```

4. QC summary section (lines ~77-122):
```tsx
// Before:
<div className="mb-6 bg-white rounded-lg border border-gray-200 p-4">
  <h2 className="text-lg font-semibold text-gray-900 mb-4">QC Summary Statistics</h2>
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div className="bg-gray-50 rounded-lg p-3">
// After:
<div className="mb-6 bg-background border border-border rounded-lg p-4">
  <h2 className="text-base font-semibold text-text mb-4">QC Summary Statistics</h2>
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div className="bg-surface rounded-lg p-3">
```

5. Suspense fallback — `border-blue-600` → `border-primary`.

- [ ] **Step 7.4: Update Bioinformatics page**

In `frontend/src/app/analysis/visualization/bioinformatics/page.tsx`:

1. Page shell — same `min-h-screen bg-gray-50` → layout wrapper pattern.

2. Loading state — skeleton pattern (same as Results page).

3. Loading spinner (line ~75):
```tsx
// Before:
border-blue-600
// After:
border-primary
```

4. Database selector (lines ~125-129):
```tsx
// Before:
selectedDatabase === db
  ? 'bg-blue-600 text-white'
  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
// After:
selectedDatabase === db
  ? 'bg-primary text-white'
  : 'bg-surface text-text-secondary hover:bg-border/30'
```

5. Inline loading overlay (lines ~106-112):
```tsx
// Before:
<div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 rounded-lg">
  <div className="flex items-center gap-2 text-gray-600">
    <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent"></div>
// After:
<div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10 rounded-lg">
  <div className="flex items-center gap-2 text-text-secondary">
    <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent"></div>
```

6. Empty state (lines ~176-178):
```tsx
// Before:
bg-gray-50 rounded-lg border border-gray-200 p-8 text-center
// After:
bg-surface rounded-lg border border-border p-5 text-center
```

7. Suspense fallback — `border-blue-600` → `border-primary`.

- [ ] **Step 7.5: Commit**

```bash
git add frontend/src/app/analysis/visualization/
git commit -m "refactor(visualization): standardize page shells, stat cards, loading states, and tab colors"
```

---

### Task 8: Visualization Components

**Files:**
- Modify: `frontend/src/components/visualization/VolcanoPlot.tsx`
- Modify: `frontend/src/components/visualization/ProteinTable.tsx`
- Modify: `frontend/src/components/visualization/PathwayTable.tsx`
- Modify: `frontend/src/components/visualization/GSEADashboard.tsx`
- Modify: `frontend/src/components/visualization/GSEAPlot.tsx`
- Modify: `frontend/src/components/visualization/ProteinInfo.tsx`
- Modify: `frontend/src/components/visualization/FilterPanel.tsx`
- Modify: `frontend/src/components/visualization/PDFExport.tsx`
- Modify: `frontend/src/components/visualization/QCPlots.tsx`

- [ ] **Step 8.1: Update VolcanoPlot.tsx**

In `frontend/src/components/visualization/VolcanoPlot.tsx`:

1. Selection mode buttons (lines ~324-352):
```tsx
// Before:
bg-blue-100 text-blue-700 border border-blue-300
// After:
bg-primary/10 text-primary border-primary/30
```

2. Inactive state buttons:
```tsx
// Before:
bg-white text-gray-700 border border-gray-300 hover:bg-gray-50
// After:
bg-background text-text-secondary border-border hover:bg-surface
```

3. Replace `border-gray-200` → `border-border`, `bg-white` → `bg-background` throughout.

- [ ] **Step 8.2: Update ProteinTable.tsx**

In `frontend/src/components/visualization/ProteinTable.tsx`:

1. Filter input (line ~175):
```tsx
// Before:
focus:ring-blue-500
// After:
focus:ring-primary
```

2. Checkbox (line ~184):
```tsx
// Before:
text-blue-600 focus:ring-blue-500
// After:
text-primary focus:ring-primary
```

3. Clear marks button (line ~194):
```tsx
// Before:
text-red-600 bg-white border border-red-300
// After:
text-error bg-background border-error/30
```

4. Export button (line ~204):
```tsx
// Before:
focus:ring-blue-500
// After:
focus:ring-primary
```

5. Row hover (line ~271):
```tsx
// Before:
hover:bg-blue-50
// After:
hover:bg-primary/5
```

6. UniProt link (line ~298):
```tsx
// Before:
text-blue-600 hover:text-blue-800
// After:
text-secondary hover:text-secondary-dark
```

7. LogFC color (line ~310):
```tsx
// Before:
text-pink-600 / text-blue-600
// After:
text-primary / text-secondary
```

8. Significance badge (line ~328):
```tsx
// Before:
bg-green-100 text-green-800
// After:
bg-success/10 text-success
```

9. Table header:
```tsx
// Before:
bg-gray-50
// After:
bg-surface
```

10. Replace all `border-gray-200` → `border-border`, `text-gray-*` → design system tokens.

- [ ] **Step 8.3: Update PathwayTable.tsx**

Same pattern as ProteinTable:

1. Search input: `focus:ring-blue-500` → `focus:ring-primary`
2. Checkboxes: `text-blue-600 focus:ring-blue-500` → `text-primary focus:ring-primary`
3. Export button: `focus:ring-blue-500` → `focus:ring-primary`
4. Row hover/selected: `hover:bg-blue-50` / `bg-blue-50` → `hover:bg-primary/5` / `bg-primary/5`
5. NES/ES colors: `text-pink-600` → `text-primary`, `text-blue-600` → `text-secondary`
6. Replace `border-gray-200` → `border-border`, `bg-gray-50` → `bg-surface`.

- [ ] **Step 8.4: Update GSEADashboard.tsx**

In `frontend/src/components/visualization/GSEADashboard.tsx`:

1. Overrepresented stat (line ~108):
```tsx
// Before:
text-pink-600
// After:
text-primary
```

2. Underrepresented stat (line ~116):
```tsx
// Before:
text-blue-600
// After:
text-secondary
```

3. Replace `border-gray-200` → `border-border`, `bg-gray-50` → `bg-surface`, `text-gray-*` → design system tokens.

- [ ] **Step 8.5: Update GSEAPlot.tsx**

In `frontend/src/components/visualization/GSEAPlot.tsx`:

1. Loading spinner (line ~273):
```tsx
// Before:
border-b-2 border-blue-600
// After:
border-b-2 border-primary
```

2. Replace `border-gray-200` → `border-border`, `text-gray-*` → design system tokens.

- [ ] **Step 8.6: Update ProteinInfo.tsx**

In `frontend/src/components/visualization/ProteinInfo.tsx`:

1. Loading spinner (line ~245):
```tsx
// Before:
border-b-2 border-blue-600
// After:
border-b-2 border-primary
```

2. UniProt links (line ~155):
```tsx
// Before:
text-blue-600 hover:text-blue-800 hover:underline
// After:
text-secondary hover:text-secondary-dark hover:underline
```

3. Replace `border-gray-200` → `border-border`, `bg-gray-50` → `bg-surface`.

- [ ] **Step 8.7: Update FilterPanel.tsx**

In `frontend/src/components/visualization/FilterPanel.tsx`:

1. **Fix button order** (lines ~24-43) — move reset before toggle:

```tsx
// Before:
<div className="flex items-center justify-between">
  <div className="flex items-center gap-2 text-gray-700">
    <SlidersHorizontal className="w-4 h-4" />
    <span className="font-medium">Filters</span>
  </div>
  <button onClick={() => setIsExpanded(!isExpanded)} ...>
    {isExpanded ? <ChevronUp /> : <ChevronDown />}
  </button>
  <button onClick={onReset} ...>
    <RotateCcw className="w-4 h-4" />
  </button>
</div>

// After:
<div className="flex items-center justify-between">
  <div className="flex items-center gap-2 text-text">
    <SlidersHorizontal className="w-4 h-4" />
    <span className="font-medium">Filters</span>
  </div>
  <div className="flex items-center gap-1">
    <button
      onClick={onReset}
      className="p-1.5 hover:bg-surface rounded text-text-muted hover:text-text transition-colors"
      title="Reset filters to defaults"
    >
      <RotateCcw className="w-4 h-4" />
    </button>
    <button
      onClick={() => setIsExpanded(!isExpanded)}
      aria-label="Toggle filters"
      className="p-1.5 hover:bg-surface rounded text-text-muted hover:text-text transition-colors"
    >
      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
    </button>
  </div>
</div>
```

2. **Expandable section** (line ~46):
```tsx
// Before:
space-y-4 pt-4 border-t border-gray-100 mt-4
// After:
space-y-3 pt-3 border-t border-border mt-3
```

3. **Labels** (lines ~50, ~80, ~113, ~143):
```tsx
// Before:
text-gray-700
// After:
text-text
```

4. **Input fields** (lines ~74, ~104, ~137, ~173):
```tsx
// Before:
border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#E73564]
// After:
border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary
```

5. **Tooltip** (line ~147):
```tsx
// Before:
bg-white border border-gray-200
// After:
bg-background border border-border
```

6. Replace `bg-white` → `bg-background`, `border-gray-200` → `border-border`.

- [ ] **Step 8.8: Update PDFExport.tsx**

In `frontend/src/components/visualization/PDFExport.tsx`:

1. Export PDF button (line ~350):
```tsx
// Before:
bg-blue-600 hover:bg-blue-700
// After:
bg-primary hover:bg-primary-dark
```

2. Generating state (line ~361):
```tsx
// Before:
bg-blue-50 text-blue-700
// After:
bg-info/5 text-secondary
```

3. Download button (line ~386):
```tsx
// Before:
bg-green-600 hover:bg-green-700
// After:
bg-success hover:bg-success/90
```

4. Preview/Regenerate (line ~394):
```tsx
// Before:
bg-gray-100 text-gray-700
// After:
bg-surface text-text
```

5. Retry button (line ~450):
```tsx
// Before:
bg-blue-600 hover:bg-blue-700
// After:
bg-primary hover:bg-primary-dark
```

- [ ] **Step 8.9: Update QCPlots.tsx**

In `frontend/src/components/visualization/QCPlots.tsx`:

1. **Keep Plotly trace colors** — `#F59E0B` and `#10B981` for treatment/control are data visualization colors, not UI. Leave them.

2. Replace UI colors:
   - `border-gray-200` → `border-border`
   - `bg-gray-50` → `bg-surface`
   - `text-gray-*` → design system tokens
   - Fallback color: `#6B7280` → `#94a3b8` (text-muted)

- [ ] **Step 8.10: Commit**

```bash
git add frontend/src/components/visualization/
git commit -m "refactor(visualization): standardize all component colors, fix FilterPanel button order"
```

---

### Task 9: Home + About Pages

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/app/about/page.tsx`

- [ ] **Step 9.1: Update Home page (page.tsx)**

In `frontend/src/app/page.tsx`:

1. Page background (line ~105):
```tsx
// Before:
bg-gray-50
// After:
bg-surface
```

2. Template icon gradient (line ~109):
```tsx
// Before:
bg-gradient-to-br from-[#E73564] to-[#00ADEF]
// After:
bg-primary
```

3. Template card hover (line ~137):
```tsx
// Before:
hover:border-cyan-500 hover:shadow-lg
// After:
hover:border-primary
```

4. Template card icon (lines ~147-148):
```tsx
// Before:
'bg-gradient-to-br',
template.color
// After:
template.available ? 'bg-primary' : 'bg-border/30'
```

5. Chevron (line ~170):
```tsx
// Before:
text-cyan-600
// After:
text-primary
```

6. Loading spinner (line ~178):
```tsx
// Before:
border-cyan-600
// After:
border-primary
```

7. Help link (lines ~201-202):
```tsx
// Before:
text-cyan-600 hover:text-cyan-700
// After:
text-secondary hover:text-secondary-dark
```

8. Template description text:
```tsx
// Before:
text-gray-600 / text-gray-700 / text-gray-500
// After:
text-text-secondary / text-text / text-text-muted
```

9. Section headers:
```tsx
// Before:
text-gray-900
// After:
text-text
```

- [ ] **Step 9.2: Update About page**

In `frontend/src/app/about/page.tsx`:

1. Page background (line ~27):
```tsx
// Before:
bg-gray-50
// After:
bg-surface
```

2. Hero icon gradient (line ~32):
```tsx
// Before:
bg-gradient-to-br from-[#E73564] to-[#00ADEF]
// After:
bg-primary
```

3. Feature card icons (line ~51):
```tsx
// Before:
<div className="bg-gradient-to-br from-[#E73564] to-[#00ADEF] rounded-lg p-2 inline-flex mb-3">
// After:
<div className="bg-primary/10 rounded-lg p-2 inline-flex mb-3">
```
And icon color:
```tsx
// Before:
text-white
// After:
text-primary
```

4. Feature cards (line ~50):
```tsx
// Before:
bg-white rounded-xl shadow-sm border border-gray-200 p-6
// After:
bg-background border border-border rounded-lg p-5
```

5. How to Use section (line ~59):
```tsx
// Before:
bg-white rounded-xl shadow-sm border border-gray-200 p-8
// After:
bg-background border border-border rounded-lg p-5
```

6. Step circles (line ~64):
```tsx
// Before:
bg-gradient-to-br from-[#E73564] to-[#00ADEF]
// After:
bg-primary
```

7. Info box (line ~77):
```tsx
// Before:
bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl border border-cyan-200 p-8
// After:
bg-info/5 border-info/20 rounded-lg p-5
```

8. Code blocks (lines ~81-82):
```tsx
// Before:
border-cyan-200
// After:
border-info/20
```

9. Pipeline section (line ~98):
```tsx
// Before:
bg-white rounded-xl shadow-sm border border-gray-200 p-8
// After:
bg-background border border-border rounded-lg p-5
```

10. Table rows:
```tsx
// Before:
border-b border-gray-200 / border-b border-gray-100 hover:bg-gray-50
// After:
border-b border-border / border-b border-border/50 hover:bg-surface
```

11. Step number badges:
```tsx
// Before:
bg-gray-100 text-gray-700
// After:
bg-surface text-text
```

12. Tech badges:
```tsx
// Before:
bg-gray-100 text-gray-700
// After:
bg-surface text-text
```

13. Tech Stack section (line ~129) and all subsections — same `bg-white rounded-xl shadow-sm border border-gray-200 p-8` → `bg-background border border-border rounded-lg p-5`.

14. Tech stack icons (lines ~134, ~140, ~146):
```tsx
// Before:
bg-gradient-to-br from-[#E73564] to-[#00ADEF] rounded p-1
// After:
bg-primary/10 rounded p-1
```

15. Quick Setup section (line ~154) — same card pattern.

16. Code blocks (lines ~159, ~169, ~179):
```tsx
// Before:
bg-gray-100
// After:
bg-surface
```

17. Footer link (line ~199):
```tsx
// Before:
text-[#00ADEF] hover:text-[#E73564]
// After:
text-secondary hover:text-primary
```

18. All `text-gray-900` → `text-text`, `text-gray-600` → `text-text-secondary`, `text-gray-500` → `text-text-muted`, `text-gray-700` → `text-text`, `text-gray-800` → `text-text`.

- [ ] **Step 9.3: Commit**

```bash
git add frontend/src/app/page.tsx frontend/src/app/about/page.tsx
git commit -m "refactor(pages): standardize home and about pages to design system, remove gradient icons"
```

---

### Task 10: Verification + Final Cleanup

- [ ] **Step 10.1: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: Zero errors. If there are errors, fix them (likely from removed LeftSidebar imports or renamed classes).

- [ ] **Step 10.2: Lint check**

```bash
cd frontend && npm run lint
```
Expected: Passes. Fix any lint errors.

- [ ] **Step 10.3: Visual walkthrough checklist**

Start the dev server and verify each page:
```bash
# Terminal 1 - Backend
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000

# Terminal 2 - Frontend
cd frontend && npm run dev
```

Then navigate to:
- [ ] `http://localhost:3000/` — Home: template cards use solid coral (no gradient), page bg is surface color, spinner is coral
- [ ] `http://localhost:3000/about` — About: feature icons are solid coral/10, info box is info/5, no gradient icons anywhere
- [ ] `http://localhost:3000/analysis?session=<test-id>` — Analysis: start button is coral, section cards consistent spacing (p-5), no duplicate CTA at bottom
- [ ] `http://localhost:3000/analysis/processing?session_id=<test-id>` — Processing: header is solid (no glass blur), step tracker uses semantic colors, log entries have bg tints (not left borders)
- [ ] `http://localhost:3000/analysis/visualization?session_id=<test-id>` — Results: summary bar (not 4 stat cards), tabs active is coral, table focus rings are coral
- [ ] `http://localhost:3000/analysis/visualization/qc?session_id=<test-id>` — QC: loading shows skeletons, colors consistent
- [ ] `http://localhost:3000/analysis/visualization/bioinformatics?session_id=<test-id>` — Bioinformatics: database selector uses coral, loading shows skeletons

- [ ] **Step 10.4: Backend tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v
```

- [ ] **Step 10.5: Final commit**

```bash
git add -A
git commit -m "chore: verify UI/UX optimization — TypeScript, lint, and visual checks pass"
```

---

## Spec Coverage Check

| Spec Section | Covered By |
|---|---|
| Section 1: Colors | Tasks 2-9 (every component color mapping) |
| Section 2: Layout | Task 6.1 (page shells), Task 6.1 (section cards), Task 7 (visualization shells) |
| Section 3: Alignment | Task 5.4 (LogPanel left border), Task 8.7 (FilterPanel button order), Task 7.1 (tab states), Task 7.2 (stat cards), Task 9.2 (About info box/icons), Task 9.1 (home gradient→solid) |
| Section 4: UX Flow | Task 1 (LeftSidebar deletion), Task 7.1 (breadcrumbs), Task 7.2/7.3/7.4 (skeleton loading), Task 6.1 (duplicate CTA removal) |
| Section 5: Dead Code | Task 1 (all deletions) |
| Verification | Task 10 |

All spec requirements have corresponding tasks. No placeholders or TBDs remain.
