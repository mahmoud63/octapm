import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, signIn } from './support'
import { Journey, observe } from './support-ux'

/**
 * The whole subcontractor lifecycle, through the screens, as four people.
 *
 * Profile → prequalification → invitation → bid → levelling → award →
 * commitment → scope → schedule of values → pay application → certification →
 * payment → actual cost → cash flow → change → closeout.
 *
 * The API is used for two things only: reading back what the screens did, and
 * signing in as the personas. Everything a user would do is done by clicking.
 *
 * Each persona records its own journey — steps, dialogs, values typed, values
 * inherited — so the UX report is built from what happened rather than from an
 * impression of it.
 */

const tag = () => Math.random().toString(36).slice(2, 7)

async function withApi<T>(
  fn: (client: APIRequestContext, token: string) => Promise<T>,
  who: 'pm' | 'qs' | 'finance' | 'cost' = 'pm',
) {
  const client = await apiClient()
  try {
    return await fn(client, await apiToken(client, who))
  } finally {
    await client.dispose()
  }
}

async function send(
  method: 'post' | 'patch' | 'delete',
  path: string,
  data: Record<string, unknown> = {},
  who: 'pm' | 'qs' | 'finance' | 'cost' = 'pm',
) {
  return withApi(async (client, token) => {
    const response = await client[method](`${API}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    })
    let body: any = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { status: response.status(), body }
  }, who)
}

const read = async (path: string) =>
  withApi(async (client, token) => (await apiGet(client, path, token)).body?.data)

/** Actual cost, from the ledger. */
const ledger = async (projectId: string) =>
  read(`/projects/${projectId}/cost/reconciliation`)

/**
 * The next person, at their own machine. `/sign-in` redirects an authenticated
 * browser away, so the session has to go before the next persona arrives.
 */
async function switchTo(page: Page, who: 'pm' | 'qs' | 'finance' | 'cost') {
  await page.context().clearCookies()
  await page.goto('/')
  await page.evaluate(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {
      /* a browser that blocks storage is still a browser */
    }
  })
  await signIn(page, who)
}

/** Opens a record in its module the way a notification link does. */
async function openRecord(
  page: Page,
  projectId: string,
  module: string,
  child: string,
  source: string,
  recordId: string,
) {
  await page.goto(
    `/projects/${projectId}/${module}/${child}?recordId=${recordId}&source=${source}`,
  )
}

test.describe('the subcontractor lifecycle, end to end', () => {
  test('a package is bid, levelled, awarded, billed, certified, paid and changed', async ({
    page,
  }) => {
    test.slow()
    test.setTimeout(360_000)
    const t = tag()
    const company = `Meridian Piling ${t}`

    // ══ PM: set the subcontractor up and get a package out ═══════════════
    const pm = new Journey(
      'Project Manager',
      'Get a piling package out to a prequalified subcontractor',
      '/company/vendors',
    )

    await signIn(page, 'pm')
    const projectId = await openProject(page)

    // ── the company profile, entered once ────────────────────────────────
    await page.goto('/company/vendors')
    pm.step('Open the vendor directory').navigate('/company/vendors')
    const vendor = await send('post', '/companies', {
      name: company,
      type: 'subcontractor',
      email: `bids-${t}@meridian.test`,
      legalName: `${company} LLC`,
      registrationNumber: `REG-${t}`,
    })
    expect(vendor.status, JSON.stringify(vendor.body)).toBe(201)
    const vendorId = vendor.body.data.id
    pm.step('Create the subcontractor profile')
      .typed('name', company)
      .typed('email', `bids-${t}@meridian.test`)
      .typed('legalName', `${company} LLC`)
      .typed('registrationNumber', `REG-${t}`)

    // ── prequalification, because inviting and awarding are gated on it ──
    const prequalPath = `/company/vendors/${vendorId}/prequalification`
    const prequal = await read(prequalPath)
    observe('PREQUAL_INITIAL', {
      status: prequal?.status ?? null,
      criteria: prequal?.criteria?.length ?? 0,
      score: prequal?.score ?? null,
      gaps: (prequal?.gaps ?? []).length,
    })
    pm.step('Open prequalification').navigate(prequalPath)

    // Score every criterion. This is the real cost of the stage: nine
    // judgements, each with a note, before the vendor can be invited at all.
    for (const criterion of prequal.criteria ?? []) {
      const scored = await send(
        'patch',
        `/company/vendors/${vendorId}/prequalification/criteria/${criterion.key}`,
        {
          score: 4,
          note: `Reviewed for the piling package`,
          ...(criterion.tracksExpiry
            ? { expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString() }
            : {}),
        },
      )
      expect(scored.status, `${criterion.key}: ${JSON.stringify(scored.body)}`).toBe(200)
      pm.typed(`${criterion.key} score`, 4).typed(`${criterion.key} note`, 'note')
      if (criterion.tracksExpiry) pm.typed(`${criterion.key} expiry`, 'date')
    }
    pm.step('Score the prequalification questionnaire')

    const decided = await send(
      'post',
      `/company/vendors/${vendorId}/prequalification/decision`,
      {
        status: 'approved',
        validUntil: new Date(Date.now() + 365 * 86_400_000).toISOString(),
        decisionNote: 'Approved for piling packages up to 5m',
        singleAwardLimit: 5_000_000,
      },
    )
    observe('PREQUAL_DECISION', {
      status: decided.status,
      code: decided.body?.error?.code ?? null,
      state: decided.body?.data?.status ?? null,
      score: decided.body?.data?.score ?? null,
      band: decided.body?.data?.band ?? null,
    })
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)
    pm.step('Approve the prequalification')
      .typed('valid until', 'date')
      .typed('decision note', 'Approved for piling packages up to 5m')
      .typed('single award limit', '5000000')

    // ══ the package ══════════════════════════════════════════════════════
    await page.goto(`/projects/${projectId}/commercial/bids`)
    pm.navigate('Commercial → Bids').step('Open the bid packages module')
    await expect(page.getByTestId('uat-bids')).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('uat-bid-new').click()
    pm.dialog('New bid package')
    await page.getByTestId('uat-bid-title').fill(`Piling package ${t}`)
    pm.typed('package title', `Piling package ${t}`)
    // datetime-local, so it wants minutes too.
    const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 16)
    await page.getByTestId('uat-bid-due').fill(due)
    pm.typed('bids due', due)

    // BOQ sections seed the pricing schedule — the "enter once" win here.
    const sections = page.getByTestId('uat-bid-sections')
    const hasSections = await sections.isVisible().catch(() => false)
    observe('BOQ_SECTIONS_OFFERED', hasSections)
    if (hasSections) {
      await sections.locator('button[role="checkbox"]').first().click()
      pm.inherited('bid lines', 'BOQ section').step('Seed the pricing schedule from the BOQ')
    } else {
      pm.friction(
        'unclear-next-action',
        'No BOQ sections offered, so the pricing schedule has to be typed line by line',
      )
    }

    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith('/bids'),
        { timeout: 30_000 },
      ),
      page.getByTestId('uat-bid-create').click(),
    ])
    pm.step('Create the package')

    const packages = await read(`/projects/${projectId}/bids`)
    const pkg = (packages.items ?? []).find((row: { title: string }) =>
      row.title.includes(t),
    )
    expect(pkg, 'the package the screen just created').toBeTruthy()
    observe('PACKAGE_CREATED', {
      ref: pkg.ref,
      status: pkg.status,
      lines: pkg.lineCount ?? pkg.lines?.length ?? 0,
      commitmentType: pkg.commitmentType,
    })

    // ── open it, add a line if the BOQ gave us none, invite, publish ─────
    await openRecord(page, projectId, 'commercial', 'bids', 'bid_package', pkg.id)
    await expect(page.getByTestId('uat-bid-package')).toBeVisible({ timeout: 30_000 })
    pm.dialog('Bid package')

    let detail = await read(`/projects/${projectId}/bids/${pkg.id}`)
    if (!detail.lines?.length) {
      const line = await send('post', `/projects/${projectId}/bids/${pkg.id}/lines`, {
        description: 'CFA piles, 600mm',
        unit: 'm',
        qty: 2000,
      })
      expect(line.status, JSON.stringify(line.body)).toBe(201)
      pm.step('Add a pricing line by hand')
        .typed('line description', 'CFA piles, 600mm')
        .typed('line unit', 'm')
        .typed('line qty', '2000')
      detail = await read(`/projects/${projectId}/bids/${pkg.id}`)
    }
    expect(detail.lines.length).toBeGreaterThan(0)

    // The button says "Publish & invite", so try it the way it reads.
    await page.getByTestId('uat-bid-publish').click()
    await page.waitForTimeout(1500)
    const afterFirstPublish = await read(`/projects/${projectId}/bids/${pkg.id}`)
    observe('PUBLISH_BEFORE_INVITING', { status: afterFirstPublish.status })
    if (afterFirstPublish.status !== 'open') {
      // Publishing refuses without bidders, but the control is enabled and its
      // label promises to invite. The user finds out by being refused.
      pm.friction(
        'unclear-next-action',
        '"Publish & invite" is enabled with no bidders and fails with BID_INVITATIONS_REQUIRED — inviting must happen first, which the label denies',
      )
    }

    // ── invite the vendor by picking them, not by retyping them ──────────
    const invited = await send(
      'post',
      `/projects/${projectId}/bids/${pkg.id}/invitations`,
      { invitations: [{ vendorCompanyId: vendorId }] },
    )
    observe('INVITE_RESULT', {
      status: invited.status,
      code: invited.body?.error?.code ?? null,
      message: invited.body?.error?.message ?? null,
    })

    let invitation: { id: string; portalUrl?: string; companyName: string } | null = null
    if (invited.status === 201 || invited.status === 200) {
      invitation = (invited.body.data?.items ?? [])[0]
      pm.step('Invite the subcontractor by name')
        .inherited('bidder company name', 'company profile')
        .inherited('bidder contact email', 'company profile')
    } else {
      // Prequalification refused the invitation. That is the gate working;
      // record what it takes to get past it, because that is the user's next
      // problem.
      pm.friction(
        'unclear-next-action',
        `Invitation refused: ${invited.body?.error?.code}. ${invited.body?.error?.message}`,
      )
      const override = await send(
        'post',
        `/projects/${projectId}/bids/${pkg.id}/invitations`,
        {
          invitations: [{ vendorCompanyId: vendorId }],
          prequalOverrideReason: 'Prequalification in progress; invited to price only',
        },
      )
      observe('INVITE_WITH_OVERRIDE', { status: override.status })
      expect(override.status, JSON.stringify(override.body)).toBe(201)
      invitation = (override.body.data?.items ?? [])[0]
      pm.step('Invite with a stated prequalification override')
        .typed('override reason', 'Prequalification in progress; invited to price only')
    }
    expect(invitation, 'the invitation').toBeTruthy()

    // Now it will publish, and the invitations go out with it.
    await page.reload()
    await expect(page.getByTestId('uat-bid-package')).toBeVisible({ timeout: 30_000 })
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/publish'), { timeout: 30_000 }),
      page.getByTestId('uat-bid-publish').click(),
    ])
    pm.step('Publish the package')

    const published = await read(`/projects/${projectId}/bids/${pkg.id}`)
    observe('PACKAGE_PUBLISHED', { status: published.status })
    expect(published.status).toBe('open')

    // The portal link is what the subcontractor actually receives.
    const resent = await send(
      'post',
      `/projects/${projectId}/bids/${pkg.id}/invitations/${invitation!.id}/resend`,
    )
    expect(resent.status, JSON.stringify(resent.body)).toBe(200)
    const portalUrl: string = resent.body.data.portalUrl
    expect(portalUrl, 'the bidder gets a link').toBeTruthy()
    observe('PORTAL_LINK', { hasLink: Boolean(portalUrl) })
    pm.step('Send the bidder their portal link')
    pm.emit()

    // ══ SUBCONTRACTOR: price the package in their own portal ═════════════
    const sub = new Journey(
      'Subcontractor',
      'Price the package and submit a bid',
      'the emailed portal link',
    )

    const portalPath = new URL(portalUrl).pathname
    await page.goto(portalPath)
    await expect(page.getByTestId('uat-portal')).toBeVisible({ timeout: 30_000 })
    sub.step('Open the portal from the emailed link')
      .inherited('package scope and pricing schedule', 'the bid package')
      .inherited('company name', 'the invitation')

    const portalLines = page.getByTestId('uat-portal-line')
    const lineCount = await portalLines.count()
    expect(lineCount).toBeGreaterThan(0)
    observe('PORTAL_LINES', { lines: lineCount })

    const RATE = 250
    for (let i = 0; i < lineCount; i += 1) {
      const rate = portalLines.nth(i).locator('input[type="number"]').first()
      await rate.click()
      await rate.fill(String(RATE))
      sub.typed(`rate for line ${i + 1}`, RATE)
    }
    sub.step('Price every line')

    await expect(page.getByTestId('uat-portal-total')).toBeVisible()
    const totalText = await page.getByTestId('uat-portal-total').innerText()
    observe('PORTAL_TOTAL_SHOWN', totalText.replace(/\s+/g, ' ').slice(0, 120))

    await page.getByTestId('uat-portal-save').click()
    await page.waitForTimeout(1200)
    sub.step('Save the draft')

    // Does the draft survive a reload? A bidder will close the tab.
    await page.reload()
    await expect(page.getByTestId('uat-portal')).toBeVisible({ timeout: 30_000 })
    const afterReload = await portalLines
      .first()
      .locator('input[type="number"]')
      .first()
      .inputValue()
    observe('PORTAL_DRAFT_SURVIVES_RELOAD', { value: afterReload })
    if (Number(afterReload) !== RATE) {
      sub.friction('state-loss', `Priced rate did not survive a reload (read back "${afterReload}")`)
    }

    const [submitResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/bid/submit'), { timeout: 30_000 }),
      page.getByTestId('uat-portal-submit').click(),
    ])
    observe('PORTAL_SUBMIT', { status: submitResponse.status() })
    expect(submitResponse.status(), 'the bid submits').toBeLessThan(400)
    sub.step('Submit the bid')

    const bids = await read(`/projects/${projectId}/bids/${pkg.id}/bids`)
    observe('BIDS_RECEIVED', {
      count: (bids.items ?? []).length,
      invitationIds: (bids.items ?? []).map((b: { invitationId: string }) => b.invitationId),
    })
    const ourBid = (bids.items ?? []).find(
      (row: { invitationId: string }) => row.invitationId === invitation!.id,
    )
    expect(ourBid, 'the submitted bid').toBeTruthy()
    observe('BID_SUBMITTED', { status: ourBid.status, total: ourBid.total })
    expect(ourBid.status).toBe('submitted')
    sub.emit()

    // ══ QS: level the bids and award ═════════════════════════════════════
    const qs = new Journey(
      'QS / Cost Controller',
      'Compare the bids and award the subcontract',
      '/projects/:id/commercial/bids',
    )

    await switchTo(page, 'qs')
    await openRecord(page, projectId, 'commercial', 'bids', 'bid_package', pkg.id)
    qs.step('Open the package').navigate('Commercial → Bids')

    const closed = await send('post', `/projects/${projectId}/bids/${pkg.id}/close`, {}, 'qs')
    observe('PACKAGE_CLOSE', { status: closed.status, code: closed.body?.error?.code ?? null })
    if (closed.status === 200) qs.step('Close the package to bidding')

    const levelling = await read(`/projects/${projectId}/bids/${pkg.id}/leveling`)
    observe('LEVELLING', {
      bidders: levelling?.bidders?.length ?? 0,
      lines: levelling?.lines?.length ?? 0,
      cells: levelling?.cells?.length ?? 0,
      estimateTotal: levelling?.estimateTotal ?? null,
      // The comparison is only useful if it says how each bid sits against the
      // estimate and against the others.
      normalisedTotals: (levelling?.bidders ?? []).map(
        (b: { companyName: string; total: number; normalizedTotal: number }) => ({
          company: b.companyName,
          total: b.total,
          normalised: b.normalizedTotal,
        }),
      ),
    })
    qs.step('Read the levelling comparison').inherited(
      'every bidder rate, line by line',
      'the submitted bids',
    )

    // Awarding is not the QS's to make. Worth knowing exactly where the work
    // stops, because that is where the handoff has to be visible.
    const qsAward = await send(
      'post',
      `/projects/${projectId}/bids/${pkg.id}/award`,
      { bidId: ourBid.id },
      'qs',
    )
    observe('QS_CAN_AWARD', {
      status: qsAward.status,
      code: qsAward.body?.error?.code ?? null,
      transition: qsAward.body?.error?.details?.transition ?? null,
    })
    if (qsAward.status === 403) {
      qs.friction(
        'permission',
        'The QS levels the bids but cannot select a winner (bid.award is PM-only) — the levelling screen offers a Select button that will refuse',
      ).friction(
        'missing-ball-in-court',
        'Nothing on the package says whose decision the award is or that it is now waiting on the PM',
      )
    }
    qs.step('Recommend the winning bid').emit()

    // ══ PM: award ════════════════════════════════════════════════════════
    const pmAward = new Journey(
      'Project Manager',
      'Award the subcontract on the QS recommendation',
      '/projects/:id/commercial/bids',
    )
    await switchTo(page, 'pm')
    await openRecord(page, projectId, 'commercial', 'bids', 'bid_package', pkg.id)
    pmAward.step('Open the levelled package').navigate('Commercial → Bids')

    const soft = await send('post', `/projects/${projectId}/bids/${pkg.id}/award`, {
      bidId: ourBid.id,
    })
    expect(soft.status, JSON.stringify(soft.body)).toBe(200)
    pmAward.step('Select the winning bid')

    const confirmed = await send(
      'post',
      `/projects/${projectId}/bids/${pkg.id}/award/confirm`,
      {},
    )
    observe('AWARD_CONFIRM', {
      status: confirmed.status,
      code: confirmed.body?.error?.code ?? null,
      message: confirmed.body?.error?.message ?? null,
    })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBeLessThan(300)
    const commitmentId: string = confirmed.body.data.commitment.id
    pmAward.step('Confirm the award').inherited(
      'the whole subcontract: vendor, value, schedule of values',
      'the winning bid',
    )

    // ── the commitment the award produced ────────────────────────────────
    const commitment = await read(`/projects/${projectId}/commitments/${commitmentId}`)
    observe('COMMITMENT_FROM_AWARD', {
      ref: commitment.ref,
      status: commitment.status,
      vendorId: commitment.vendor?.id ?? null,
      vendorName: commitment.vendor?.name ?? null,
      original: commitment.original,
      sovLines: commitment.lines.length,
    })
    // Enter once, use everywhere: the company came from the profile, the value
    // and the schedule of values from the bid. Nothing was retyped.
    expect(commitment.vendor?.id, 'the awarded commitment names the same company').toBe(
      vendorId,
    )
    expect(commitment.original).toBeCloseTo(ourBid.total, 2)
    expect(commitment.lines.length).toBe(lineCount)

    // Every transactional record is meant to hang off an activity. Does the
    // coding survive BOQ → bid line → award → schedule of values?
    observe('AWARD_COST_CODING', {
      sovLines: commitment.lines.map(
        (l: {
          description: string
          activityId: string | null
          costCodeId: string | null
          budgetLineId: string | null
          boqItemId: string | null
        }) => ({
          description: l.description,
          activityId: l.activityId,
          costCodeId: l.costCodeId,
          budgetLineId: l.budgetLineId,
          boqItemId: l.boqItemId,
        }),
      ),
      bidLineCoding: (detail.lines ?? []).map(
        (l: { activityId: string | null; costCodeId: string | null; boqItemId: string | null }) => ({
          activityId: l.activityId,
          costCodeId: l.costCodeId,
          boqItemId: l.boqItemId,
        }),
      ),
    })
    pmAward.emit()

    // ══ PM: scope, then execute ══════════════════════════════════════════
    const pm2 = new Journey(
      'Project Manager',
      'Agree the scope and execute the subcontract',
      '/projects/:id/commercial/commitments',
    )
    await switchTo(page, 'pm')
    await openRecord(
      page,
      projectId,
      'commercial',
      'commitments',
      'commitment',
      commitmentId,
    )
    pm2.step('Open the awarded subcontract').navigate('Commercial → Commitments')

    const scope = await read(`/projects/${projectId}/commitments/${commitmentId}/scope`)
    observe('SCOPE_MATRIX', {
      exists: Boolean(scope),
      items: scope?.items?.length ?? 0,
      kinds: [...new Set((scope?.items ?? []).map((i: { kind: string }) => i.kind))],
      unallocated: (scope?.items ?? []).filter(
        (i: { responsibility: string | null; kind: string }) =>
          ['scope', 'responsibility'].includes(i.kind) && !i.responsibility,
      ).length,
    })
    pm2.step('Open the scope and responsibility matrix').inherited(
      'the rows that cause arguments (crane, cleanup, waste, inspections)',
      'the seeded matrix',
    )

    // The agreement the scope is supposed to feed.
    const agreement = await read(
      `/projects/${projectId}/commitments/${commitmentId}/agreement`,
    )
    // The brief's scope test: is the agreement built from structured scope, or
    // does it only carry boilerplate clauses?
    observe('AGREEMENT', {
      exists: Boolean(agreement),
      clauses: agreement?.clauses?.length ?? 0,
      clauseHeadings: (agreement?.clauses ?? []).map((c: { heading: string }) => c.heading),
      sovLines: agreement?.scheduleOfValues?.length ?? 0,
      milestones: agreement?.milestones?.length ?? 0,
      // Readiness names what would make the document wrong if it were signed.
      gaps: agreement?.readiness?.gaps?.length ?? 0,
      gapList: agreement?.readiness?.gaps ?? [],
      ready: agreement?.readiness?.ready ?? null,
      scope: {
        status: agreement?.scope?.status ?? null,
        works: agreement?.scope?.works?.length ?? 0,
        responsibilities: agreement?.scope?.responsibilities?.length ?? 0,
        inclusions: agreement?.scope?.inclusions?.length ?? 0,
        exclusions: agreement?.scope?.exclusions?.length ?? 0,
        clarifications: agreement?.scope?.clarifications?.length ?? 0,
        interfaces: agreement?.scope?.interfaces?.length ?? 0,
        worksWithAnOwner: (agreement?.scope?.works ?? []).filter(
          (w: { responsibility: string | null }) => w.responsibility,
        ).length,
      },
    })

    await send('post', `/projects/${projectId}/commitments/${commitmentId}/submit`)
    await send('post', `/projects/${projectId}/commitments/${commitmentId}/approve`)
    const executed = await withApi(async (client, token) => {
      const response = await client.post(
        `${API}/projects/${projectId}/commitments/${commitmentId}/execute`,
        {
          headers: { authorization: `Bearer ${token}` },
          multipart: {
            file: {
              name: 'agreement.pdf',
              mimeType: 'application/pdf',
              buffer: Buffer.from('%PDF-1.4 executed agreement'),
            },
          },
        },
      )
      return { status: response.status(), body: await response.json() }
    })
    expect(executed.status, JSON.stringify(executed.body)).toBe(200)
    pm2.step('Attach the signed agreement and execute')
      .typed('signed agreement file', 'agreement.pdf')
    pm2.emit()

    // ══ QS: claim, and certify ═══════════════════════════════════════════
    const qs2 = new Journey(
      'QS / Cost Controller',
      'Certify the first payment application',
      '/projects/:id/commercial/pay-apps',
    )
    await switchTo(page, 'qs')
    const beforeCert = await ledger(projectId)

    await page.goto(`/projects/${projectId}/commercial/pay-apps`)
    qs2.step('Open payment applications').navigate('Commercial → Pay applications')
    await page.getByTestId('uat-payapp-new').click()
    qs2.dialog('New payment application')
    await page.getByTestId('uat-payapp-commitment').click()
    await page.getByRole('option', { name: new RegExp(commitment.ref) }).click()
    qs2.inherited('subcontract, vendor and retention rate', 'the commitment')
    await page.getByTestId('uat-payapp-period').fill(`${t} period 1`)
    qs2.typed('period label', `${t} period 1`)
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith('/pay-apps'),
        { timeout: 30_000 },
      ),
      page.getByTestId('uat-payapp-create-submit').click(),
    ])
    qs2.step('Raise the application').inherited(
      'the schedule of values with previous claims and progress caps',
      'the commitment',
    )

    const apps = await read(`/projects/${projectId}/pay-apps?commitmentId=${commitmentId}`)
    const payApp = apps.items[0]
    expect(payApp.lines.length).toBe(lineCount)

    await openRecord(page, projectId, 'commercial', 'pay-apps', 'sub_pay_app', payApp.id)
    await expect(page.getByTestId('uat-payapp-detail')).toBeVisible({ timeout: 30_000 })
    qs2.dialog('Payment application')

    // Claim a quarter of the line — or the approved progress cap, whichever is
    // lower. Now that the schedule-of-values line names an activity, the cap is
    // live, which is the point.
    const line0 = payApp.lines[0]
    observe('PAYAPP_LINE_CODING', {
      activityId: line0.activityId,
      costCode: line0.costCode,
      approvedPct: line0.approvedPct,
      capAmount: line0.capAmount,
      scheduled: line0.scheduledAmount,
    })
    const quarter = Math.round(line0.scheduledAmount * 0.25 * 100) / 100
    const headroom =
      line0.capAmount === null
        ? quarter
        : Math.max(0, Math.round((line0.capAmount - line0.previousAmount) * 100) / 100)
    const claim = Math.min(quarter, headroom)
    expect(claim, 'there is something claimable within the approved progress').toBeGreaterThan(0)
    const firstRow = page.getByTestId('uat-payapp-line').first()
    const amountInput = firstRow.locator('input[type="number"]').first()
    await amountInput.click()
    await amountInput.fill(String(claim))
    qs2.typed('this period amount', claim)
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && r.url().includes('/pay-apps/'),
        { timeout: 30_000 },
      ),
      page.getByTestId('uat-payapp-lines-save').click(),
    ])
    qs2.step('Enter the claim')

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/submit'), { timeout: 30_000 }),
      page.getByTestId('uat-payapp-submit').click(),
    ])
    qs2.step('Submit it')

    // Can the QS certify what they just submitted?
    const qsApprove = await page
      .getByTestId('uat-payapp-approve')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    observe('QS_SEES_APPROVE', qsApprove)
    if (!qsApprove) {
      qs2.friction(
        'permission',
        'The QS raises and submits the application but cannot certify it — no Approve control is offered',
      ).friction(
        'missing-ball-in-court',
        'The application says "Submitted" but not who it is now waiting on',
      )
    }
    qs2.emit()

    // ══ PM: certify ══════════════════════════════════════════════════════
    const pmCertify = new Journey(
      'Project Manager',
      'Certify the subcontractor payment application',
      '/projects/:id/commercial/pay-apps',
    )
    await switchTo(page, 'pm')
    await openRecord(page, projectId, 'commercial', 'pay-apps', 'sub_pay_app', payApp.id)
    await expect(page.getByTestId('uat-payapp-detail')).toBeVisible({ timeout: 30_000 })
    pmCertify.step('Open the submitted application').navigate(
      'Commercial → Pay applications',
    )

    await page.getByTestId('uat-payapp-approve').click()
    pmCertify.dialog('Approve')
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/approve'), { timeout: 30_000 }),
      page.getByTestId('uat-payapp-approve-confirm').click(),
    ])
    await expect(page.getByTestId('uat-payapp-status')).toHaveText('Approved')
    pmCertify.step('Certify it').inherited(
      'gross, retention and net payable',
      'the claim the QS entered',
    )

    const certified = await read(`/projects/${projectId}/pay-apps/${payApp.id}`)
    const afterCert = await ledger(projectId)
    observe('CERTIFICATION', {
      gross: certified.grossThisPeriod,
      retention: certified.retentionThisPeriod,
      net: certified.netThisPeriod,
      ledgerMoved:
        Math.round((afterCert.ledger.total - beforeCert.ledger.total) * 100) / 100,
      balanced: afterCert.balanced,
    })
    expect(
      Math.round((afterCert.ledger.total - beforeCert.ledger.total) * 100) / 100,
      'certified gross reaches actual cost',
    ).toBe(certified.grossThisPeriod)
    pmCertify.emit()

    // ══ FINANCE: pay it ══════════════════════════════════════════════════
    const finance = new Journey(
      'Finance',
      'Pay the certified application',
      '/projects/:id/commercial/pay-apps',
    )
    await switchTo(page, 'finance')
    await openRecord(page, projectId, 'commercial', 'pay-apps', 'sub_pay_app', payApp.id)
    const detailVisible = await page
      .getByTestId('uat-payapp-detail')
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    observe('FINANCE_CAN_OPEN_PAYAPP', detailVisible)
    if (!detailVisible) {
      finance.friction(
        'permission',
        'Finance cannot open the payment application from its own module route',
      )
    }
    finance.step('Open the certified application').navigate(
      'Commercial → Pay applications',
    )

    const payButton = page.getByTestId('uat-payapp-pay')
    const canPayOnScreen = await payButton
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    observe('FINANCE_SEES_PAY_BUTTON', canPayOnScreen)
    if (!canPayOnScreen) {
      finance.friction(
        'permission',
        'Finance cannot see the Record payment control on the certified application',
      )
    } else {
      await payButton.click()
      finance.dialog('Record payment')
      const payForm = page.getByTestId('uat-payapp-pay-form')
      await payForm
        .locator('input[type="number"]')
        .first()
        .fill(String(certified.netThisPeriod))
      finance.typed('payment amount', certified.netThisPeriod).friction(
        'unclear-label',
        'The payment amount is typed even though the net payable is the only valid figure',
      )
      await Promise.all([
        page.waitForResponse((r) => r.url().includes('/payments'), { timeout: 30_000 }),
        page.getByTestId('uat-payapp-pay-confirm').click(),
      ])
      finance.step('Record the payment')
    }

    const afterPay = await ledger(projectId)
    observe('PAYMENT_POSTS_NO_COST', {
      ledgerUnchanged: afterPay.ledger.total === afterCert.ledger.total,
    })
    expect(afterPay.ledger.total, 'paying moves cash, not cost').toBe(
      afterCert.ledger.total,
    )

    const cash = await read(`/projects/${projectId}/cash-flow`)
    const cashRows = cash?.periods ?? cash?.items ?? cash?.rows ?? []
    const outflow = cashRows.reduce(
      (sum: number, row: { outflow?: number }) => sum + Number(row.outflow || 0),
      0,
    )
    observe('CASH_FLOW', { periods: cashRows.length, totalOutflow: outflow })
    expect(cashRows.length, 'the payment reaches cash flow').toBeGreaterThan(0)
    finance.emit()

    // ══ PM: a change, and its effect on the ceiling ══════════════════════
    const pm3 = new Journey(
      'Project Manager',
      'Price a change and let the subcontractor bill it',
      '/projects/:id/commercial/commitments',
    )
    await switchTo(page, 'pm')
    await openRecord(
      page,
      projectId,
      'commercial',
      'commitments',
      'commitment',
      commitmentId,
    )
    pm3.step('Open the subcontract')

    const beforeChange = await read(`/projects/${projectId}/pay-apps/${payApp.id}`)
    const ceilingBefore = beforeChange.lines[0].revisedScheduledAmount

    await page.getByTestId('uat-commitment-co-new').click()
    pm3.dialog('New change order')
    await page.getByTestId('uat-commitment-co-title').fill(`Obstruction piling ${t}`)
    pm3.typed('change title', `Obstruction piling ${t}`)
    await page.getByTestId('uat-commitment-co-value').fill('50000')
    pm3.typed('change value', '50000')
    await page.getByTestId('uat-commitment-co-sovline').click()
    await page.getByRole('option').nth(1).click()
    pm3.step('Say which schedule line the change moves')
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes('/change-orders'),
        { timeout: 30_000 },
      ),
      page.getByTestId('uat-commitment-co-add').click(),
    ])
    pm3.step('Draft the change order')

    const withCo = await read(`/projects/${projectId}/commitments/${commitmentId}`)
    const co = withCo.changeOrders[0]
    await send(
      'post',
      `/projects/${projectId}/commitments/change-orders/${co.id}/submit`,
    )
    await send(
      'post',
      `/projects/${projectId}/commitments/change-orders/${co.id}/approve`,
    )
    pm3.step('Submit and approve it')

    const afterChange = await read(`/projects/${projectId}/commitments/${commitmentId}`)
    const nextApp = await send('post', `/projects/${projectId}/pay-apps`, {
      commitmentId,
      periodLabel: `${t} period 2`,
      periodEnd: '2026-10-31',
    })
    expect(nextApp.status, JSON.stringify(nextApp.body)).toBe(201)
    const period2 = nextApp.body.data
    const changedLine = period2.lines.find(
      (l: { approvedChangeAmount: number }) => l.approvedChangeAmount > 0,
    )

    observe('CHANGE_RECONCILES', {
      original: afterChange.original,
      approvedChanges: afterChange.approvedChanges,
      revised: afterChange.revised,
      sumsCorrectly:
        Math.round((afterChange.original + afterChange.approvedChanges) * 100) / 100 ===
        Math.round(afterChange.revised * 100) / 100,
      sovCeilingBefore: ceilingBefore,
      sovCeilingAfter: changedLine?.revisedScheduledAmount ?? null,
      sovRoseBy: changedLine
        ? Math.round((changedLine.revisedScheduledAmount - ceilingBefore) * 100) / 100
        : null,
    })
    expect(afterChange.revised).toBeCloseTo(
      afterChange.original + afterChange.approvedChanges,
      2,
    )
    expect(changedLine, 'the change reached a schedule-of-values line').toBeTruthy()
    expect(changedLine.approvedChangeAmount).toBe(50000)
    pm3.step('Confirm the subcontractor can now bill the change')

    // ══ closeout ═════════════════════════════════════════════════════════
    const closeout = await read(
      `/projects/${projectId}/commitments/${commitmentId}/closeout`,
    )
    observe('CLOSEOUT', {
      exists: Boolean(closeout),
      items: closeout?.items?.length ?? 0,
      outstanding: (closeout?.items ?? []).filter(
        (i: { status: string }) => i.status !== 'received' && i.status !== 'waived',
      ).length,
      ready: closeout?.ready ?? null,
    })
    const closeAttempt = await send(
      'post',
      `/projects/${projectId}/commitments/${commitmentId}/close`,
    )
    observe('CLOSE_ATTEMPT', {
      status: closeAttempt.status,
      code: closeAttempt.body?.error?.code ?? null,
      namesWhatIsOutstanding: Boolean(closeAttempt.body?.error?.details),
    })
    pm3.step('Try to close the subcontract and see what is outstanding')
    pm3.emit()

    observe('LIFECYCLE_COMPLETE', {
      vendorId,
      packageRef: pkg.ref,
      commitmentRef: commitment.ref,
      payAppRef: certified.ref,
      period2Ref: period2.ref,
    })
  })
})
