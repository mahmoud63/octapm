import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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
import { Switch } from '@/components/ui/switch'
import { PasswordInput } from '@/components/password-input'
import { SelectDropdown } from '@/components/select-dropdown'
import { roles } from '../data/data'
import { type User } from '../data/schema'
import {
  useCreateUserMutation,
  useUpdateUserMutation,
} from '../hooks/use-users'

const formSchema = z
  .object({
    name: z.string().min(1, 'Full name is required.'),
    email: z
      .email({
        error: (iss) =>
          iss.input === ''
            ? 'Email is required.'
            : 'Please enter a valid email',
      })
      .transform((value) => value.toLowerCase()),
    phone: z.string().trim().optional(),
    role: z.string().min(1, 'Role is required.'),
    isCompanyAdmin: z.boolean(),
    password: z.string(),
    confirmPassword: z.string(),
    isEdit: z.boolean(),
  })
  // Password rules apply only when creating — edit mode never sets a password.
  .refine((data) => data.isEdit || data.password.length >= 8, {
    message: 'Password must be at least 8 characters long.',
    path: ['password'],
  })
  .refine((data) => data.isEdit || /[a-z]/.test(data.password), {
    message: 'Password must contain at least one lowercase letter.',
    path: ['password'],
  })
  .refine((data) => data.isEdit || /[0-9]/.test(data.password), {
    message: 'Password must contain at least one number.',
    path: ['password'],
  })
  .refine((data) => data.isEdit || data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ['confirmPassword'],
  })

type UserForm = z.infer<typeof formSchema>

type UserActionDialogProps = {
  currentRow?: User
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UsersActionDialog({
  currentRow,
  open,
  onOpenChange,
}: UserActionDialogProps) {
  const isEdit = !!currentRow
  const createUserMutation = useCreateUserMutation()
  const updateUserMutation = useUpdateUserMutation()
  const isPending = createUserMutation.isPending || updateUserMutation.isPending

  const form = useForm<UserForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: currentRow?.name ?? '',
      email: currentRow?.email ?? '',
      phone: currentRow?.phone ?? '',
      role: currentRow?.role ?? 'site_engineer',
      isCompanyAdmin: currentRow?.isCompanyAdmin ?? false,
      password: '',
      confirmPassword: '',
      isEdit,
    },
  })

  const onSubmit = async (values: UserForm) => {
    if (isEdit) {
      try {
        await updateUserMutation.mutateAsync({
          userId: currentRow!.id,
          payload: {
            name: values.name,
            email: values.email,
            phone: values.phone,
            role: values.role,
            isCompanyAdmin: values.isCompanyAdmin,
          },
        })
        toast.success('Engineer updated successfully.')
        onOpenChange(false)
      } catch (error) {
        toast.error(getServerErrorMessage(error))
      }
      return
    }

    try {
      await createUserMutation.mutateAsync({
        name: values.name,
        email: values.email,
        phone: values.phone,
        role: values.role,
        password: values.password,
      })
      toast.success('Engineer created successfully.')
      form.reset({
        name: '',
        email: '',
        phone: '',
        role: 'site_engineer',
        isCompanyAdmin: false,
        password: '',
        confirmPassword: '',
        isEdit: false,
      })
      onOpenChange(false)
    } catch (error) {
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
          <DialogTitle>{isEdit ? 'Edit User' : 'Add Engineer'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the user profile information.'
              : 'Create a new engineer account and share credentials securely.'}
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

            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder='engineer@company.com' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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

            {isEdit && (
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
            )}

            {!isEdit && (
              <>
                <FormField
                  control={form.control}
                  name='password'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder='e.g., S3cur3P@ssw0rd'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='confirmPassword'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder='Repeat password'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
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
