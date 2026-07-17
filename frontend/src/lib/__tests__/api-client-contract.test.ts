import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  organismsApi,
  processingApi,
  sessionsApi,
  visualizationApi,
} from '@/lib/api-client';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('frontend/backend API contract', () => {
  it('sends non-default session configuration to the config endpoint', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'session-1' }));

    await sessionsApi.updateConfig('session-1', {
      organism: 'mouse',
      remove_razor: true,
      strict_filtering: true,
      msqrob2_ridge: false,
      logfc_threshold: 1.5,
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/^\/api\/sessions\/session-1\/config\?_t=\d+$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      organism: 'mouse',
      remove_razor: true,
      strict_filtering: true,
      msqrob2_ridge: false,
      logfc_threshold: 1.5,
    });
  });

  it('uses the processing lifecycle endpoints and methods', async () => {
    const cases = [
      [() => processingApi.getStatus('session-1'), '/api/sessions/session-1/status', undefined],
      [() => processingApi.getLogs('session-1'), '/api/sessions/session-1/logs', undefined],
      [() => processingApi.retry('session-1'), '/api/sessions/session-1/retry', 'POST'],
      [() => processingApi.cancel('session-1'), '/api/sessions/session-1/cancel', 'POST'],
    ] as const;

    for (const [request, expectedUrl, expectedMethod] of cases) {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await request();
      const [url, init] = mockFetch.mock.calls.at(-1)!;
      expect(url).toBe(expectedUrl);
      expect(init?.method).toBe(expectedMethod);
    }
  });

  it('builds results and QC queries using backend parameter names', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await visualizationApi.getDEResults('/api/sessions/session-1', {
      significant_only: true,
      page: 2,
      per_page: 25,
      comparison: 'Drug_vs_Control',
    });
    expect(mockFetch.mock.calls[0][0]).toBe(
      '/api/sessions/session-1/results?significant_only=true&page=2&page_size=25&comparison=Drug_vs_Control'
    );

    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await visualizationApi.getQCData('/api/sessions/session-1');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/sessions/session-1/qc/plots');
  });

  it('uses the on-demand analysis endpoints', async () => {
    const cases = [
      [
        () => visualizationApi.runGSEA('/api/sessions/session-1', {
          comparison: 'Drug_vs_Control',
          databases: ['go_bp'],
        }),
        '/api/sessions/session-1/gsea/run',
        'POST',
      ],
      [
        () => visualizationApi.getBioNetStatus('/api/sessions/session-1'),
        '/api/sessions/session-1/bionet/status',
        undefined,
      ],
      [
        () => visualizationApi.computeVennData('/api/sessions/session-1', {
          comparisons: ['a', 'b'],
          pvalue_threshold: 0.05,
          logfc_threshold: 1,
        }),
        '/api/sessions/session-1/compare/venn',
        'POST',
      ],
      [
        () => visualizationApi.getTaskStatus('session-1'),
        '/api/sessions/session-1/tasks',
        undefined,
      ],
    ] as const;

    for (const [request, expectedUrl, expectedMethod] of cases) {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await request();
      const [url, init] = mockFetch.mock.calls.at(-1)!;
      expect(url).toBe(expectedUrl);
      expect(init?.method).toBe(expectedMethod);
    }
  });

  it('adapts organism responses to the frontend availability contract', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ organisms: [{ id: 'human', name: 'human' }] })
    );

    await expect(organismsApi.list()).resolves.toEqual([
      {
        id: 'human',
        name: 'human',
        display_name: 'Human',
        available: true,
      },
    ]);
  });
});
