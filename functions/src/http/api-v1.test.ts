import { describe, expect, it } from 'vitest'
import { allowedApiV1Methods, normalizeApiV1Path, resolveApiV1Route } from './api-v1.js'

describe('API v1 routing', () => {
  it('normalizes Hosting and direct Cloud Function paths', () => {
    expect(normalizeApiV1Path('/api/v1/health')).toBe('/v1/health')
    expect(normalizeApiV1Path('/apiV1/v1/health?probe=1')).toBe('/v1/health')
  })

  it('maps resource paths and decodes identifiers', () => {
    expect(resolveApiV1Route('GET', '/v1/projects/project%201/snapshots/snap-1/files')).toEqual({
      target: 'projectSnapshotFiles',
      params: { projectId: 'project 1', snapshotId: 'snap-1' },
    })
  })

  it('uses REST methods for replacement and partial updates', () => {
    expect(resolveApiV1Route('PUT', '/v1/projects/p1/files')?.target).toBe('saveFiles')
    expect(resolveApiV1Route('PATCH', '/v1/projects/p1/snapshots/s1')?.target).toBe('updateSnapshot')
    expect(allowedApiV1Methods('/v1/projects/p1/files')).toEqual(['PUT'])
  })

  it('routes owner-only variation-set reads and selections', () => {
    expect(resolveApiV1Route('GET', '/v1/projects/p1/variation-sets/v1')).toEqual({
      target: 'projectVariationSet',
      params: { projectId: 'p1', variationSetId: 'v1' },
    })
    expect(resolveApiV1Route('POST', '/v1/projects/p1/variation-sets/v1/selection')?.target).toBe('selectVariation')
    expect(resolveApiV1Route('POST', '/v1/projects/p1/variation-sets/v1/selection')?.params).toEqual({
      projectId: 'p1',
      variationSetId: 'v1',
    })
    expect(allowedApiV1Methods('/v1/projects/p1/variation-sets/v1')).toEqual(['GET'])
    expect(resolveApiV1Route('DELETE', '/v1/projects/p1/variation-sets/v1')).toBeUndefined()
  })

  it('does not route unsupported methods or unknown resources', () => {
    expect(resolveApiV1Route('DELETE', '/v1/projects/p1/files')).toBeUndefined()
    expect(resolveApiV1Route('GET', '/v1/nope')).toBeUndefined()
  })
})
