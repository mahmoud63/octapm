import { fireEvent, render, screen } from '@testing-library/react-native'
import { ProgressSheet } from '@/components/ProgressSheet'
import type { ProgressMethod } from '@/api/site-types'

/**
 * A typed installed quantity is greater than zero (PC-6 integration,
 * 2026-10-01): the server refuses a typed 0 with 400 QUANTITY_INVALID —
 * record nothing for no work — so the sheet never offers one for submission.
 */
const quantityMethod: ProgressMethod = {
  activityId: 'a1',
  method: 'quantity',
  plannedQuantity: 200,
  quantityUnit: 'm3',
  milestoneWeights: [],
  inspectionRequired: false,
  evidenceRequired: false,
  notes: null,
}

const sheet = (onSubmit: jest.Mock) =>
  render(<ProgressSheet visible method={quantityMethod} approvedPct={null} onCancel={() => {}} onSubmit={onSubmit} />)

describe('ProgressSheet: a typed quantity is greater than zero', () => {
  it('a zero (or nothing) is not ready to submit or save; a positive quantity is', async () => {
    const onSubmit = jest.fn()
    await sheet(onSubmit)
    for (const typed of ['', '0', '0.0']) {
      await fireEvent.changeText(screen.getByTestId('progress-quantity'), typed)
      expect(screen.getByTestId('progress-submit').props.accessibilityState?.disabled).toBe(true)
      expect(screen.getByTestId('progress-draft').props.accessibilityState?.disabled).toBe(true)
      await fireEvent.press(screen.getByTestId('progress-submit'))
    }
    expect(onSubmit).not.toHaveBeenCalled()
    await fireEvent.changeText(screen.getByTestId('progress-quantity'), '12.5')
    expect(screen.getByTestId('progress-submit').props.accessibilityState?.disabled).toBeFalsy()
    await fireEvent.press(screen.getByTestId('progress-submit'))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'submitted', progressMethod: 'quantity', quantityComplete: 12.5, quantityUnit: 'm3' }))
  })
})
