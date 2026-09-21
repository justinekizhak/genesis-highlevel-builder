import { expect, test } from '@playwright/test'

test('redirects a signed-out visitor to the sign-in screen', async ({ page }) => {
  await page.goto('/projects')
  await expect(page).toHaveURL(/\/sign-in\?redirect=\/projects$/)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
  await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('supports the public sign-up route and preserves accessible labels', async ({ page }) => {
  await page.goto('/sign-up')
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await expect(page.getByLabel('Name')).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toHaveAttribute('minlength', '6')
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in')
})

test('ships marketplace metadata and a working brand icon', async ({ page, request }) => {
  await page.goto('/sign-in')
  await expect(page).toHaveTitle('Genesis | HighLevel App Builder')
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /HighLevel/)
  const icon = await request.get('/brand/genesis-mark.svg')
  expect(icon.ok()).toBe(true)
  expect(await icon.text()).toContain('<svg')
})

/**
 * Authenticated generation journeys. Firebase auth and the REST/SSE endpoints are intercepted so
 * these cover the client's own single-stream and variation-selection behavior without a backend.
 */
const TEST_UID = 'e2e-user'
const TEST_EMAIL = 'e2e@example.com'

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function fakeIdToken() {
  const now = Math.floor(Date.now() / 1000)
  return [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({
      iss: 'https://securetoken.google.com/jk-ai-app-builder',
      aud: 'jk-ai-app-builder',
      auth_time: now,
      user_id: TEST_UID,
      sub: TEST_UID,
      iat: now,
      exp: now + 3600,
      email: TEST_EMAIL,
      email_verified: true,
      firebase: { identities: { email: [TEST_EMAIL] }, sign_in_provider: 'password' },
    }),
    'signature',
  ].join('.')
}

const projectState = {
  snapshotId: 'base-snapshot',
  files: null,
  messages: [],
}

const singleStream = [
  'event: generation_started\ndata: {"type":"generation_started","generationId":"g1","provider":"openai","model":"gpt-5.4-mini"}\n\n',
  'event: variation_planning_started\ndata: {"type":"variation_planning_started"}\n\n',
  'event: token\ndata: {"type":"token","delta":"Built a contact dashboard."}\n\n',
  'event: file_start\ndata: {"type":"file_start","path":"index.html","language":"html"}\n\n',
  'event: file_delta\ndata: {"type":"file_delta","path":"index.html","delta":"<main>Contacts</main>"}\n\n',
  'event: file_complete\ndata: {"type":"file_complete","path":"index.html","size":21,"sha256":""}\n\n',
  'event: snapshot_created\ndata: {"type":"snapshot_created","snapshotId":"snap-1"}\n\n',
  'event: complete\ndata: {"type":"complete","generationId":"g1"}\n\n',
].join('')

const finalistFiles = {
  a: { 'index.html': '<main>Direction A</main>', 'styles.css': 'body{}', 'app.js': '// a' },
  b: { 'index.html': '<main>Direction B</main>', 'styles.css': '.app{}', 'app.js': '// b' },
}

function finalistFrames(candidateId: 'a' | 'b') {
  return Object.entries(finalistFiles[candidateId]).flatMap(([path, content]) => [
    `event: finalist_file_start\ndata: ${JSON.stringify({ type: 'finalist_file_start', candidateId, path, language: path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html' })}\n\n`,
    `event: finalist_file_delta\ndata: ${JSON.stringify({ type: 'finalist_file_delta', candidateId, path, delta: content })}\n\n`,
    `event: finalist_file_complete\ndata: ${JSON.stringify({ type: 'finalist_file_complete', candidateId, path, size: content.length })}\n\n`,
  ])
}

const variationStream = [
  'event: generation_started\ndata: {"type":"generation_started","generationId":"g2","provider":"openai","model":"gpt-5.4-mini"}\n\n',
  'event: variation_planning_started\ndata: {"type":"variation_planning_started"}\n\n',
  'event: variation_set_started\ndata: {"type":"variation_set_started","variationSetId":"set-1","count":4}\n\n',
  'event: candidate_started\ndata: {"type":"candidate_started","candidateId":"a","index":0}\n\n',
  'event: candidate_started\ndata: {"type":"candidate_started","candidateId":"b","index":1}\n\n',
  'event: candidate_progress\ndata: {"type":"candidate_progress","candidateId":"a","phase":"markup"}\n\n',
  'event: variation_validation_started\ndata: {"type":"variation_validation_started","completedCount":4}\n\n',
  'event: variation_grading_started\ndata: {"type":"variation_grading_started","eligibleCount":4}\n\n',
  'event: variation_grading_complete\ndata: {"type":"variation_grading_complete","gradingMode":"full"}\n\n',
  `event: finalist_metadata\ndata: ${JSON.stringify({
    type: 'finalist_metadata',
    variationSetId: 'set-1',
    finalists: [
      { candidateId: 'a', displayName: 'Direction A', summary: 'Compact table', strengths: ['Scannable'], risks: ['Dense'] },
      { candidateId: 'b', displayName: 'Direction B', summary: 'Split rail', strengths: ['Roomy'], risks: ['Scrolls'] },
    ],
  })}\n\n`,
  ...finalistFrames('a'),
  ...finalistFrames('b'),
  'event: finalists_ready\ndata: {"type":"finalists_ready","variationSetId":"set-1"}\n\n',
  'event: variation_complete\ndata: {"type":"variation_complete","variationSetId":"set-1"}\n\n',
].join('')

async function bootstrapWorkspace(page: import('@playwright/test').Page, stream: string) {
  const idToken = fakeIdToken()
  await page.route('**/identitytoolkit.googleapis.com/**', async (route) => {
    const url = route.request().url()
    if (url.includes('accounts:lookup')) {
      return route.fulfill({
        json: { users: [{ localId: TEST_UID, email: TEST_EMAIL, emailVerified: true, passwordUpdatedAt: Date.now(), validSince: '0', disabled: false, providerUserInfo: [] }] },
      })
    }
    return route.fulfill({
      json: { kind: 'identitytoolkit#VerifyPasswordResponse', localId: TEST_UID, email: TEST_EMAIL, idToken, refreshToken: 'refresh', expiresIn: '3600', registered: true },
    })
  })
  await page.route('**/securetoken.googleapis.com/**', (route) => route.fulfill({
    json: { access_token: idToken, expires_in: '3600', token_type: 'Bearer', refresh_token: 'refresh', id_token: idToken, user_id: TEST_UID, project_id: 'jk-ai-app-builder' },
  }))
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort())

  await page.route('**/apiV1/v1/integrations/status', (route) => route.fulfill({
    json: {
      llm: { configured: true, model: 'gpt-5.4-mini', availableModels: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-nano'] },
      highLevel: { connected: true, locationId: 'loc-1', locationName: 'Test location' },
    },
  }))
  await page.route('**/apiV1/v1/projects/project-1/application', (route) => route.fulfill({ json: projectState }))
  await page.route('**/apiV1/v1/projects/project-1/snapshots', (route) => route.fulfill({ json: { snapshots: [] } }))
  await page.route('**/apiV1/v1/projects/project-1/variation-sets/set-1/selection', (route) => route.fulfill({
    json: { snapshotId: 'snapshot-b', files: finalistFiles.b },
  }))
  await page.route('**/apiV1/v1/projects/project-1/generations', (route) => route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
    body: stream,
  }))

  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(TEST_EMAIL)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Wait for the guard to accept the mocked session before navigating into the workspace.
  await expect(page).toHaveURL(/\/projects$/, { timeout: 20_000 })
  await page.goto('/projects/project-1')
  await expect(page.getByLabel('Describe the HighLevel app to generate')).toBeVisible({ timeout: 20_000 })
}

test('streams a single generation straight into the editor', async ({ page }) => {
  const isMobile = test.info().project.name.startsWith('mobile')
  await bootstrapWorkspace(page, singleStream)
  await page.getByLabel('Describe the HighLevel app to generate').fill('Build a contact dashboard')
  await page.getByRole('button', { name: 'Generate app' }).click()

  if (isMobile) {
    // Completion moves the mobile view to Preview, so step back to Code to inspect the files.
    await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute('data-state', 'active', { timeout: 20_000 })
    await page.getByRole('tab', { name: 'Code' }).click()
  } else {
    await expect(page.getByText('Built a contact dashboard.')).toBeVisible({ timeout: 20_000 })
  }
  // Streamed file content reached the editor through the unchanged single-generation path.
  await expect(page.locator('.file-tree').getByText('index.html')).toBeVisible()
  await expect(page.getByText('Two directions are ready')).toHaveCount(0)
})

test('offers two directions for a variations prompt and activates the chosen one', async ({ page }) => {
  const isMobile = test.info().project.name.startsWith('mobile')
  await bootstrapWorkspace(page, variationStream)
  await page.getByLabel('Describe the HighLevel app to generate').fill('Show me a few directions for a contact dashboard')
  await page.getByRole('button', { name: 'Generate app' }).click()

  // The comparison replaces the editor and preview; no score or recommendation is ever shown.
  await expect(page.getByText('Two directions are ready')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Recommended')).toHaveCount(0)

  if (isMobile) {
    // Narrow viewports get accessible Direction A / Direction B tabs instead of two columns.
    await expect(page.getByRole('tab', { name: 'Direction A' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Direction B' })).toBeVisible()
    await page.getByRole('tab', { name: 'Direction B' }).click()
  }

  await expect(page.getByRole('button', { name: 'Use Direction B' })).toBeVisible()
  if (!isMobile) await expect(page.getByRole('button', { name: 'Use Direction A' })).toBeVisible()

  await page.getByRole('button', { name: 'Use Direction B' }).click()
  await expect(page.getByRole('button', { name: 'Use Direction B' })).toHaveCount(0, { timeout: 20_000 })
  if (isMobile) await page.getByRole('tab', { name: 'Code' }).click()
  // Only after a successful selection do the chosen files reach the editor.
  await expect(page.locator('.file-tree').getByText('app.js')).toBeVisible({ timeout: 20_000 })
})

test('treats a trailing "with multiple variations" phrase as a whole-app variations request', async ({ page }) => {
  // Regression test: this exact phrasing was once misread as a request for an in-app appointments
  // view switcher (mode "single") instead of four whole-dashboard candidates (mode "variations").
  // The planner's own classification is covered by a backend unit test; this confirms the client
  // still renders the comparison UI end to end once a variations stream for this prompt arrives.
  const isMobile = test.info().project.name.startsWith('mobile')
  await bootstrapWorkspace(page, variationStream)
  await page.getByLabel('Describe the HighLevel app to generate')
    .fill('Build a contact dashboard with search and upcoming appointments with multiple variations')
  await page.getByRole('button', { name: 'Generate app' }).click()

  await expect(page.getByText('Two directions are ready')).toBeVisible({ timeout: 20_000 })
  if (isMobile) await page.getByRole('tab', { name: 'Direction B' }).click()
  await expect(page.getByRole('button', { name: 'Use Direction B' })).toBeVisible()
})
