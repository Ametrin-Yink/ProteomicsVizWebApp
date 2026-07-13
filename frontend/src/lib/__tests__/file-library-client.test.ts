import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileLibraryApi } from '../api-client';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fileLibraryApi', () => {
  it('listDirectory calls GET /files/tree with path param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ path: 'proj', entries: [] }),
    });

    await fileLibraryApi.listDirectory('proj');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/files/tree');
    expect(url).toContain('path=proj');
  });

  it('createFolder calls POST /files/folders', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ path: 'proj/new', name: 'new' }),
    });

    await fileLibraryApi.createFolder('proj', 'new');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/files/folders');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ parent_path: 'proj', name: 'new' });
  });

  it('search calls GET /files/search with q param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await fileLibraryApi.search('sample');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/files/search');
    expect(url).toContain('q=sample');
  });

  it('getContent calls GET /files/content and returns text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('col1,col2\nval1,val2'),
    });

    const text = await fileLibraryApi.getContent('meta.csv');
    expect(text).toBe('col1,col2\nval1,val2');
  });

  it('selectForSession calls POST /files/select', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    });

    await fileLibraryApi.selectForSession('session-uuid', ['path/to/file.txt']);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/files/select');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      session_id: 'session-uuid',
      paths: ['path/to/file.txt'],
    });
  });

  it('delete calls DELETE /files/delete with body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deleted: 'path/to/file.txt' }),
    });

    await fileLibraryApi.delete('path/to/file.txt');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/files/delete');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ path: 'path/to/file.txt' });
  });
});
