const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const wizardPages = [
    ['/new/type', 'Type'],
    ['/new/upload', 'Upload'],
    ['/new/metadata', 'Metadata'],
    ['/new/comparisons', 'Comparisons'],
    ['/new/config', 'Config'],
    ['/new/summary', 'Summary'],
  ];

  for (const fileType of ['tmt', 'dia']) {
    console.log(`\n=== ${fileType.toUpperCase()} ===`);

    // Create session + config via API
    const sid = await page.evaluate(async (ft) => {
      const r = await fetch('http://localhost:8000/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${ft.toUpperCase()} Demo`, template: 'multi_condition_comparison' })
      });
      const s = await r.json();
      await fetch(`http://localhost:8000/api/sessions/${s.id}/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_type: ft, organism: 'human' })
      });
      return s.id;
    }, fileType);
    console.log(`Session: ${sid}`);

    // Navigate each wizard page and check for errors
    let errors = 0;
    for (const [path, label] of wizardPages) {
      try {
        await page.goto(`http://localhost:3000${path}?session=${sid}`, {
          waitUntil: 'networkidle', timeout: 15000
        });
        await page.waitForTimeout(500);

        // Check for Next.js error overlay
        const errorOverlay = await page.locator('[data-nextjs-error-boundary], .next-error-h1').count();
        const bodyText = await page.textContent('body').catch(() => '');
        const is500 = bodyText.includes('Internal Server Error');

        if (errorOverlay > 0 || is500) {
          console.log(`  ${label}: ❌ ERROR`);
          // Get error details
          const errText = await page.textContent('body').catch(() => '');
          console.log(`    ${errText.slice(0, 300).replace(/\n/g, ' ')}`);
          errors++;
        } else {
          console.log(`  ${label}: ✅`);
        }
        await page.screenshot({
          path: `Tests/screenshots/${fileType}-${label.toLowerCase()}.png`,
          fullPage: true
        });
      } catch (e) {
        console.log(`  ${label}: ❌ TIMEOUT/CRASH (${e.message.slice(0, 80)})`);
        errors++;
      }
    }

    console.log(`  ${errors} errors in ${wizardPages.length} pages`);
  }

  await browser.close();
  console.log('\nDone. Screenshots saved to Tests/screenshots/');
})();
