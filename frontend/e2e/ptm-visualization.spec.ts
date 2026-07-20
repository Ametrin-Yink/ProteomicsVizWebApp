import { expect, test, type Page } from '@playwright/test';

const sessionId = 'ptm-e2e-session';
const session = {
  id: sessionId,
  name: 'PTM E2E analysis',
  state: 'completed',
  pipeline: 'ptm',
  config: {},
  files: {},
  markers: {},
  ptm_volcano_filters: {},
};

async function mockPTMVisualization(page: Page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === '/api/sessions') {
      await route.fulfill({ json: [session] });
      return;
    }
    if (path === `/api/sessions/${sessionId}`) {
      await route.fulfill({ json: session });
      return;
    }
    if (path === `/api/sessions/${sessionId}/visualization/manifest`) {
      await route.fulfill({ json: {
        pipeline: 'ptm',
        default_module: 'volcano',
        modules: [
          { id: 'volcano', visible: true, enabled: true, disabled_reason: null, data_scopes: ['ptm'] },
          { id: 'qc', visible: true, enabled: true, disabled_reason: null, data_scopes: ['ptm'] },
          { id: 'compare', visible: true, enabled: false, disabled_reason: 'At least two comparisons are required', data_scopes: ['ptm'] },
          { id: 'gsea', visible: false, enabled: false, disabled_reason: null, data_scopes: [] },
          { id: 'bionet', visible: false, enabled: false, disabled_reason: null, data_scopes: [] },
        ],
      } });
      return;
    }
    if (path === `/api/sessions/${sessionId}/ptm/compare`) {
      await route.fulfill({ json: { data: {
        comparisons: ['Drug_vs_DMSO'],
        matrix: [[1]],
        pairs: [],
        available_for_all: true,
      } } });
      return;
    }
    if (path === `/api/sessions/${sessionId}/ptm/results`) {
      await route.fulfill({ json: { data: { comparisons: [{
        label: 'Drug_vs_DMSO',
        ptm_model: [{
          Protein: 'P12345_C120',
          SiteLabel: 'P12345 · C120',
          ProteinAccession: 'P12345',
          Gene: 'GENE1',
          LocalizationStatus: 'Confident',
          log2FC: 2,
          pvalue: 0.001,
          'adj.pvalue': 0.01,
        }],
        protein_model: [],
        adjusted_model: [],
      }] } } });
      return;
    }
    if (path.endsWith('/visualization') && request.method() === 'PUT') {
      await route.fulfill({ json: session });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unmocked ${path}` } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockPTMVisualization(page);
});

test('PTM sessions use the PTM workspace and capability-gated navigation', async ({ page }) => {
  await page.goto(`/analysis/visualization?session_id=${sessionId}`);

  await expect(page.getByTestId('ptm-volcano-container')).toBeVisible();
  await expect(page.getByText(/PTM sites/).first()).toBeVisible();
  await expect(page.getByTestId('compare-tab')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('gsea-tab')).toHaveCount(0);
  await expect(page.getByTestId('download-ptm-results-btn')).toHaveAttribute(
    'href',
    `/api/sessions/${sessionId}/ptm/results/download`,
  );

  await page.goto(`/analysis/visualization/gsea?session_id=${sessionId}`);
  await expect(page.getByTestId('visualization-module-unavailable')).toBeVisible();
});
