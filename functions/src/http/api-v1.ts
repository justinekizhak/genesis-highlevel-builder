export type ApiV1Target =
  | 'healthz'
  | 'generateApp'
  | 'cancelGeneration'
  | 'projectSnapshots'
  | 'projectSnapshotFiles'
  | 'saveFiles'
  | 'updateSnapshot'
  | 'restoreSnapshot'
  | 'projectState'
  | 'projectVariationSet'
  | 'selectVariation'
  | 'hlOAuthStart'
  | 'hlConnectionStatus'
  | 'integrationStatus'
  | 'hlProxy'

export type ApiV1Route = { target: ApiV1Target; params: Record<string, string> }

type RouteDefinition = { method: string; pattern: RegExp; keys: string[]; target: ApiV1Target }

const routes: RouteDefinition[] = [
  { method: 'GET', pattern: /^\/v1\/health$/, keys: [], target: 'healthz' },
  { method: 'POST', pattern: /^\/v1\/projects\/([^/]+)\/generations$/, keys: ['projectId'], target: 'generateApp' },
  { method: 'POST', pattern: /^\/v1\/projects\/([^/]+)\/generations\/([^/]+)\/cancellation$/, keys: ['projectId', 'generationId'], target: 'cancelGeneration' },
  { method: 'GET', pattern: /^\/v1\/projects\/([^/]+)\/application$/, keys: ['projectId'], target: 'projectState' },
  { method: 'PUT', pattern: /^\/v1\/projects\/([^/]+)\/files$/, keys: ['projectId'], target: 'saveFiles' },
  { method: 'GET', pattern: /^\/v1\/projects\/([^/]+)\/snapshots$/, keys: ['projectId'], target: 'projectSnapshots' },
  { method: 'GET', pattern: /^\/v1\/projects\/([^/]+)\/snapshots\/([^/]+)\/files$/, keys: ['projectId', 'snapshotId'], target: 'projectSnapshotFiles' },
  { method: 'PATCH', pattern: /^\/v1\/projects\/([^/]+)\/snapshots\/([^/]+)$/, keys: ['projectId', 'snapshotId'], target: 'updateSnapshot' },
  { method: 'POST', pattern: /^\/v1\/projects\/([^/]+)\/snapshots\/([^/]+)\/restorations$/, keys: ['projectId', 'snapshotId'], target: 'restoreSnapshot' },
  { method: 'GET', pattern: /^\/v1\/projects\/([^/]+)\/variation-sets\/([^/]+)$/, keys: ['projectId', 'variationSetId'], target: 'projectVariationSet' },
  { method: 'POST', pattern: /^\/v1\/projects\/([^/]+)\/variation-sets\/([^/]+)\/selection$/, keys: ['projectId', 'variationSetId'], target: 'selectVariation' },
  { method: 'POST', pattern: /^\/v1\/integrations\/highlevel\/authorizations$/, keys: [], target: 'hlOAuthStart' },
  { method: 'GET', pattern: /^\/v1\/integrations\/highlevel\/connection$/, keys: [], target: 'hlConnectionStatus' },
  { method: 'GET', pattern: /^\/v1\/integrations\/status$/, keys: [], target: 'integrationStatus' },
  { method: 'POST', pattern: /^\/v1\/integrations\/highlevel\/proxy-requests$/, keys: [], target: 'hlProxy' },
]

export function normalizeApiV1Path(path: string) {
  const pathname = path.split('?')[0] || '/'
  return pathname
    .replace(/^\/apiV1(?=\/)/, '')
    .replace(/^\/api(?=\/v1\/)/, '')
    .replace(/\/$/, '') || '/'
}

export function resolveApiV1Route(method: string, rawPath: string): ApiV1Route | undefined {
  const path = normalizeApiV1Path(rawPath)
  for (const route of routes) {
    if (route.method !== method.toUpperCase()) continue
    const match = path.match(route.pattern)
    if (!match) continue
    return {
      target: route.target,
      params: Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1]!)])),
    }
  }
}

export function allowedApiV1Methods(rawPath: string) {
  const path = normalizeApiV1Path(rawPath)
  return routes.filter((route) => route.pattern.test(path)).map((route) => route.method)
}
