import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  organismsApi,
  processingApi,
  reportApiPrefix,
  reportWebUrl,
  sessionsApi,
  uploadApi,
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
  it('uses the capability-scoped API prefix for a shared report', () => {
    expect(reportApiPrefix('opaque-share-token')).toBe(
      '/api/shared-reports/opaque-share-token'
    );
    expect(reportWebUrl('opaque-share-token')).toBe(
      `${window.location.origin}/reports/opaque-share-token`
    );
  });

  it('sends non-default session configuration to the config endpoint', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'session-1' }));

    await sessionsApi.updateConfig('session-1', {
      organism: 'mouse',
      resolve_shared_peptides: true,
      max_missing_fraction_per_condition: 0.2,
      min_psms_per_protein: 2,
      msqrob2_ridge: false,
      logfc_threshold: 1.5,
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/^\/api\/sessions\/session-1\/config\?_t=\d+$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      organism: 'mouse',
      resolve_shared_peptides: true,
      max_missing_fraction_per_condition: 0.2,
      min_psms_per_protein: 2,
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

  it.each([
    ['delete', () => sessionsApi.delete('session-1')],
    ['rename', () => sessionsApi.rename('session-1', 'Existing name')],
  ])('preserves backend error details when %s fails', async (_operation, request) => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A session with that name already exists',
        },
      }, 409)
    );

    await expect(request()).rejects.toMatchObject({
      message: 'A session with that name already exists',
      status: 409,
    });
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

  it('preserves structured backend error codes for visualization requests', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        error: {
          code: 'PROCESSING_ERROR',
          message: 'QC results are not ready',
        },
      }, 409)
    );

    await expect(
      visualizationApi.getQCData('/api/sessions/session-1')
    ).rejects.toMatchObject({
      code: 'PROCESSING_ERROR',
      message: 'QC results are not ready',
      status: 409,
    });
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

  it('uses the shared multipart client for PTM and FASTA uploads', async () => {
    const file = new File(['protein'], 'sample.csv', { type: 'text/csv' });
    mockFetch.mockResolvedValueOnce(jsonResponse({
      files: [{ filename: 'sample.csv', size: file.size, type: 'ptm_enrichment' }],
    }));

    await uploadApi.uploadPTMEnrichment('session-1', [file]);

    const [ptmUrl, ptmInit] = mockFetch.mock.calls[0];
    expect(ptmUrl).toBe('/api/sessions/session-1/upload/ptm-enrichment');
    expect(ptmInit.method).toBe('POST');
    expect(ptmInit.body).toBeInstanceOf(FormData);
    expect((ptmInit.body as FormData).getAll('files')).toEqual([file]);

    mockFetch.mockResolvedValueOnce(jsonResponse({
      files: [{ filename: 'proteome.fasta', size: 10 }],
    }));
    const fasta = new File(['>protein'], 'proteome.fasta');

    await expect(uploadApi.uploadFASTA('session-1', fasta)).resolves.toEqual({
      filename: 'proteome.fasta',
      size: 10,
    });

    const [fastaUrl, fastaInit] = mockFetch.mock.calls[1];
    expect(fastaUrl).toBe('/api/sessions/session-1/upload/fasta');
    expect((fastaInit.body as FormData).get('file')).toBe(fasta);
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
