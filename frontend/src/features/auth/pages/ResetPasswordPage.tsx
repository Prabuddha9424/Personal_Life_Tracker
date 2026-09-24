import { zodResolver } from '@hookform/resolvers/zod'
import axios from 'axios'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { applyFieldErrors, hasFieldErrorFor } from '../apiErrors'
import { useResetPassword } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { resetFormSchema, type ResetForm } from '../schemas'
import { useUrlToken } from '../useUrlToken'

const FIELDS = ['password'] as const

export default function ResetPasswordPage() {
  const token = useUrlToken()
  const reset = useResetPassword()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ResetForm>({ resolver: zodResolver(resetFormSchema) })

  if (reset.isSuccess) {
    return (
      <AuthLayout title="Password changed">
        <p>Your password has been changed. You can log in now.</p>
        <Link className="btn btn--primary" to="/login">
          Log in
        </Link>
      </AuthLayout>
    )
  }

  // A 400 that explains itself through the password field is a rejected password, not a dead
  // link: the token was not consumed, so keep the form and let the user try another password.
  const passwordRejected = hasFieldErrorFor(reset.error, FIELDS)
  const linkExpired =
    axios.isAxiosError(reset.error) && reset.error.response?.status === 400 && !passwordRejected

  if (!token || linkExpired) {
    return (
      <AuthLayout title="Reset your password">
        <p role="alert">This link is invalid or has expired.</p>
        <Link className="btn" to="/forgot-password">
          Request a new link
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Choose a new password">
      <form
        onSubmit={handleSubmit(({ password }) =>
          reset.mutate(
            { token, password },
            { onError: (error) => applyFieldErrors(error, setError, FIELDS) },
          ),
        )}
        noValidate
      >
        <FormField
          label="New password"
          error={errors.password?.message}
          hint="At least 10 characters, and not a common password"
        >
          <input type="password" autoComplete="new-password" {...register('password')} />
        </FormField>
        <FormField label="Confirm new password" error={errors.confirm?.message}>
          <input type="password" autoComplete="new-password" {...register('confirm')} />
        </FormField>
        {reset.isError && !passwordRejected && (
          <p className="form-error">{getErrorMessage(reset.error)}</p>
        )}
        <Button type="submit" variant="primary" loading={reset.isPending}>
          Change password
        </Button>
      </form>
    </AuthLayout>
  )
}
