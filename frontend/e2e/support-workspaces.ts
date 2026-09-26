import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { expect, type APIRequestContext, type Page, type Response } from '@playwright/test'
import { API } from './support'

/**
 * Throwaway workspaces for the workspace-switching suites (ENT-4).
 *
 * Each suite registers its own organisations through the product's sign-up
 * (`LiveTest <uuid>`, the name every throwaway organisation carries), gives
 * them a plan with backend/scripts/e2e/live-org.js — a brand-new organisation
 * is on a trial whose first write stops at the subscription gate — and drops
 * them afterwards with the same script. Nothing here signs in to the E2E
 * organisation, the demo organisation or the certified Phase 21 project.
 */

export const LIVE_PASSWORD = 'Live-Passw0rd!9a'
const MOBILE = { 'x-octapm-client': 'mobile' }

export type LiveOrg = {
  orgId: string
  name: string
  slug: string
  segment: string
  adminEmail: string
  adminId: string
  adminToken: string
}

type Json = { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } }

const backendDir = () => fileURLToPath(new URL('../../backend/', import.meta.url))

const liveOrgScript = (command: 'activate' | 'drop', orgId: string) => {
  const result = spawnSync(process.execPath, [path.join('scripts', 'e2e', 'live-org.js'), command, orgId], {
    cwd: backendDir(),
    env: process.env,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`live-org ${command} ${orgId} failed (exit ${result.status}): ${result.stderr || result.stdout}`)
  }
}

export const apiJson = async (
  client: APIRequestContext,
  method: 'get' | 'post' | 'patch' | 'delete',
  route: string,
  { token, data }: { token?: string; data?: unknown } = {},
) => {
  const response = await client.fetch(`${API}${route}`, {
    method: method.toUpperCase(),
    headers: { ...MOBILE, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    data,
  })
  const body: Json | null = await response.json().catch(() => null)
  return { status: response.status(), body }
}

/** A workspace registered through the product's sign-up, with a plan. */
export async function registerLiveOrg(client: APIRequestContext, label: string): Promise<LiveOrg> {
  const id = crypto.randomUUID()
  const adminEmail = `live-${label}-${id}@octapm-live.test`
  const registered = await apiJson(client, 'post', '/auth/register', {
    data: { orgName: `LiveTest ${id}`, name: `${label} Admin`, email: adminEmail, password: LIVE_PASSWORD },
  })
  expect(registered.status, `register ${label}: ${JSON.stringify(registered.body?.error)}`).toBe(201)
  const user = registered.body!.data!.user as { id: string; orgId: string }
  const tokens = registered.body!.data!.tokens as { accessToken: string }
  liveOrgScript('activate', user.orgId)
  const me = await apiJson(client, 'get', '/auth/me', { token: tokens.accessToken })
  const membership = (me.body!.data!.memberships as Array<{ orgId: string; slug: string | null; name: string }>).find(
    (entry) => entry.orgId === user.orgId,
  )!
  return {
    orgId: user.orgId,
    name: membership.name,
    slug: membership.slug ?? user.orgId,
    segment: membership.slug ?? user.orgId,
    adminEmail,
    adminId: user.id,
    adminToken: tokens.accessToken,
  }
}

export function dropLiveOrg(orgId: string) {
  try {
    liveOrgScript('drop', orgId)
  } catch (error) {
    process.stderr.write(`[e2e] ${String(error)}\n`)
  }
}

/** Adds a person to a workspace (an existing email joins as a second membership, ENT-2). */
export async function addMember(
  client: APIRequestContext,
  org: LiveOrg,
  member: { name: string; email: string; role: string },
): Promise<string> {
  const created = await apiJson(client, 'post', '/users', {
    token: org.adminToken,
    data: { ...member, password: LIVE_PASSWORD },
  })
  expect(created.status, `add ${member.email} to ${org.name}: ${JSON.stringify(created.body?.error)}`).toBe(201)
  return created.body!.data!.id as string
}

export async function createProject(client: APIRequestContext, token: string, name: string): Promise<string> {
  const created = await apiJson(client, 'post', '/projects', {
    token,
    data: { name, type: 'building', startDate: '2026-01-05', endDate: '2026-12-18' },
  })
  expect(created.status, `create project ${name}: ${JSON.stringify(created.body?.error)}`).toBe(201)
  return created.body!.data!.id as string
}

/**
 * Makes a member a company administrator of a workspace, which is what lets
 * a non-PM see every project there without a team assignment. Granted by
 * the workspace's owner (the person who registered it).
 */
export async function makeCompanyAdmin(client: APIRequestContext, org: LiveOrg, userId: string) {
  const updated = await apiJson(client, 'patch', `/users/${userId}`, {
    token: org.adminToken,
    data: { isCompanyAdmin: true },
  })
  expect(updated.status, `make admin in ${org.name}: ${JSON.stringify(updated.body?.error)}`).toBe(200)
}

/** A workspace-bound token for a person in several workspaces, out of band. */
export async function workspaceToken(client: APIRequestContext, email: string, orgId: string) {
  const login = await apiJson(client, 'post', '/auth/login', { data: { email, password: LIVE_PASSWORD } })
  expect(login.status).toBe(200)
  const data = login.body!.data as { chooseWorkspace?: boolean; identityToken?: string; tokens?: { accessToken: string } }
  if (!data.chooseWorkspace) return data.tokens!.accessToken
  const session = await apiJson(client, 'post', `/auth/workspaces/${orgId}/session`, { token: data.identityToken })
  expect(session.status).toBe(200)
  return (session.body!.data!.tokens as { accessToken: string }).accessToken
}

/**
 * Signs in through the form and returns once the sign-in request answered.
 * Unlike `signIn` in support.ts it does not expect a dashboard: a person in
 * several workspaces is shown the picker first.
 */
export async function signInForm(page: Page, email: string, password = LIVE_PASSWORD) {
  await page.goto('/sign-in')
  const emailInput = page.getByPlaceholder('name@example.com')
  await emailInput.waitFor({ state: 'visible', timeout: 30_000 })
  const passwordInput = page.locator('input[type="password"]').first()
  await emailInput.click()
  await emailInput.fill(email)
  await passwordInput.click()
  await passwordInput.fill(password)
  await expect(emailInput).toHaveValue(email)
  const isLogin = (r: Response) => r.url().includes('/auth/login') && r.request().method() === 'POST'
  const pending = page.waitForResponse(isLogin, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const response = await pending
  expect(response.status(), `sign-in for ${email} failed`).toBe(200)
  return response
}

/** The header's workspace name, as the switcher shows it. */
export const headerWorkspace = (page: Page) => page.getByTestId('workspace-switcher-name')

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
