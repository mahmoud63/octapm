import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { isEndedSession } from '@/services/api/client'
import { Loader2, MailPlus, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
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
import { Textarea } from '@/components/ui/textarea'
import { SelectDropdown } from '@/components/select-dropdown'
import {
  ConvertRequiredNotice,
  isConvertRequiredError,
} from '@/features/company/components/convert-required-notice'
import {
  useProjectParties,
  useProjects,
} from '@/features/projects/hooks/use-projects'
import { roles } from '../data/data'
import {
  invitationErrorMessage,
  isInvitationEmailFailed,
  useInviteUserMutation,
} from '../hooks/use-users'

const formSchema = z.object({
  email: z.email({
    error: (iss) =>
      iss.input === '' ? 'Please enter an email to invite.' : undefined,
  }),
  role: z.string().min(1, 'Role is required.'),
  projectId: z.string().optional(),
  projectPartyId: z.string().optional(),
  note: z
    .string()
    .max(1000, 'Note must be 1,000 characters or less.')
    .optional(),
})

type UserInviteForm = z.infer<typeof formSchema>

type UserInviteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UsersInviteDialog({
  open,
  onOpenChange,
}: UserInviteDialogProps) {
  const projectsQuery = useProjects()
  const inviteUser = useInviteUserMutation()
  // A personal workspace refused a member invitation (ENT-6): the dialog
  // shows the way to the conversion instead of an error toast. A party
  // invitation (a guest) is still sent from here as before.
  const [convertRequired, setConvertRequired] = useState(false)
  const form = useForm<UserInviteForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      role: '',
      projectId: 'none',
      projectPartyId: 'none',
      note: '',
    },
  })
  const selectedProjectId = form.watch('projectId')
  const projectPartiesQuery = useProjectParties(
    selectedProjectId && selectedProjectId !== 'none' ? selectedProjectId : ''
  )

  const onSubmit = async (values: UserInviteForm) => {
    try {
      await inviteUser.mutateAsync({
        email: values.email,
        role: values.role,
        projectId:
          values.projectId && values.projectId !== 'none'
            ? values.projectId
            : undefined,
        projectPartyId:
          values.projectPartyId && values.projectPartyId !== 'none'
            ? values.projectPartyId
            : undefined,
        note: values.note || undefined,
      })
      // One neutral answer whoever the address belongs to: the person
      // joins when they accept, with a password (or sign-in) of their own.
      form.reset()
      toast.success(
        `Invitation sent to ${values.email}. They join when they accept it.`
      )
      onOpenChange(false)
    } catch (error) {
      // An ended session was already announced by the request layer (D-ID-1 N4).
      if (isEndedSession(error)) return
      if (isConvertRequiredError(error)) {
        setConvertRequired(true)
        return
      }
      // Saved, but its e-mail failed (502): the invitation is pending and
      // is sent again from Pending invitations, never re-typed here.
      if (isInvitationEmailFailed(error)) {
        form.reset()
        toast.warning(invitationErrorMessage(error))
        onOpenChange(false)
        return
      }
      toast.error(invitationErrorMessage(error))
    }
  }

  const projectItems = [
    { label: 'Organization only', value: 'none' },
    ...(projectsQuery.data?.items.map((project) => ({
      label: project.name,
      value: project.id,
    })) ?? []),
  ]
  const partyItems = [
    { label: 'Internal project assignment', value: 'none' },
    ...(projectPartiesQuery.data?.items.map((party) => ({
      label: `${party.company?.name ?? 'Company'} - ${party.role.replace(
        /_/g,
        ' '
      )}`,
      value: party.id,
    })) ?? []),
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(state) => {
        form.reset()
        setConvertRequired(false)
        onOpenChange(state)
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader className='text-start'>
          <DialogTitle className='flex items-center gap-2'>
            <MailPlus /> Invite a person
          </DialogTitle>
          <DialogDescription>
            Everyone joins by invitation. We e-mail them a link; they choose
            their own password (or use their company sign-in) when they
            accept. The role sets their access level.
          </DialogDescription>
        </DialogHeader>
        {convertRequired && (
          <ConvertRequiredNotice onNavigate={() => onOpenChange(false)} />
        )}
        <Form {...form}>
          <form
            id='user-invite-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4'
          >
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type='email'
                      placeholder='eg: john.doe@gmail.com'
                      {...field}
                    />
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
                    items={roles.map(({ label, value }) => ({
                      label,
                      value,
                    }))}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='projectId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project access</FormLabel>
                  <SelectDropdown
                    defaultValue={field.value}
                    onValueChange={(value) => {
                      field.onChange(value)
                      form.setValue('projectPartyId', 'none')
                    }}
                    placeholder='Select project access'
                    isPending={projectsQuery.isPending}
                    disabled={projectsQuery.isPending}
                    items={projectItems}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            {selectedProjectId && selectedProjectId !== 'none' && (
              <FormField
                control={form.control}
                name='projectPartyId'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>External party</FormLabel>
                    <SelectDropdown
                      defaultValue={field.value}
                      onValueChange={field.onChange}
                      placeholder='Select external party'
                      isPending={projectPartiesQuery.isPending}
                      disabled={projectPartiesQuery.isPending}
                      items={partyItems}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name='note'
              render={({ field }) => (
                <FormItem className=''>
                  <FormLabel>Message (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      className='resize-none'
                      placeholder='Add a personal note to your invitation (optional)'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter className='gap-y-2'>
          <DialogClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DialogClose>
          <Button
            type='submit'
            form='user-invite-form'
            disabled={inviteUser.isPending}
          >
            Invite{' '}
            {inviteUser.isPending ? (
              <Loader2 className='animate-spin' />
            ) : (
              <Send />
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
