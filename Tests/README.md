# Test Suite

The canonical testing principles, layer definitions, commands, isolation rules,
and suite health targets are documented in
[`AGENTS/07-testing.md`](../AGENTS/07-testing.md).

The default `pytest` selection is the hermetic backend PR suite. Frontend unit,
component, and browser tests live with the frontend toolchain. Browser and live
scientific tests start isolated services automatically. Tests that need R or
representative large data are explicit opt-in lanes and must never mutate normal
runtime data. Release-quality claims cover TMT and DIA only; PTM is omitted.
