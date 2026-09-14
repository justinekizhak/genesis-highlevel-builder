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
