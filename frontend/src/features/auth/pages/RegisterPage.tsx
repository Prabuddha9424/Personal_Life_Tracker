import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { pushToast } from '@/shared/ui/toast'
import { useRegister, useResendVerification } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { CURRENCY_OPTIONS } from '../currencies'
import { registerFormSchema, type RegisterForm } from '../schemas'

export default function RegisterPage() {
  const registerUser = useRegister()
  const resend = useResendVerification()
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { currency: 'USD' },
  })

  if (registerUser.isSuccess) {
    const email = getValues('email').trim()
    return (
      <AuthLayout title="Check your inbox" footer={<Link to="/login">Back to log in</Link>}>
        <p>
          We sent a verification link to <strong>{email}</strong>. It expires in 24 hours, so open
          it soon.
        </p>
        <Button
          loading={resend.isPending}
          onClick={() =>
            resend.mutate(
              { email },
              {
                onSuccess: () =>
                  pushToast(
                    'If that account needs verifying, a new link is on its way.',
                    'success',
                  ),
              },
            )
          }
        >
          Resend the email
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      footer={<Link to="/login">I already have an account</Link>}
    >
      <form onSubmit={handleSubmit((values) => registerUser.mutate(values))} noValidate>
        <FormField label="Name" error={errors.name?.message}>
          <input autoComplete="name" {...register('name')} />
        </FormField>
        <FormField label="Email" error={errors.email?.message}>
          <input type="email" autoComplete="email" {...register('email')} />
        </FormField>
        <FormField label="Password" error={errors.password?.message} hint="At least 10 characters">
          <input type="password" autoComplete="new-password" {...register('password')} />
        </FormField>
        <FormField
          label="Currency"
          error={errors.currency?.message}
          hint="Used for all your amounts. It cannot be changed once you have data."
        >
          <select {...register('currency')}>
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>
        {registerUser.isError && (
          <p className="form-error">{getErrorMessage(registerUser.error)}</p>
        )}
        <Button type="submit" variant="primary" loading={registerUser.isPending}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
