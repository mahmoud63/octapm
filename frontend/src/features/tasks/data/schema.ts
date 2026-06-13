import { z } from 'zod'

const userSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
  })
  .nullable()
  .optional()

export const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  project: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable()
    .optional(),
  activityId: z.string().nullable().optional(),
  activity: z
    .object({
      id: z.string(),
      name: z.string(),
      activityCode: z.string().nullable().optional(),
      p6ActivityId: z.string().nullable().optional(),
      wbsCode: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  taskNumber: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: z.string(),
  label: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable().optional(),
  isOverdue: z.boolean().optional(),
  assigneeId: z.string().nullable().optional(),
  assignee: userSummarySchema,
  assigneeName: z.string().nullable().optional(),
  comments: z
    .array(
      z.object({
        id: z.string(),
        body: z.string(),
        authorId: z.string().nullable().optional(),
        author: userSummarySchema,
        createdAt: z.string(),
      })
    )
    .optional(),
  commentCount: z.number().optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        projectDocumentId: z.string().nullable().optional(),
        fileName: z.string().nullable().optional(),
        fileUrl: z.string().nullable().optional(),
        storageKey: z.string().nullable().optional(),
      })
    )
    .optional(),
  attachmentCount: z.number().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export type Task = z.infer<typeof taskSchema>
