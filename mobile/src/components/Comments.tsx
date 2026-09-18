import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useComments, usePostComment } from '@/api/record-hooks'
import type { Comment } from '@/api/record-types'
import { Button, ErrorState, Input, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { relative } from '@/utilities/format'

function CommentRow({ item }: { item: Comment }) {
  const theme = useTheme()
  return (
    <View style={[styles.comment, { borderColor: theme.colors.border }]} testID={`comment-${item.id}`}>
      <View style={styles.meta}>
        <Text variant="caption" style={styles.author}>
          {item.author?.name ?? 'Someone'}
        </Text>
        <Text variant="caption" tone="muted">
          {relative(item.createdAt)}
          {item.editedAt ? ' · edited' : ''}
        </Text>
      </View>
      <Text>{item.deletedAt ? '(removed)' : item.body}</Text>
    </View>
  )
}

/**
 * The discussion on a record: the same comment thread the web shows, oldest
 * first, with a composer for anyone who can read the record. Mentions arrive
 * with a later milestone.
 */
export function Comments({ projectId, recordType, recordId, canPost = true }: { projectId: string; recordType: string; recordId: string; canPost?: boolean }) {
  const comments = useComments(projectId, recordType, recordId)
  const post = usePostComment(projectId, recordType, recordId)
  const [draft, setDraft] = useState('')

  const submit = async () => {
    const body = draft.trim()
    if (!body) return
    await post.mutateAsync(body)
    setDraft('')
  }

  return (
    <View style={styles.wrap} testID="comments">
      <Text variant="label" label tone="muted">
        Discussion
      </Text>
      {comments.isPending ? (
        <SkeletonList rows={2} />
      ) : comments.isError ? (
        <ErrorState message={userMessage(comments.error)} onRetry={() => void comments.refetch()} />
      ) : comments.data.length === 0 ? (
        <Text tone="muted">No comments yet.</Text>
      ) : (
        comments.data.map((item) => <CommentRow key={item.id} item={item} />)
      )}
      {canPost ? (
        <View style={styles.composer}>
          <Input label="Add a comment" placeholder="Write to the people on this record" value={draft} onChangeText={setDraft} multiline testID="comment-input" />
          {post.isError ? (
            <Text variant="caption" tone="error">
              {userMessage(post.error)}
            </Text>
          ) : null}
          <Button title="Post comment" variant="secondary" loading={post.isPending} disabled={!draft.trim()} onPress={() => void submit()} testID="comment-post" />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  comment: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  author: { fontFamily: 'Inter_600SemiBold' },
  composer: { gap: spacing.sm, paddingTop: spacing.sm },
})
