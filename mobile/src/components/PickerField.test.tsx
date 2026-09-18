import { fireEvent, render, screen } from '@testing-library/react-native'
import { useState } from 'react'
import { PickerField, type PickerOption } from '@/components/PickerField'

const options: PickerOption[] = [
  { id: 'u1', label: 'Dana Okafor', sublabel: 'Project Manager' },
  { id: 'u2', label: 'Priya Raman', sublabel: 'Site Engineer' },
  { id: 'u3', label: 'Ravi Menon', sublabel: 'Planning Engineer' },
]

function Single() {
  const [value, setValue] = useState<string | null>(null)
  return <PickerField label="Manager" options={options} value={value} onChange={(v) => setValue(v as string | null)} testID="pick" />
}

function Multi() {
  const [value, setValue] = useState<string[]>([])
  return <PickerField label="Assigned to" options={options} value={value} onChange={(v) => setValue(v as string[])} multiple testID="pick" />
}

describe('the picker field', () => {
  it('opens a searchable list, narrows it, and closes on a single choice', async () => {
    await render(<Single />)
    expect(screen.getByText('Choose')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('pick'))
    await fireEvent.changeText(screen.getByTestId('pick-search'), 'ravi')
    expect(screen.queryByTestId('pick-option-u1')).toBeNull()
    await fireEvent.press(screen.getByTestId('pick-option-u3'))
    expect(await screen.findByText('Ravi Menon')).toBeTruthy()
  })

  it('keeps the list open for several choices and shows the count', async () => {
    await render(<Multi />)
    await fireEvent.press(screen.getByTestId('pick'))
    await fireEvent.press(screen.getByTestId('pick-option-u1'))
    await fireEvent.press(screen.getByTestId('pick-option-u2'))
    await fireEvent.press(screen.getByTestId('pick-done'))
    expect(await screen.findByText('2 chosen')).toBeTruthy()
  })
})
