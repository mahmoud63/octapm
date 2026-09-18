import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import QualityHomeScreen from '../../../app/(app)/quality/index'
import InspectionScreen, { isDeficient } from '../../../app/(app)/quality/inspections/[id]'
import InspectionsScreen from '../../../app/(app)/quality/inspections/index'
import NewInspectionScreen from '../../../app/(app)/quality/inspections/new'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { FormInstance } from '@/api/quality-types'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, failure, fakeServer, type Call } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { dashboard, formInstance, formList, pmQuality, punchItem, siteEngineerQuality, templates } from '@/testing/fixtures-quality'
import { activities } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let current: FormInstance

const serve = (permissions: PermissionMatrix = pmQuality, instance: FormInstance = formInstance()) => {
  current = instance
  calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/quality/dashboard': () => ({ status: 200, body: envelope(dashboard) }),
    'GET /projects/p1/forms/templates': () => ({ status: 200, body: envelope({ items: templates }) }),
    'GET /projects/p1/forms': () => ({ status: 200, body: envelope(formList()) }),
    'GET /projects/p1/forms/f1': () => ({ status: 200, body: envelope(current) }),
    'GET /projects/p1/team': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/locations': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope(activities) }),
    'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }),
    'POST /projects/p1/forms': (call) => {
      const body = call.body as Record<string, unknown>
      return { status: 201, body: envelope(formInstance({ id: 'f9', ref: 'ITP-009', title: String(body.title ?? 'Concrete pour ITP'), status: body.startNow ? 'in_progress' : 'scheduled' })) }
    },
    'PUT /projects/p1/forms/f1/responses': (call) => {
      const { responses } = call.body as { responses: { itemId: string; value: unknown; note?: string }[] }
      current = { ...current, sections: current.sections.map((s) => ({ ...s, items: s.items.map((i) => { const r = responses.find((x) => x.itemId === i.id); return r ? { ...i, response: { id: `r-${i.id}`, itemId: i.id, value: r.value as string, note: r.note ?? null } } : i }) })) }
      return { status: 200, body: envelope(current) }
    },
    'POST /projects/p1/forms/f1/complete': () => {
      const missing = current.sections.flatMap((s) => s.items).filter((i) => i.required && !i.response)
      if (missing.length) return { status: 422, body: { success: false, error: { code: 'FORM_INCOMPLETE', message: 'The form is incomplete', details: { problems: missing.map((i) => ({ itemId: i.id, label: i.label, message: `${i.label} has no answer` })) } } } }
      current = { ...current, status: 'complete', outcome: current.sections.flatMap((s) => s.items).some((i) => i.response?.value === 'fail') ? 'fail' : 'pass', completedAt: '2026-09-18T08:00:00.000Z' }
      return { status: 200, body: envelope(current) }
    },
    'POST /projects/p1/forms/f1/close': () => {
      current = { ...current, status: 'closed', closedAt: '2026-09-18T09:00:00.000Z' }
      return { status: 200, body: envelope(current) }
    },
    'POST /projects/p1/forms/f1/items/i2/deficiency': (call) => ({ status: 201, body: envelope({ record: punchItem({ id: 'pi7', ref: 'PL-013', title: String((call.body as { title: string }).title), sourceRecordType: 'form_instance', sourceRecordId: 'f1' }), instance: current }) }),
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'f1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('quality home', () => {
  it("shows the server's score and counts, and a door to each module the person may read", async () => {
    serve()
    await renderScreen(<QualityHomeScreen />)
    expect(await screen.findByText('57')).toBeTruthy()
    expect(screen.getByText('6 ✓ 1 ✗')).toBeTruthy()
    for (const door of ['inspections', 'punch', 'observations', 'ncr', 'safety', 'tests']) expect(screen.getByTestId(`quality-${door}`)).toBeTruthy()
  })

  it('hides the doors a role may not read', async () => {
    serve(siteEngineerQuality)
    await renderScreen(<QualityHomeScreen />)
    await screen.findByTestId('quality-inspections')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.getByTestId('quality-ncr')).toBeTruthy()
    expect(screen.getByTestId('quality-safety')).toBeTruthy()
  })
})

describe('the inspection list', () => {
  it('lists the forms with their outcome and lets the person start a new one', async () => {
    serve()
    await renderScreen(<InspectionsScreen />)
    expect(await screen.findByText('Concrete pour ITP · Raft grid A-D')).toBeTruthy()
    expect(screen.getByText('Blockwork level 2')).toBeTruthy()
    expect(screen.getByTestId('inspection-new')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('inspections-chip-mine'))
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/forms' && c.query.ballInCourtUserId === 'me')).toBe(true))
  })
})

describe('starting an inspection', () => {
  it('creates the instance from a template with a replay key and opens the checklist', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    const router = useRouter() as unknown as { replace: jest.Mock }
    await renderScreen(<NewInspectionScreen />)
    expect(await screen.findByTestId('inspection-create')).toBeTruthy()
    expect(screen.getByTestId('inspection-create').props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(screen.getByTestId('inspection-template'))
    await fireEvent.press(await screen.findByTestId('inspection-template-option-t1'))
    expect(await screen.findByText('Check every item before the pour is released.')).toBeTruthy()
    await fireEvent.changeText(screen.getByTestId('inspection-title'), 'Raft pour, grid A-D')
    await fireEvent.press(screen.getByTestId('inspection-create'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/forms')).toBe(true))
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/projects/p1/forms')!.body as Record<string, unknown>
    expect(sent).toMatchObject({ templateId: 't1', title: 'Raft pour, grid A-D', startNow: true })
    expect(String(sent.clientRequestId)).toMatch(/[0-9a-f-]{20,}/)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/quality/inspections/f9'))
  })
})

describe('the checklist', () => {
  it('knows which answers are deficient', () => {
    const item = formInstance().sections[0]!.items[0]!
    expect(isDeficient(item, 'fail')).toBe(true)
    expect(isDeficient(item, 'pass')).toBe(false)
    expect(isDeficient({ ...item, responseType: 'yes_no' }, 'no')).toBe(true)
    expect(isDeficient({ ...item, responseType: 'number' }, 0)).toBe(false)
  })

  it('shows the items with the saved answers and the open hold point', async () => {
    serve()
    await renderScreen(<InspectionScreen />)
    expect(await screen.findByText('Formwork clean and oiled *')).toBeTruthy()
    expect(screen.getByText('1 of 3 answered')).toBeTruthy()
    expect(screen.getByText('1 hold point open')).toBeTruthy()
    expect(screen.getByTestId('item-i1-pass').props.accessibilityState?.selected).toBe(true)
    expect(screen.getByTestId('action-complete')).toBeTruthy()
    expect(screen.queryByTestId('action-save')).toBeNull()
  })

  it('saves the answers in one request and then completes through the complete route', async () => {
    serve()
    await renderScreen(<InspectionScreen />)
    await fireEvent.press(await screen.findByTestId('item-i2-pass'))
    await fireEvent.changeText(screen.getByTestId('item-i3-value'), '110')
    await fireEvent.changeText(screen.getByTestId('item-i3-note'), 'Truck 3')
    await fireEvent.press(screen.getByTestId('action-save'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path.endsWith('/responses'))).toBe(true))
    const sent = calls.find((c) => c.method === 'PUT')!.body as { responses: unknown[] }
    expect(sent.responses).toEqual(expect.arrayContaining([{ itemId: 'i1', value: 'pass' }, { itemId: 'i2', value: 'pass' }, { itemId: 'i3', value: 110, note: 'Truck 3' }]))
    expect(await screen.findByText('3 of 3 answered')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('action-complete'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/complete'))).toBe(true))
    expect(await screen.findByText('Outcome: Pass')).toBeTruthy()
    // Complete: the PM may close it; nobody may edit it.
    expect(screen.getByTestId('action-close')).toBeTruthy()
    expect(screen.queryByTestId('action-complete')).toBeNull()
  })

  it("lists what the server still needs when completion is refused", async () => {
    serve()
    await renderScreen(<InspectionScreen />)
    await fireEvent.press(await screen.findByTestId('action-complete'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/complete'))).toBe(true))
    expect(await screen.findByText('• Rebar cover to drawing has no answer')).toBeTruthy()
    expect(screen.getByTestId('inspection-failure').props.children).toBe('The checklist is not complete yet.')
  })

  it('raises a punch item from a failed item and goes to it', async () => {
    serve()
    const router = useRouter() as unknown as { push: jest.Mock }
    await renderScreen(<InspectionScreen />)
    await fireEvent.press(await screen.findByTestId('item-i2-fail'))
    await fireEvent.press(screen.getByTestId('item-i2-deficiency'))
    await fireEvent.changeText(await screen.findByTestId('prompt-deficiency-input'), 'Cover 35 mm at the east face')
    await fireEvent.press(screen.getByTestId('prompt-deficiency-confirm'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/items/i2/deficiency'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/deficiency'))!.body).toMatchObject({ target: 'punch_item', title: 'Rebar cover to drawing', description: 'Cover 35 mm at the east face' })
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quality/punch/pi7'))
  })

  it('a site engineer may answer and complete but not close or void', async () => {
    serve(siteEngineerQuality)
    await renderScreen(<InspectionScreen />)
    await screen.findByTestId('action-complete')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('action-void')).toBeNull()
    expect(screen.getByTestId('item-i3-value').props.editable).toBe(true)
  })

  it('shows the server error when saving fails', async () => {
    serve()
    calls = fakeServer({ 'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmQuality) }), 'GET /projects/p1/forms/f1': () => ({ status: 200, body: envelope(current) }), 'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }), 'PUT /projects/p1/forms/f1/responses': () => failure(422, 'FORM_LOCKED', 'This form is locked', 'req-42') })
    await renderScreen(<InspectionScreen />)
    await fireEvent.press(await screen.findByTestId('item-i2-pass'))
    await fireEvent.press(screen.getByTestId('action-save'))
    expect(await screen.findByTestId('inspection-failure')).toBeTruthy()
    expect(screen.getByTestId('inspection-failure').props.children).toMatch(/locked/i)
  })
})
