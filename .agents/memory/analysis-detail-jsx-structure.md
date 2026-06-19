---
name: analysis-detail JSX structure rules
description: Two JSX structural pitfalls in analysis-detail.tsx that caused TS errors during animation refactor.
---

## Rule 1 — Report Hero inner div must close before </motion.div>

The Report Hero `<motion.div>` (opens near line 2914) wraps several layers:
```
<motion.div>          ← Report Hero
  <div p-5 sm:p-6>   ← must close BEFORE </motion.div>
    <div flex-col>
      <div left-panel> ... </div>
      <div right-panel> ... </div>
    </div>            ← closes flex-col
  </div>              ← closes p-5 — MUST EXIST before </motion.div>
</motion.div>
```
Closing order (innermost first): right-panel-wrapper → flex-col → p-5 → `</motion.div>`.

**Why:** TypeScript JSX requires all `<div>` inside `<motion.div>` to close before `</motion.div>`. A missing `</div>` for p-5 causes TS17008 at the p-5 open line.

**How to apply:** When wrapping or unwrapping Report Hero in motion.div, count div closes before the motion.div close tag — should be 3 closes (right-panel-wrapper, flex-col, p-5) before `</motion.div>`.

---

## Rule 2 — No extra </div> between Floating Verdict AnimatePresence and scroll-to-top button

After the Floating Verdict Card `</AnimatePresence>` (around line 3776), the ONLY close that belongs there is the flex-gap-6 `</div>`. An extra `</div>` at 8 spaces between `</AnimatePresence>` and the scroll-to-top comment prematurely closes the outer page div, pushing the scroll-to-top AnimatePresence and share modal OUTSIDE the JSX expression. This causes TS1005 `')' expected` at the scroll-to-top comment.

**Why:** The outer `<div id="analysis-report-content">` must stay open past the scroll-to-top and share modal. It closes at the very end of the return (4 spaces, right before `);`).

**How to apply:** After the Floating Verdict AnimatePresence, expect exactly ONE `</div>` (for flex-gap-6) before the scroll-to-top section. Any additional `</div>` is wrong.
