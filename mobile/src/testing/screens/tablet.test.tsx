import { fireEvent, screen, waitFor, within } from '@testing-library/react-native'
import { useLocalSearchParams } from 'expo-router'
import ActivityScreen from '../../../app/(app)/activities/[id]'
import InspectionScreen, { signatureRole } from '../../../app/(app)/quality/inspections/[id]'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { ProgressSubmission } from '@/api/site-types'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useLayout } from '@/hooks/useLayout'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { formInstance, pmQuality } from '@/testing/fixtures-quality'
import { activity, percentMethod, pmSite, siteEngineerSite } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

jest.mock('@/hooks/useLayout')

const wide = (expanded: boolean) => (useLayout as jest.Mock).mockReturnValue({ width: expanded ? 1024 : 390, height: 768, widthClass: expanded ? 'expanded' : 'compact', isCompact: !expanded, isMedium: false, isExpanded: expanded, isLandscape: expanded, splitView: expanded, columns: expanded ? 2 : 1 })

let calls: Call[]
let submissions: ProgressSubmission[]

const submission = (over: Partial<ProgressSubmission> = {}): ProgressSubmission => ({ id: 'ps1', activityId: 'a1', status: 'submitted', pctComplete: 55, quantityComplete: null, quantityPlanned: null, quantityUnit: null, progressMethod: 'percent', source: 'mobile', notes: 'Raft poured to grid D', submittedAt: '2026-09-18T07:00:00.000Z', createdAt: '2026-09-18T07:00:00.000Z', ...over })

const serve = (permissions: PermissionMatrix = pmSite, options: { inspectionRequired?: boolean } = {}) => {
  submissions = [submission()]
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/activities/a1': () => ({ status: 200, body: envelope(activity()) }),
    'GET /projects/p1/activities/a1/progress-method': () => ({ status: 200, body: envelope({ ...percentMethod, inspectionRequired: !!options.inspectionRequired }) }),
    'GET /projects/p1/activities/a1/progress-submissions': () => ({ status: 200, body: envelope(submissions) }),
    'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }),
    'POST /projects/p1/activities/a1/progress-submissions/ps1/approve': () => {
      submissions = submissions.map((s) => ({ ...s, status: 'approved', reviewedAt: '2026-09-18T08:00:00.000Z' }))
      return { status: 200, body: envelope(submissions[0]) }
    },
    'POST /projects/p1/activities/a1/progress-submissions/ps1/reject': (call) => {
      submissions = submissions.map((s) => ({ ...s, status: 'rejected', rejectionReason: (call.body as { reason: string }).reason }))
      return { status: 200, body: envelope(submissions[0]) }
    },
    'GET /projects/p1/forms/f1': () => ({ status: 200, body: envelope(formInstance({ sections: [{ id: 's1', title: 'Sign-off', description: null, items: [{ id: 'i4', label: 'Inspector signature', description: null, responseType: 'signature', required: true, photoRequired: false, isHoldPoint: false, inspectionPointType: null, options: null, reference: null, response: null, signature: null }] }] })) }),
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'a1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('progress approval', () => {
  it('offers approve and reject on a submitted update to a role that holds the transition', async () => {
    wide(true)
    serve()
    await renderScreen(<ActivityScreen />)
    expect(await screen.findByTestId('submission-approve-ps1')).toBeTruthy()
    expect(screen.getByTestId('submission-reject-ps1')).toBeTruthy()
    expect(screen.queryByTestId('submission-hold-ps1')).toBeNull()
  })

  it('offers the same decision on a phone, because permission decides it and not the width', async () => {
    // Needs You sends a project manager here on a phone. Refusing to show the
    // decision because the screen is narrow left them stranded with no reason
    // given; the tablet simply shows more of the record beside it.
    wide(false)
    serve()
    await renderScreen(<ActivityScreen />)
    await screen.findByText('Raft poured to grid D')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(await screen.findByTestId('submission-approve-ps1')).toBeTruthy()
    expect(screen.getByTestId('submission-reject-ps1')).toBeTruthy()
  })

  it('offers nothing to a site engineer, on any screen', async () => {
    wide(true)
    serve(siteEngineerSite)
    await renderScreen(<ActivityScreen />)
    await screen.findByText('Raft poured to grid D')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('submission-approve-ps1')).toBeNull()
  })

  it('warns about a hold point and approves through the approve route', async () => {
    wide(true)
    serve(pmSite, { inspectionRequired: true })
    await renderScreen(<ActivityScreen />)
    expect(await screen.findByTestId('submission-hold-ps1')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('submission-approve-ps1'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/ps1/approve'))).toBe(true))
    await waitFor(() => expect(within(screen.getByTestId('submission-ps1')).getByText('Approved')).toBeTruthy())
    expect(screen.queryByTestId('submission-approve-ps1')).toBeNull()
  })

  it('rejects with a reason through the reject route', async () => {
    wide(true)
    serve()
    await renderScreen(<ActivityScreen />)
    await fireEvent.press(await screen.findByTestId('submission-reject-ps1'))
    expect((await screen.findByTestId('prompt-reject-progress-confirm')).props.accessibilityState?.disabled).toBe(true)
    await fireEvent.changeText(screen.getByTestId('prompt-reject-progress-input'), 'The raft is not yet at grid D; 40% at most.')
    await fireEvent.press(screen.getByTestId('prompt-reject-progress-confirm'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/ps1/reject'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/ps1/reject'))!.body).toEqual({ reason: 'The raft is not yet at grid D; 40% at most.' })
    expect(await screen.findByText(/Rejected: The raft is not yet at grid D/)).toBeTruthy()
  })
})

describe('signing a checklist item', () => {
  it('reads the role from the item', () => {
    expect(signatureRole({ label: 'Inspector signature', inspectionPointType: null })).toBe('inspector')
    expect(signatureRole({ label: 'Approver sign-off', inspectionPointType: null })).toBe('approver')
    expect(signatureRole({ label: 'Subcontractor representative', inspectionPointType: null })).toBe('subcontractor')
    expect(signatureRole({ label: 'Witness', inspectionPointType: null })).toBe('witness')
  })

  it('offers the pad on a signature item while the form is editable', async () => {
    wide(true)
    serve(pmQuality)
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'f1' })
    await renderScreen(<InspectionScreen />)
    await fireEvent.press(await screen.findByTestId('item-i4-sign'))
    expect(await screen.findByTestId('signature')).toBeTruthy()
    expect(screen.getByText('Signing as Inspector')).toBeTruthy()
    expect(screen.getByTestId('signature-name').props.value).toBe('Dana Okafor')
    // Nothing is sent until the person draws and confirms.
    expect(screen.getByTestId('signature-confirm').props.accessibilityState?.disabled).toBe(true)
  })
})
