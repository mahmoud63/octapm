import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { router, useLocalSearchParams } from 'expo-router'
import TaskDetailScreen from '../../../app/(app)/tasks/[id]'
import TasksScreen from '../../../app/(app)/tasks/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { TaskDetail } from '@/api/record-types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { pmFull, taskDetail, taskList, warehouse } from '@/testing/fixtures-records'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let current: TaskDetail

const serve = (permissions = pmFull) => {
  current = taskDetail()
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /tasks': (call) => ({ status: 200, body: envelope(call.query.assignee === 'me' ? taskList([taskList().rows[0]!]) : taskList()) }),
    'GET /tasks/t1': () => ({ status: 200, body: envelope(current) }),
    'PATCH /tasks/t1': (call) => {
      current = { ...current, ...(call.body as object) }
      return { status: 200, body: envelope(current) }
    },
    'POST /tasks/t1/close': (call) => {
      current = { ...current, status: 'done', closedAt: '2026-09-18T00:00:00.000Z', comments: [...current.comments, { id: 'tc9', taskId: 't1', body: (call.body as { comment?: string }).comment ?? '', authorId: 'u1', author: { id: 'u1', name: 'Dana Okafor' }, createdAt: '2026-09-18T00:00:00.000Z' }] }
      return { status: 200, body: envelope(current) }
    },
    'POST /tasks/t1/comments': (call) => {
      const comment = { id: 'tc8', taskId: 't1', body: (call.body as { body: string }).body, authorId: 'u1', author: { id: 'u1', name: 'Dana Okafor' }, createdAt: '2026-09-18T00:00:00.000Z' }
      current = { ...current, comments: [...current.comments, comment] }
      return { status: 201, body: envelope(comment) }
    },
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(router.push as jest.Mock).mockClear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 't1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('tasks', () => {
  it('lists my tasks on this project first, and widens on request', async () => {
    serve()
    await renderScreen(<TasksScreen />)
    expect(await screen.findByText('Re-brief lifting plan to the steelfixing crew')).toBeTruthy()
    const first = calls.find((c) => c.path === '/tasks')!
    expect(first.query).toMatchObject({ assignee: 'me', projectId: 'p1' })
    expect(screen.queryByText('Chase the rebar mill certificates')).toBeNull()

    await fireEvent.press(screen.getByTestId('task-chip-all'))
    expect(await screen.findByText('Chase the rebar mill certificates')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('task-row-t1'))
    expect(router.push).toHaveBeenCalledWith('/tasks/t1')
  })

  it('a record shows the task, and closing it goes through the close route with the note', async () => {
    serve()
    await renderScreen(<TaskDetailScreen />)
    expect(await screen.findByText('Re-brief lifting plan to the steelfixing crew')).toBeTruthy()
    expect(screen.getByText('Created from meeting MTG-0001.')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('action-start'))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/tasks/t1')?.body).toEqual({ status: 'in_progress' }))

    await fireEvent.press(await screen.findByTestId('action-close'))
    await fireEvent.changeText(await screen.findByTestId('prompt-close-task-input'), 'Briefed at the toolbox talk')
    await fireEvent.press(screen.getByTestId('prompt-close-task-confirm'))
    await waitFor(() => expect(calls.find((c) => c.path === '/tasks/t1/close')?.body).toEqual({ comment: 'Briefed at the toolbox talk' }))
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy())
    expect(screen.queryByTestId('action-bar')).toBeNull()
  })

  it('a comment is posted to the task', async () => {
    serve()
    await renderScreen(<TaskDetailScreen />)
    await fireEvent.changeText(await screen.findByTestId('task-comment-input'), 'Crew re-briefed this morning.')
    await fireEvent.press(screen.getByTestId('task-comment-post'))
    await waitFor(() => expect(calls.find((c) => c.path === '/tasks/t1/comments')?.body).toEqual({ body: 'Crew re-briefed this morning.' }))
    expect(await screen.findByText('Crew re-briefed this morning.')).toBeTruthy()
  })

  it('a warehouse person can comment but not move or close the task', async () => {
    serve(warehouse)
    await renderScreen(<TaskDetailScreen />)
    await screen.findByText('Re-brief lifting plan to the steelfixing crew')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('action-bar')).toBeNull()
    expect(screen.getByTestId('task-comment-post')).toBeTruthy()
  })
})
