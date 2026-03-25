# Phase 2: TestSuiteOverhaul

## Goal
Replace unreliable tests with a trustworthy test suite that actually verifies functionality.

## Current Problems
- Tests pass but don't ensure app works
- Old tests may be testing wrong things
- False confidence is dangerous

## Approach

### Step 1: Inventory
- List all existing tests
- Mark which are reliable vs unreliable
- Identify gaps in coverage

### Step 2: Cleanup
- Delete unreliable tests
- Keep unit tests for pure functions

### Step 3: Integration Tests
Write end-to-end tests for real workflows:
- File upload → processing → results
- Session lifecycle
- Error handling paths

### Step 4: Verification
- Tests must fail when functionality breaks
- Tests must pass when functionality works

## Success Criteria
- E2E tests exercise complete user journeys
- Tests catch real bugs
- Tests don't give false confidence
