import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import WorkflowInstanceScreen from '../../../app/(app)/workflow/[id]'
import WorkflowInboxScreen from '../../../app/(app)/workflow/index'
import type { WorkflowInstance } from '@/api/commercial-types'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { instance, pmCommercial, steps } from '@/testing/fixtures-commercial'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let current: WorkflowInstance

const serve = (start: WorkflowInstance = instance()) => {
  current = start
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmCommercial) }),
    'GET /workflows/my-steps': () => ({ status: 200, body: envelope({ items: steps }) }),
    'GET /projects/p1/workflows/instances/wf1': () => ({ status: 200, body: envelope({ ...current, currentStep: current.steps.find((s) => s.key === current.currentStepKey) ?? null }) }),
    'POST /projects/p1/workflows/instances/wf1/respond': (call) => {
      const { response, comment } = call.body as { response: string; comment?: string }
      const step = current.steps[0]!
      current = {
        ...current,
        status: response === 'approve' ? 'succeeded' : 'failed',
        outcome: response === 'approve' ? 'success' : 'fail',
        currentStepKey: null,
        steps: [{ ...step, status: 'completed', result: response, completedAt: '2026-09-18T10:00:00.000Z', assignments: step.assignments.map((a) => ({ ...a, status: 'responded', response, responseLabel: response === 'approve' ? 'Approve' : 'Reject', comment: comment ?? null, respondedAt: '2026-09-18T10:00:00.000Z' })) }],
      }
      return { status: 200, body: envelope({ ...current, currentStep: null }) }
    },
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'wf1', projectId: 'p1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('the approvals inbox', () => {
  it('lists the steps waiting on this person, this project first, every project on request', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    const router = useRouter() as unknown as { push: jest.Mock }
    await renderScreen(<WorkflowInboxScreen />)
    expect(await screen.findByText('Second lift pit at grid F')).toBeTruthy()
    expect(screen.queryByText('August 2026')).toBeNull()
    await fireEvent.press(screen.getByTestId('workflow-chip-all'))
    expect(await screen.findByText('August 2026')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('step-row-as1'))
    expect(router.push).toHaveBeenCalledWith({ pathname: '/workflow/[id]', params: { id: 'wf1', projectId: 'p1' } })
  })
})

describe('an approval step', () => {
  it('shows the answers the template allows when the current step is mine, and the trail of steps', async () => {
    serve()
    await renderScreen(<WorkflowInstanceScreen />)
    expect(await screen.findByTestId('workflow-my-step')).toBeTruthy()
    expect(screen.getByTestId('workflow-respond-approve')).toBeTruthy()
    expect(screen.getByTestId('workflow-respond-reject')).toBeTruthy()
    expect(screen.getByTestId('workflow-step-pm_approval')).toBeTruthy()
  })

  it('says what is being approved, and what it is worth, before the answer is given', async () => {
    serve()
    await renderScreen(<WorkflowInstanceScreen />)
    expect(await screen.findByTestId('workflow-context')).toBeTruthy()
    expect(screen.getByText('Change value')).toBeTruthy()
    expect(screen.getByText(/18,500/)).toBeTruthy()
    expect(screen.getByText('Design change')).toBeTruthy()
    expect(screen.getByText('2 days')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('workflow-respond-approve'))
    expect(await screen.findByText('Approve change order CO-001?')).toBeTruthy()
    expect(screen.getByText(/Change value: .*18,500[\s\S]*record your approval in the project audit trail/)).toBeTruthy()
  })

  it('will not offer a money decision it has no figure for, and hands it to the web instead', async () => {
    // An instance whose context carries no amount: the app cannot say what the
    // approval is worth, so it must not present an approve button.
    serve(instance({ context: { ref: 'CO-001', title: 'Second lift pit at grid F', status: 'pending' } }))
    await renderScreen(<WorkflowInstanceScreen />)
    expect(await screen.findByTestId('workflow-review-on-web')).toBeTruthy()
    expect(screen.queryByTestId('workflow-respond-approve')).toBeNull()
    expect(screen.queryByTestId('workflow-respond-reject')).toBeNull()
  })

  it('needs a comment to reject, sends the answer through the respond route and shows the outcome', async () => {
    serve()
    await renderScreen(<WorkflowInstanceScreen />)
    await fireEvent.press(await screen.findByTestId('workflow-respond-reject'))
    expect((await screen.findByTestId('prompt-respond-confirm')).props.accessibilityState?.disabled).toBe(true)
    await fireEvent.changeText(screen.getByTestId('prompt-respond-input'), 'The lift pit is not in the contract scope; price it as a variation first.')
    await fireEvent.press(screen.getByTestId('prompt-respond-confirm'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/respond'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/respond'))!.body).toEqual({ response: 'reject', comment: 'The lift pit is not in the contract scope; price it as a variation first.' })
    await waitFor(() => expect(screen.queryByTestId('workflow-my-step')).toBeNull())
    expect(screen.getByText(/Failed · Fail/)).toBeTruthy()
    // The change order itself was never touched from here.
    expect(calls.some((c) => c.path.includes('/change-orders/'))).toBe(false)
  })

  it('approves without a comment', async () => {
    serve()
    await renderScreen(<WorkflowInstanceScreen />)
    await fireEvent.press(await screen.findByTestId('workflow-respond-approve'))
    expect((await screen.findByTestId('prompt-respond-confirm')).props.accessibilityState?.disabled).toBe(false)
    await fireEvent.press(screen.getByTestId('prompt-respond-confirm'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/respond'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/respond'))!.body).toEqual({ response: 'approve' })
    expect(await screen.findByText(/Succeeded · Success/)).toBeTruthy()
  })

  it("offers no answer when the current step is someone else's, and opens the record in the app", async () => {
    const other = instance()
    other.steps[0]!.assignments = [{ ...other.steps[0]!.assignments[0]!, id: 'as9', userId: 'u2', user: { id: 'u2', name: 'Priya Raman' } }]
    serve(other)
    const router = useRouter() as unknown as { push: jest.Mock }
    await renderScreen(<WorkflowInstanceScreen />)
    expect(await screen.findByText(/Waiting on Priya Raman/)).toBeTruthy()
    expect(screen.queryByTestId('workflow-my-step')).toBeNull()
    await fireEvent.press(screen.getByTestId('workflow-open-record'))
    expect(router.push).toHaveBeenCalledWith('/commercial/change-orders/co1')
  })
})
