# UI/UX Optimization Implementation Plan

> **STATUS: COMPLETED** - All 7 tasks implemented and merged to main on 2026-03-26
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical UI/UX issues identified in the evaluation: touch targets, visual hierarchy, accessibility, and empty states to improve usability and accessibility compliance.

**Architecture:** Component-focused improvements to existing React/Next.js frontend using Tailwind CSS design tokens, following established patterns in the codebase. Changes are additive and backward-compatible.

**Tech Stack:** React 19, Next.js 16, TypeScript, Tailwind CSS, shadcn/ui components, Plotly.js for visualizations

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/components/ui/Slider.tsx` | New reusable slider component with proper touch targets |
| `frontend/src/components/visualization/FilterPanel.tsx` | Extracted filter panel with collapsible sections |
| `frontend/src/components/visualization/ProteinTable.tsx` | Modify to add selected row highlighting and focus states |
| `frontend/src/components/session/SessionManager.tsx` | Improve contrast and color-coding for session states |
| `frontend/src/components/visualization/ProteinInfo.tsx` | Add loading skeleton for detail panel |
| `frontend/src/components/ui/EmptyState.tsx` | New reusable empty state component with guidance |
| `frontend/src/app/analysis/visualization/page.tsx` | Integrate new components, reduce information overload |

---

## Phase 1: Critical Accessibility Fixes (P0)

### Task 1: Create Accessible Slider Component

**Files:**
- Create: `frontend/src/components/ui/Slider.tsx`
- Test: `Tests/frontend/unit/Slider.test.tsx`
- Modify: `frontend/src/app/analysis/visualization/page.tsx:218-334` (replace slider inputs)

**Context:** Current slider inputs have touch targets that are too small (< 44px), failing WCAG 2.5.5. Need reusable slider with proper sizing.

- [x] **Step 1: Write the failing test**

```typescript
// Tests/frontend/unit/Slider.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Slider } from '@/components/ui/Slider';

describe('Slider Accessibility', () => {
  it('should have minimum 44px touch target', () => {
    render(<Slider value={2} min={0} max={5} onChange={() => {}} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveStyle({ minWidth: '44px', minHeight: '44px' });
  });

  it('should call onChange when value changes', () => {
    const handleChange = jest.fn();
    render(<Slider value={2} min={0} max={5} onChange={handleChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '3' } });
    expect(handleChange).toHaveBeenCalledWith(3);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd Tests && npx jest frontend/unit/Slider.test.tsx --no-coverage
```
Expected: FAIL with "Component not found" or "minWidth not applied"

- [x] **Step 3: Write minimal implementation**

```typescript
// frontend/src/components/ui/Slider.tsx
'use client';

import React from 'react';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
}

export function Slider({ value, min, max, step = 0.5, onChange, label }: SliderProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 min-w-[44px] min-h-[44px] cursor-pointer"
        style={{
          // Ensure touch target is at least 44x44px
          padding: '12px 0',
        }}
        aria-label={label}
        role="slider"
      />
    </div>
  );
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd Tests && npx jest frontend/unit/Slider.test.tsx --no-coverage
```
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add Tests/frontend/unit/Slider.test.tsx frontend/src/components/ui/Slider.tsx
git commit -m "feat(ui): add accessible Slider component with 44px touch target"
```

---

### Task 2: Add Color Indicators for Accessibility

**Files:**
- Modify: `frontend/src/components/visualization/ProteinTable.tsx:240-243`
- Test: `Tests/frontend/unit/ProteinTable.test.tsx` (add accessibility tests)

**Context:** Protein fold change indicators use color-only (pink for up, blue for down), which fails WCAG 1.4.1 for colorblind users.

- [x] **Step 1: Write the failing test**

```typescript
// Add to Tests/frontend/unit/ProteinTable.test.tsx
it('should show text indicators alongside color for fold change', () => {
  const mockData = [
    { master_protein_accessions: 'P123', gene_name: 'TEST1', log_fc: 2.5, pval: 0.01, adj_pval: 0.05, significant: true },
    { master_protein_accessions: 'P456', gene_name: 'TEST2', log_fc: -2.5, pval: 0.01, adj_pval: 0.05, significant: true },
  ];

  render(<ProteinTable data={mockData} selectedProteins={new Set()} onSelectProtein={() => {}} showSelectedOnly={false} onToggleShowSelected={() => {}} />);

  // Should show + or - indicator
  const upCell = screen.getByText('+2.5');
  const downCell = screen.getByText('-2.5');
  expect(upCell).toBeInTheDocument();
  expect(downCell).toBeInTheDocument();
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd Tests && npx jest frontend/unit/ProteinTable.test.tsx --no-coverage
```
Expected: FAIL - text not found

- [x] **Step 3: Write minimal implementation**

```typescript
// Modify frontend/src/components/visualization/ProteinTable.tsx around line 240
// Replace the log_fc cell with this:
<td
  className={`px-4 py-3 text-right font-medium ${
    item.log_fc > 0 ? 'text-pink-600' : 'text-blue-600'
  }`}
>
  {item.log_fc > 0 ? '+' : ''}{formatNumber(item.log_fc, 3)}
</td>
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd Tests && npx jest frontend/unit/ProteinTable.test.tsx --no-coverage
```
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add frontend/src/components/visualization/ProteinTable.tsx Tests/frontend/unit/ProteinTable.test.tsx
git commit -m "fix(a11y): add +/- text indicators to fold change values"
```

---

### Task 3: Add Selected Row Highlighting to Protein Table

**Files:**
- Modify: `frontend/src/components/visualization/ProteinTable.tsx:211-220`

**Context:** When a protein is selected, the table row doesn't visually indicate selection, causing users to lose context.

- [x] **Step 1: Write the failing test**

```typescript
// Add to Tests/frontend/unit/ProteinTable.test.tsx
it('should highlight selected protein row', () => {
  const mockData = [
    { master_protein_accessions: 'P123', gene_name: 'TEST1', log_fc: 2.5, pval: 0.01, adj_pval: 0.05, significant: true },
  ];

  render(<ProteinTable data={mockData} selectedProteins={new Set(['P123'])} onSelectProtein={() => {}} showSelectedOnly={false} onToggleShowSelected={() => {}} />);

  const row = screen.getByTestId('protein-table-row');
  expect(row).toHaveClass('ring-2', 'ring-primary', 'bg-primary/10');
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd Tests && npx jest frontend/unit/ProteinTable.test.tsx --no-coverage
```
Expected: FAIL - classes not applied

- [x] **Step 3: Write minimal implementation**

```typescript
// Modify frontend/src/components/visualization/ProteinTable.tsx around line 214
// Update the tr className:
<tr
  key={item.master_protein_accessions}
  onClick={() => onSelectProtein(item)}
  className={`cursor-pointer hover:bg-blue-50 transition-colors ${
    selectedProteins.has(item.master_protein_accessions)
      ? 'bg-primary/10 ring-2 ring-primary ring-inset'
      : ''
  }`}
  data-testid="protein-table-row"
>
```

Note: `primary` refers to CSS variable `--primary: #E73564` defined in globals.css

- [x] **Step 4: Run test to verify it passes**

```bash
cd Tests && npx jest frontend/unit/ProteinTable.test.tsx --no-coverage
```
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add frontend/src/components/visualization/ProteinTable.tsx Tests/frontend/unit/ProteinTable.test.tsx
git commit -m "feat(ui): highlight selected protein row in table"
```

---

## Phase 2: Visual Hierarchy Improvements (P1)

### Task 4: Improve Session Sidebar Contrast

**Files:**
- Modify: `frontend/src/components/session/SessionManager.tsx:319-321, 340-342, 361-363`

**Context:** Section headers "Active", "Completed", "Other" use low-contrast gray text (#94a3b8) on gray background.

- [x] **Step 1: Write the failing test**

```typescript
// Add to Tests/frontend/unit/SessionManager.test.tsx
it('should have sufficient contrast for section headers', () => {
  render(<SessionManager />);
  const activeHeader = screen.getByText('Active');
  expect(activeHeader).toHaveClass('text-gray-700'); // Higher contrast than text-gray-400
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd Tests && npx jest frontend/unit/SessionManager.test.tsx --no-coverage
```
Expected: FAIL - class mismatch

- [x] **Step 3: Write minimal implementation**

```typescript
// Modify frontend/src/components/session/SessionManager.tsx
// Line 319: Change from text-[#94a3b8] to text-gray-700 and add visual indicator
<h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
  Active
</h3>

// Line 340: Change for Completed section
<h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
  <span className="w-2 h-2 rounded-full bg-green-500"></span>
  Completed
</h3>

// Line 361: Change for Other section
<h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
  <span className="w-2 h-2 rounded-full bg-gray-500"></span>
  Other
</h3>
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd Tests && npx jest frontend/unit/SessionManager.test.tsx --no-coverage
```
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add frontend/src/components/session/SessionManager.tsx Tests/frontend/unit/SessionManager.test.tsx
git commit -m "feat(ui): improve session sidebar contrast and add status indicators"
```

---

### Task 5: Create Empty State Component

**Files:**
- Create: `frontend/src/components/ui/EmptyState.tsx`
- Test: `Tests/frontend/unit/EmptyState.test.tsx`
- Modify: `frontend/src/components/visualization/ProteinInfo.tsx` (use new component)

**Context:** Empty states are generic and provide no actionable guidance.

- [x] **Step 1: Write the failing test**

```typescript
// Tests/frontend/unit/EmptyState.test.tsx
import { render, screen } from '@testing-library/react';
import { EmptyState } from '@/components/ui/EmptyState';

describe('EmptyState', () => {
  it('should render title, description, and CTA', () => {
    render(
      <EmptyState
        title="No Protein Selected"
        description="Click on a point in the volcano plot or a row in the table to view protein details."
        icon={<span data-testid="icon">Icon</span>}
      />
    );
    expect(screen.getByText('No Protein Selected')).toBeInTheDocument();
    expect(screen.getByText(/Click on a point/)).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd Tests && npx jest frontend/unit/EmptyState.test.tsx --no-coverage
```
Expected: FAIL - Component not found

- [x] **Step 3: Write minimal implementation**

```typescript
// frontend/src/components/ui/EmptyState.tsx
'use client';

import React from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
      {icon && (
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-50 flex items-center justify-center">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 max-w-sm mx-auto mb-4">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd Tests && npx jest frontend/unit/EmptyState.test.tsx --no-coverage
```
Expected: PASS

- [x] **Step 5: Update ProteinInfo to use EmptyState**

```typescript
// Modify frontend/src/components/visualization/ProteinInfo.tsx
// Replace empty state rendering with:
import { EmptyState } from '@/components/ui/EmptyState';
import { Microscope } from 'lucide-react'; // or appropriate icon

// In the component, replace "No Protein Selected" section:
{!protein && (
  <EmptyState
    title="No Protein Selected"
    description="Click on a point in the volcano plot or a row in the table to view protein details."
    icon={<Microscope className="w-8 h-8 text-gray-400" />}
  />
)}
```

- [x] **Step 6: Commit**

```bash
git add frontend/src/components/ui/EmptyState.tsx Tests/frontend/unit/EmptyState.test.tsx frontend/src/components/visualization/ProteinInfo.tsx
git commit -m "feat(ui): add EmptyState component with guidance and icons"
```

---

## Phase 3: Layout Improvements (P2)

### Task 6: Extract Filter Panel Component

**Files:**
- Create: `frontend/src/components/visualization/FilterPanel.tsx`
- Modify: `frontend/src/app/analysis/visualization/page.tsx:196-336` (replace inline filters)

**Context:** Filter panel causes information overload - should be collapsible.

- [x] **Step 1: Write the failing test**

```typescript
// Tests/frontend/unit/FilterPanel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterPanel } from '@/components/visualization/FilterPanel';

describe('FilterPanel', () => {
  it('should be collapsible', () => {
    render(<FilterPanel foldChange={2} pValue={0.05} adjPValue={1} onChange={() => {}} />);
    expect(screen.getByText('Filters')).toBeInTheDocument();

    const toggleButton = screen.getByLabelText('Toggle filters');
    fireEvent.click(toggleButton);

    // After collapse, filter controls should be hidden
    expect(screen.queryByText('Fold Change Threshold')).not.toBeVisible();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd Tests && npx jest frontend/unit/FilterPanel.test.tsx --no-coverage
```
Expected: FAIL - Component not found

- [x] **Step 3: Write minimal implementation**

```typescript
// frontend/src/components/visualization/FilterPanel.tsx
'use client';

import React, { useState } from 'react';
import { SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { Slider } from '@/components/ui/Slider';

interface FilterPanelProps {
  foldChange: number;
  pValue: number;
  adjPValue: number;
  onChange: (filters: { foldChange: number; pValue: number; adjPValue: number }) => void;
}

export function FilterPanel({ foldChange, pValue, adjPValue, onChange }: FilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-700">
          <SlidersHorizontal className="w-4 h-4" />
          <span className="font-medium">Filters</span>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label="Toggle filters"
          className="p-1 hover:bg-gray-100 rounded"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {isExpanded && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-100 mt-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fold Change Threshold
            </label>
            <div className="flex items-center gap-2">
              <Slider
                value={foldChange}
                min={0}
                max={5}
                step={0.5}
                onChange={(value) => onChange({ foldChange: value, pValue, adjPValue })}
                label="Fold Change Threshold"
              />
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={foldChange}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!isNaN(value) && value >= 0 && value <= 5) {
                    onChange({ foldChange: value, pValue, adjPValue });
                  }
                }}
                className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              P-value Threshold
            </label>
            <div className="flex items-center gap-2">
              <Slider
                value={pValue}
                min={0.001}
                max={1}
                step={0.001}
                onChange={(value) => onChange({ foldChange, pValue: value, adjPValue })}
                label="P-value Threshold"
              />
              <input
                type="number"
                min={0.001}
                max={1}
                step={0.001}
                value={pValue}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!isNaN(value) && value >= 0.001 && value <= 1) {
                    onChange({ foldChange, pValue: value, adjPValue });
                  }
                }}
                className="w-24 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Adj P-value Threshold
            </label>
            <div className="flex items-center gap-2">
              <Slider
                value={adjPValue}
                min={0.001}
                max={1}
                step={0.001}
                onChange={(value) => onChange({ foldChange, pValue, adjPValue: value })}
                label="Adj P-value Threshold"
              />
              <input
                type="number"
                min={0.001}
                max={1}
                step={0.001}
                value={adjPValue}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!isNaN(value) && value >= 0.001 && value <= 1) {
                    onChange({ foldChange, pValue, adjPValue: value });
                  }
                }}
                className="w-24 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 4: Update page.tsx to use FilterPanel**

```typescript
// In frontend/src/app/analysis/visualization/page.tsx, replace filter section:
import { FilterPanel } from '@/components/visualization/FilterPanel';

// Replace lines 196-336 with:
<FilterPanel
  foldChange={filters.foldChange}
  pValue={filters.pValue}
  adjPValue={filters.adjPValue}
  onChange={(newFilters) => setFilters(newFilters)}
/>
```

- [x] **Step 5: Run test to verify it passes**

```bash
cd Tests && npx jest frontend/unit/FilterPanel.test.tsx --no-coverage
```
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add frontend/src/components/visualization/FilterPanel.tsx Tests/frontend/unit/FilterPanel.test.tsx frontend/src/app/analysis/visualization/page.tsx
git commit -m "feat(ui): add collapsible FilterPanel component"
```

---

### Task 7: Add Loading Skeleton for Protein Info

**Files:**
- Create: `frontend/src/components/ui/Skeleton.tsx`
- Modify: `frontend/src/components/visualization/ProteinInfo.tsx`

**Context:** Detail panel shows no loading state while fetching protein data.

- [x] **Step 1: Write the failing test**

```typescript
// Tests/frontend/unit/Skeleton.test.tsx
import { render, screen } from '@testing-library/react';
import { Skeleton } from '@/components/ui/Skeleton';

describe('Skeleton', () => {
  it('should render skeleton with animation', () => {
    render(<Skeleton className="h-4 w-32" />);
    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toHaveClass('animate-pulse', 'bg-gray-200');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd Tests && npx jest frontend/unit/Skeleton.test.tsx --no-coverage
```
Expected: FAIL

- [x] **Step 3: Write minimal implementation**

```typescript
// frontend/src/components/ui/Skeleton.tsx
'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      data-testid="skeleton"
      className={cn('animate-pulse bg-gray-200 rounded', className)}
    />
  );
}

// Preset skeleton layouts
export function ProteinInfoSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <Skeleton className="h-6 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="pt-4 border-t border-gray-100">
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
```

- [x] **Step 4: Update ProteinInfo to show skeleton while loading**

```typescript
// Add to frontend/src/components/visualization/ProteinInfo.tsx
import { ProteinInfoSkeleton } from '@/components/ui/Skeleton';

// Add loading state prop:
interface ProteinInfoProps {
  protein: DEResult | null;
  sessionId: string;
  isLoading?: boolean;
}

// In component render:
if (isLoading) {
  return <ProteinInfoSkeleton />;
}
```

- [x] **Step 5: Run test to verify it passes**

```bash
cd Tests && npx jest frontend/unit/Skeleton.test.tsx --no-coverage
```
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add frontend/src/components/ui/Skeleton.tsx Tests/frontend/unit/Skeleton.test.tsx
git commit -m "feat(ui): add Skeleton component and ProteinInfoSkeleton preset"
```

---

## Self-Review Checklist

- [x] All P0 (critical) accessibility issues addressed: touch targets, color-only indicators, selection feedback
- [x] All P1 visual hierarchy issues addressed: sidebar contrast, empty states
- [x] All P2 layout improvements addressed: collapsible filters, loading skeletons
- [x] Tests written for all new components
- [x] No placeholders (TBD, TODO, "implement later")
- [x] Exact file paths specified
- [x] Code blocks contain complete, runnable code
- [x] Commands include expected output

---

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-03-26-ui-ux-optimization.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

---

## Appendix: Testing Commands

Run all frontend tests:
```bash
cd Tests && npx jest frontend/unit --no-coverage
```

Run specific component test:
```bash
cd Tests && npx jest frontend/unit/Slider.test.tsx --no-coverage --watch
```

Run E2E tests for UI changes:
```bash
cd Tests && npx playwright test e2e/04-results.spec.ts --headed
```
