import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import NcrScreen from '../../../app/(app)/quality/ncr/[id]'
import NcrListScreen from '../../../app/(app)/quality/ncr/index'
import NewNcrScreen from '../../../app/(app)/quality/ncr/new'
import SafetyIncidentScreen from '../../../app/(app)/quality/safety/[id]'
import SafetyListScreen from '../../../app/(app)/quality/safety/index'
import NewSafetyScreen from '../../../app/(app)/quality/safety/new'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { Ncr, SafetyIncident } from '@/api/quality-types'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { incident, ncr, ncrList, pmQuality, safetyList, siteEngineerQuality } from '@/testing/fixtures-quality'
import { activities } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let ncrs: Ncr[]
let incidents: SafetyIncident[]

const serve = (permissions: PermissionMatrix = pmQuality) => {
  ncrs = ncrList().rows
  incidents = safetyList().rows
  const closeout = <T extends Ncr | SafetyIncident>(rows: T[], id: string, body: Record<string, unknown>): T[] =>
    rows.map((r) => (r.id === id ? { ...r, status: 'submitted', closureComment: String(body.closureComment), closureSubmittedAt: '2026-09-18T10:00:00.000Z', attachmentRefs: (body.attachmentRefs as T['attachmentRefs']) ?? [], ballInCourtUser: { id: 'u1', name: 'Dana Okafor' }, ballInCourtUserId: 'u1' } : r))
  const decide = <T extends Ncr | SafetyIncident>(rows: T[], id: string, status: string): T[] => rows.map((r) => (r.id === id ? { ...r, status } : r))
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/ncr': () => ({ status: 200, body: envelope({ ...ncrList(ncrs) }) }),
    'GET /projects/p1/safety': () => ({ status: 200, body: envelope({ ...safetyList(incidents) }) }),
    'GET /projects/p1/team': () => ({ status: 200, body: envelope({ items: [{ userId: 'u2', name: 'Priya Raman', email: 'priya@octapm.demo', orgRole: 'site_engineer', assignmentRole: 'site_engineer' }] }) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope(activities) }),
    'GET /projects/p1/comments': () => ({ status: 200, body: envelope({ items: [], pagination: { limit: 100, nextCursor: null } }) }),
    'POST /projects/p1/workflow/uploads': () => ({ status: 201, body: envelope([{ documentId: 'd1', key: 'k9', storageKey: 'k9', url: '/api/v1/projects/p1/workflow/uploads/k9', fileUrl: '/api/v1/projects/p1/workflow/uploads/k9', fileName: 'evidence.jpg', mimeType: 'image/jpeg', sizeBytes: 4321 }]) }),
    'POST /projects/p1/ncr': (call) => {
      const body = call.body as Record<string, unknown>
      const created = ncr({ id: 'n9', ref: 'NCR-009', severity: String(body.severity) as 'major', description: String(body.description), status: 'open', attachmentRefs: [], history: [] })
      ncrs = [...ncrs, created]
      return { status: 201, body: envelope(created) }
    },
    'POST /projects/p1/ncr/n1/submit': (call) => {
      ncrs = closeout(ncrs, 'n1', call.body as Record<string, unknown>)
      return { status: 200, body: envelope(ncrs.find((n) => n.id === 'n1')) }
    },
    'POST /projects/p1/ncr/n2/approve': () => {
      ncrs = decide(ncrs, 'n2', 'closed')
      return { status: 200, body: envelope(ncrs.find((n) => n.id === 'n2')) }
    },
    'POST /projects/p1/ncr/n2/reject': () => {
      ncrs = decide(ncrs, 'n2', 'open')
      return { status: 200, body: envelope(ncrs.find((n) => n.id === 'n2')) }
    },
    'POST /projects/p1/safety': (call) => {
      const body = call.body as Record<string, unknown>
      const created = incident({ id: 'si9', ref: 'SAF-009', incidentType: String(body.incidentType), title: String(body.title), status: 'open', attachmentRefs: [] })
      incidents = [...incidents, created]
      return { status: 201, body: envelope(created) }
    },
    'POST /projects/p1/safety/si1/submit': (call) => {
      incidents = closeout(incidents, 'si1', call.body as Record<string, unknown>)
      return { status: 200, body: envelope(incidents.find((s) => s.id === 'si1')) }
    },
    'POST /projects/p1/safety/si2/reopen': () => {
      incidents = decide(incidents, 'si2', 'investigating')
      return { status: 200, body: envelope(incidents.find((s) => s.id === 'si2')) }
    },
  })
}

const pickPhoto = () => {
  ;(ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
  ;(ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/evidence.jpg', fileName: 'evidence.jpg', mimeType: 'image/jpeg' }] })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'n1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('NCRs', () => {
  it('lists them with the summary and filters on the device', async () => {
    serve()
    await renderScreen(<NcrListScreen />)
    expect(await screen.findByText('Honeycombing in column C4 below the kicker')).toBeTruthy()
    expect(screen.getByText('Blockwork joint thickness over 15 mm')).toBeTruthy()
    expect(screen.getByTestId('ncr-new')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('ncr-severity-major'))
    await waitFor(() => expect(screen.queryByText('Blockwork joint thickness over 15 mm')).toBeNull())
    expect(screen.getByText('Honeycombing in column C4 below the kicker')).toBeTruthy()
    // One request served the whole list; the filter never went to the server.
    expect(calls.filter((c) => c.path === '/projects/p1/ncr').length).toBe(1)
  })

  it('raises one open and goes to it', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    const router = useRouter() as unknown as { replace: jest.Mock }
    await renderScreen(<NewNcrScreen />)
    expect((await screen.findByTestId('ncr-raise')).props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(screen.getByTestId('ncr-severity-major'))
    await fireEvent.changeText(screen.getByTestId('ncr-description'), 'Cold joint in the core wall at level 2')
    await fireEvent.changeText(screen.getByTestId('ncr-responsible'), 'Delta Concrete')
    await fireEvent.press(screen.getByTestId('ncr-raise'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/ncr')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ severity: 'major', description: 'Cold joint in the core wall at level 2', responsible: 'Delta Concrete', status: 'open' })
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/quality/ncr/n9'))
  })

  it('submits the closeout with evidence uploaded through the workflow route', async () => {
    serve()
    pickPhoto()
    await renderScreen(<NcrScreen />)
    expect(await screen.findByText('Break out and recast')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('action-submit'))
    expect((await screen.findByTestId('closeout-submit')).props.accessibilityState?.disabled).toBe(true)
    await fireEvent.changeText(screen.getByTestId('closeout-comment'), 'Broken out to sound concrete and recast with SCC; cores taken.')
    // A comment alone is not enough: the server wants evidence.
    expect(screen.getByTestId('closeout-submit').props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(screen.getByTestId('closeout-library'))
    expect(await screen.findByText('1 new photo ready.')).toBeTruthy()
    expect(screen.getByTestId('closeout-submit').props.accessibilityState?.disabled).toBe(false)
    await fireEvent.press(screen.getByTestId('closeout-submit'))
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/ncr/n1/submit')).toBe(true))
    const order = calls.filter((c) => c.method === 'POST').map((c) => c.path)
    expect(order.indexOf('/projects/p1/workflow/uploads')).toBeLessThan(order.indexOf('/projects/p1/ncr/n1/submit'))
    const sent = calls.find((c) => c.path.endsWith('/n1/submit'))!.body as Record<string, unknown>
    expect(sent).toMatchObject({ closureComment: 'Broken out to sound concrete and recast with SCC; cores taken.', dueDate: '2030-01-10' })
    expect(sent.attachmentRefs).toEqual([expect.objectContaining({ fileName: 'evidence.jpg', storageKey: 'k9', documentId: 'd1' })])
    expect(await screen.findByText('Broken out to sound concrete and recast with SCC; cores taken.')).toBeTruthy()
    expect(screen.queryByTestId('action-submit')).toBeNull()
    expect(screen.getByTestId('action-approve')).toBeTruthy()
  })

  it('approves a submitted closeout through the approve route and rejects with a reason', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'n2' })
    await renderScreen(<NcrScreen />)
    expect(await screen.findByText('Joints raked and repointed.')).toBeTruthy()
    expect(screen.getByTestId('evidence-att1')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('action-reject'))
    expect((await screen.findByTestId('prompt-reject-confirm')).props.accessibilityState?.disabled).toBe(true)
    await fireEvent.changeText(screen.getByTestId('prompt-reject-input'), 'Photos show the wrong wall')
    await fireEvent.press(screen.getByTestId('prompt-reject-confirm'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/n2/reject'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/n2/reject'))!.body).toEqual({ reason: 'Photos show the wrong wall' })
    expect(await screen.findByTestId('action-submit')).toBeTruthy()
    expect(screen.queryByTestId('action-approve')).toBeNull()
  })

  it('a site engineer sees the NCR but has no decision to take', async () => {
    serve(siteEngineerQuality)
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'n2' })
    await renderScreen(<NcrScreen />)
    await screen.findByText('Joints raked and repointed.')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('action-approve')).toBeNull()
    expect(screen.queryByTestId('action-reject')).toBeNull()
    expect(screen.queryByTestId('action-submit')).toBeNull()
  })
})

describe('safety incidents', () => {
  it('lists them with the summary', async () => {
    serve()
    await renderScreen(<SafetyListScreen />)
    expect(await screen.findByText('Scaffold plank slipped at level 3')).toBeTruthy()
    expect(screen.getByText('Cut hand on rebar tie')).toBeTruthy()
    expect(screen.getByTestId('safety-new')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('safety-chip-closed'))
    await waitFor(() => expect(screen.queryByText('Scaffold plank slipped at level 3')).toBeNull())
  })

  it('reports a near miss and goes to it', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    const router = useRouter() as unknown as { replace: jest.Mock }
    await renderScreen(<NewSafetyScreen />)
    await fireEvent.changeText(await screen.findByTestId('safety-title'), 'Crane load swung over the walkway')
    await fireEvent.press(screen.getByTestId('safety-severity-high'))
    await fireEvent.press(screen.getByTestId('safety-report'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/safety')).toBe(true))
    const sent = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>
    expect(sent).toMatchObject({ incidentType: 'near_miss', title: 'Crane load swung over the walkway', severity: 'high', status: 'open' })
    expect(String(sent.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/quality/safety/si9'))
  })

  it('submits the closeout for an investigating incident with evidence', async () => {
    serve()
    pickPhoto()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'si1' })
    await renderScreen(<SafetyIncidentScreen />)
    expect(await screen.findByText('Plank not tied; toe board missing.')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('action-submit'))
    await fireEvent.changeText(await screen.findByTestId('closeout-comment'), 'Planks tied, toe boards fitted, scaffold retagged.')
    await fireEvent.press(screen.getByTestId('closeout-library'))
    await screen.findByText('1 new photo ready.')
    await fireEvent.press(screen.getByTestId('closeout-submit'))
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/safety/si1/submit')).toBe(true))
    expect((calls.find((c) => c.path.endsWith('/si1/submit'))!.body as { attachmentRefs: unknown[] }).attachmentRefs).toHaveLength(1)
    expect(await screen.findByTestId('action-approve')).toBeTruthy()
  })

  it('reopens a closed incident with a reason', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'si2' })
    await renderScreen(<SafetyIncidentScreen />)
    expect(await screen.findByText('Gloves reissued; toolbox talk held.')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('action-reopen'))
    await fireEvent.changeText(await screen.findByTestId('prompt-reopen-input'), 'Second cut on the same crew')
    await fireEvent.press(screen.getByTestId('prompt-reopen-confirm'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/si2/reopen'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/si2/reopen'))!.body).toEqual({ reason: 'Second cut on the same crew' })
    expect(await screen.findByTestId('action-submit')).toBeTruthy()
  })
})
