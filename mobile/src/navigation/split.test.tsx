import { screen } from '@testing-library/react-native'
import { usePathname } from 'expo-router'
import { Text } from 'react-native'
import { useLayout } from '@/hooks/useLayout'
import { PanePlaceholder, SplitGroup, useSplitRole } from '@/navigation/split'
import { renderScreen } from '@/testing/render'

jest.mock('@/hooks/useLayout')

const layout = (splitView: boolean) => (useLayout as jest.Mock).mockReturnValue({ width: splitView ? 1024 : 390, height: 768, widthClass: splitView ? 'expanded' : 'compact', isCompact: !splitView, isMedium: false, isExpanded: splitView, isLandscape: splitView, splitView, columns: splitView ? 2 : 1 })

/** A list screen as the app writes them: itself on the left, the placeholder when the stack draws it in the pane. */
function ListScreen() {
  const role = useSplitRole()
  if (role === 'pane') return <PanePlaceholder />
  return <Text testID="list">The list</Text>
}

describe('master–detail by route group', () => {
  it('on a phone draws the stack alone', async () => {
    layout(false)
    ;(usePathname as jest.Mock).mockReturnValue('/rfi/r1')
    await renderScreen(
      <SplitGroup sections={[{ prefix: '/rfi', master: () => <ListScreen /> }]}>
        <Text testID="stack">The record</Text>
      </SplitGroup>,
    )
    expect(screen.getByTestId('stack')).toBeTruthy()
    expect(screen.queryByTestId('split-group')).toBeNull()
  })

  it('on a tablet keeps the section list on the left and the stack on the right', async () => {
    layout(true)
    ;(usePathname as jest.Mock).mockReturnValue('/rfi/r1')
    await renderScreen(
      <SplitGroup sections={[{ prefix: '/rfi', master: () => <ListScreen /> }]}>
        <Text testID="stack">The record</Text>
      </SplitGroup>,
    )
    expect(screen.getByTestId('split-group')).toBeTruthy()
    expect(screen.getByTestId('list')).toBeTruthy()
    expect(screen.getByTestId('stack')).toBeTruthy()
  })

  it("shows the placeholder where the stack would draw the list again, and picks the longest matching section", async () => {
    layout(true)
    ;(usePathname as jest.Mock).mockReturnValue('/quality/punch')
    await renderScreen(
      <SplitGroup
        sections={[
          { prefix: '/quality', master: () => <Text testID="home">Quality home</Text> },
          { prefix: '/quality/punch', master: () => <Text testID="punch-list">Punch list</Text> },
        ]}
      >
        <ListScreen />
      </SplitGroup>,
    )
    expect(screen.getByTestId('punch-list')).toBeTruthy()
    expect(screen.queryByTestId('home')).toBeNull()
    expect(screen.getByTestId('pane-placeholder')).toBeTruthy()
  })

  it('leaves a route no section claims alone', async () => {
    layout(true)
    ;(usePathname as jest.Mock).mockReturnValue('/inventory/scan')
    await renderScreen(
      <SplitGroup sections={[{ prefix: '/inventory/items', master: () => <ListScreen /> }]}>
        <Text testID="stack">Scan</Text>
      </SplitGroup>,
    )
    expect(screen.queryByTestId('split-group')).toBeNull()
    expect(screen.getByTestId('stack')).toBeTruthy()
  })
})
