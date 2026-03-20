# VISUAL CONFIRMATION MUST RULE

## Effective Immediately: 2026-03-17

### RULE: ALL TESTS MUST HAVE VISUAL CONFIRMATION

**NO EXCEPTIONS. NO EXCUSES. NO PARTIAL PASS.**

---

## Requirements

For EVERY test, you MUST:

1. **Navigate to the page manually** using browser automation
2. **Perform the action** described in the test
3. **Take screenshots** at key steps:
   - Initial state
   - During action
   - Final result
4. **Visually inspect** the screenshots to confirm:
   - UI elements are present
   - Data is displayed correctly
   - No errors or broken layouts
   - Expected behavior is occurring
5. **Document findings** with screenshot analysis

---

## Visual Confirmation Checklist

### For File Upload Tests:
- [ ] Upload zone visible and styled correctly
- [ ] Files appear in file table with correct metadata
- [ ] File names displayed correctly
- [ ] File sizes shown in human-readable format
- [ ] Experiment/Condition/Replicate parsed correctly
- [ ] Progress indicators visible during upload
- [ ] Success/error messages displayed
- [ ] Drag & drop area highlighted on hover

### For Form Tests:
- [ ] Form fields visible and accessible
- [ ] Dropdowns populated with correct options
- [ ] Selected values displayed correctly
- [ ] Validation messages shown in correct location
- [ ] Error states styled appropriately
- [ ] Submit buttons enabled/disabled correctly

### For Configuration Tests:
- [ ] All configuration options visible
- [ ] Toggle switches aligned correctly
- [ ] Icons (checkmark/X) centered in toggles
- [ ] Organism dropdown shows all options
- [ ] Treatment/Control dropdowns populated
- [ ] Summary panel updates correctly

### For Validation Tests:
- [ ] Validation panel visible
- [ ] Status indicators (green/red) correct
- [ ] Error messages clear and helpful
- [ ] Progress bars showing correct counts
- [ ] Warning icons visible where appropriate

---

## Screenshot Requirements

### Minimum Screenshots Per Test:
1. **Before action** - Initial state
2. **During action** - While operation in progress
3. **After action** - Final result
4. **Full page** - At least one full-page screenshot

### Screenshot Naming:
```
visual-{test-name}-{step}-{timestamp}.png
```

### Screenshot Storage:
- Save to: `frontend/test-results/visual-confirmation/`
- Also save to backup folder

---

## Analysis Requirements

For EACH screenshot, you MUST write:

```markdown
## Screenshot: {name}

### Visible Elements:
- Element 1: Status
- Element 2: Status
- Element 3: Status

### Data Verification:
- Expected: X
- Actual: Y
- Status: PASS/FAIL

### Issues Found:
- Issue 1 (if any)
- Issue 2 (if any)

### Overall: PASS / FAIL
```

---

## Non-Negotiable Standards

1. **If visual confirmation fails, the test fails.**
2. **If UI element is misaligned, the test fails.**
3. **If data is not displayed, the test fails.**
4. **If screenshot is missing, the test is incomplete.**
5. **If I haven't seen it with my own eyes, it doesn't count.**

---

## Enforcement

This rule is ABSOLUTE. No test is considered passing without:
- [ ] Screenshots captured
- [ ] Visual analysis completed
- [ ] All elements verified
- [ ] No issues found
- [ ] Documentation written

---

**Signed:** Sisyphus
**Date:** 2026-03-17
**Status:** ACTIVE
