import { fireEvent, render, screen } from '@testing-library/react-native'
import { PromptSheet } from '@/components/PromptSheet'

describe('the prompt sheet', () => {
  it('will not confirm without the text the server requires, then hands the text over', async () => {
    const onConfirm = jest.fn()
    await render(<PromptSheet visible title="Reject the answer" label="Reason" required confirmTitle="Reject" onCancel={() => undefined} onConfirm={onConfirm} testID="p" />)
    const confirm = screen.getByTestId('p-confirm')
    expect(confirm.props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
    await fireEvent.changeText(screen.getByTestId('p-input'), '  Not enough detail  ')
    await fireEvent.press(confirm)
    expect(onConfirm).toHaveBeenCalledWith('Not enough detail')
  })

  it('lets an optional note through empty', async () => {
    const onConfirm = jest.fn()
    await render(<PromptSheet visible title="Mark done" label="Note" confirmTitle="Mark done" onCancel={() => undefined} onConfirm={onConfirm} testID="p" />)
    await fireEvent.press(screen.getByTestId('p-confirm'))
    expect(onConfirm).toHaveBeenCalledWith('')
  })
})
