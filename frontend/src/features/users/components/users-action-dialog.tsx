import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { isEndedSession } from '@/services/api/client'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SelectDropdown } from '@/components/select-dropdown'
import { roles } from '../data/data'
import { type User } from '../data/schema'
import {
  type UserUpdatePayload,
  useUpdateUserMutation,
} from '../hooks/use-users'

const formSchema = z.object({
  name: z.string().trim().min(1, 'Full name is required.'),
  phone: z.string().trim().optional(),
  role: z.string().min(1, 'Role is required.'),
  isCompanyAdmin: z.boolean(),
})

type UserForm = z.infer<typeof formSchema>

type UserActionDialogProps = {
  currentRow: User
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Only the fields that changed are sent. A person's sign-in e-mail is theirs
 * (owner decision D-ID-1) and is never part of the payload; their name and
 * phone are editable here only when their account belongs to this workspace
 * (the server answers 403 otherwise).
 */
const changedFields = (row: User, values: UserForm): UserUpdatePayload => ({
  ...(values.name !== row.name && { name: values.name }),
  ...((values.phone ?? '') !== (row.phone ?? '') && {
    phone: values.phone ?? '',
  }),
  ...(values.role !== row.role && { role: values.role }),
  ...(values.isCompanyAdmin !== Boolean(row.isCompanyAdmin) && {
    isCompanyAdmin: values.isCompanyAdmin,
  }),
})

/**
 * Edits a person already in the workspace. Adding a person is always an
 * invitation (users-invite-dialog.tsx); nobody is created here.
 */
export function UsersActionDialog({
  currentRow,
  open,
  onOpenChange,
}: UserActionDialogProps) {
  const updateUserMutation = useUpdateUserMutation()
  const isPending = updateUserMutation.isPending

  const form = useForm<UserForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: currentRow.name ?? '',
      phone: currentRow.phone ?? '',
      role: currentRow.role ?? 'site_engineer',
      isCompanyAdmin: currentRow.isCompanyAdmin ?? false,
    },
  })

  const onSubmit = async (values: UserForm) => {
    const payload = changedFields(currentRow, values)
    if (Object.keys(payload).length === 0) {
      onOpenChange(false)
      return
    }
    try {
      await updateUserMutation.mutateAsync({
        userId: currentRow.id,
        payload,
      })
      toast.success('Person updated.')
      onOpenChange(false)
    } catch (error) {
      // An ended session was already announced by the request layer (D-ID-1 N4).
      if (isEndedSession(error)) return
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(state) => {
        if (!state) {
          form.reset()
        }
        onOpenChange(state)
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader className='text-start'>
          <DialogTitle>Edit person</DialogTitle>
          <DialogDescription>
            Update the person's role and details in this workspace.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id='user-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4'
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder='e.g. Ahmed Hassan' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='space-y-2'>
              <Label htmlFor='user-email-readonly'>Email</Label>
              <Input
                id='user-email-readonly'
                value={currentRow.email}
                readOnly
                disabled
                data-testid='uat-user-email-readonly'
              />
              <p className='text-xs text-muted-foreground'>
                The sign-in e-mail belongs to the person and cannot be changed
                here.
              </p>
            </div>

            <FormField
              control={form.control}
              name='phone'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input placeholder='+971500000000' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='role'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <SelectDropdown
                    defaultValue={field.value}
                    onValueChange={field.onChange}
                    placeholder='Select a role'
                    items={roles.map(({ label, value }) => ({ label, value }))}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='isCompanyAdmin'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between rounded-md border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Company admin</FormLabel>
                    <p className='text-xs text-muted-foreground'>
                      Sees every project and manages users and permission
                      templates.
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      data-testid='uat-user-company-admin'
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button type='submit' form='user-form' disabled={isPending}>
            {isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
