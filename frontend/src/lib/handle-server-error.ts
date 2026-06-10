import { AxiosError } from 'axios'
import { toast } from 'sonner'

type ApiErrorPayload = {
  error?: {
    code?: string
    message?: string
  }
}

export const SUBSCRIPTION_REQUIRED_MESSAGE =
  'Your trial or subscription has ended. Subscribe to continue.'

export function isSubscriptionRequiredError(error: unknown) {
  if (!(error instanceof AxiosError)) {
    return false
  }

  const errorData = error.response?.data as ApiErrorPayload | undefined
  return (
    error.response?.status === 402 ||
    errorData?.error?.code === 'SUBSCRIPTION_REQUIRED'
  )
}

export function getServerErrorMessage(
  error: unknown,
  fallback = 'Something went wrong!'
) {
  let errMsg = fallback

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    errMsg = 'Content not found.'
  }

  if (error instanceof AxiosError) {
    const errorData = error.response?.data as ApiErrorPayload | undefined

    if (isSubscriptionRequiredError(error)) {
      return errorData?.error?.message || SUBSCRIPTION_REQUIRED_MESSAGE
    }

    errMsg = errorData?.error?.message || errMsg
  }

  return errMsg
}

export function handleServerError(error: unknown) {
  // eslint-disable-next-line no-console
  console.log(error)

  const errMsg = getServerErrorMessage(error)

  toast.error(errMsg)
}
