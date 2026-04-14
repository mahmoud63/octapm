import { z } from 'zod'
import { AxiosError } from 'axios'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
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
import { PasswordInput } from '@/components/password-input'
import { SelectDropdown } from '@/components/select-dropdown'
import { roles } from '../data/data'
import { type User } from '../data/schema'
import { useCreateUserMutation } from '../hooks/use-users'

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
    password: z.string().min(8, 'Password must be at least 8 characters long.'),
    confirmPassword: z.string(),
    isEdit: z.boolean(),
  })
  .refine((data) => /[a-z]/.test(data.password), {
    message: 'Password must contain at least one lowercase letter.',
    path: ['password'],
  })
  .refine((data) => /[0-9]/.test(data.password), {
    message: 'Password must contain at least one number.',
    path: ['password'],
  })
  .refine((data) => data.password === data.confirmPassword, {
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

  const form = useForm<UserForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: currentRow?.name ?? '',
      email: currentRow?.email ?? '',
      phone: currentRow?.phone ?? '',
      role: currentRow?.role ?? 'site_engineer',
      password: '',
      confirmPassword: '',
      isEdit,
    },
  })

  const getErrorMessage = (error: unknown) => {
    if (error instanceof AxiosError) {
      const errorData = error.response?.data as
        | { error?: { message?: string } }
        | undefined

      return errorData?.error?.message ?? 'Failed to create engineer'
    }

    return 'Failed to create engineer'
  }

  const onSubmit = async (values: UserForm) => {
    if (isEdit) {
      toast.info('Edit user flow is coming soon.')
      onOpenChange(false)
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
        password: '',
        confirmPassword: '',
        isEdit: false,
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
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
                    <PasswordInput placeholder='Repeat password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button
            type='submit'
            form='user-form'
            disabled={createUserMutation.isPending}
          >
            {createUserMutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
