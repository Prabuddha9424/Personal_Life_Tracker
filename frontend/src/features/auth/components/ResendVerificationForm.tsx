import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { useResendVerification } from '../api/hooks'
import { resendFormSchema, type ResendForm } from '../schemas'

/** Same confirmation whether or not the address has an account. */
export function ResendVerificationForm() {
  const resend = useResendVerification()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResendForm>({ resolver: zodResolver(resendFormSchema) })

  if (resend.isSuccess) {
    return <p role="status">If that account needs verifying, a new link is on its way.</p>
  }

  return (
    <form onSubmit={handleSubmit((values) => resend.mutate(values))} noValidate>
      <FormField label="Email" error={errors.email?.message}>
        <input type="email" autoComplete="email" {...register('email')} />
      </FormField>
      {resend.isError && (
        <p className="form-error" role="alert">
          {getErrorMessage(resend.error)}
        </p>
      )}
      <Button type="submit" loading={resend.isPending}>
        Send a new link
      </Button>
    </form>
  )
}
