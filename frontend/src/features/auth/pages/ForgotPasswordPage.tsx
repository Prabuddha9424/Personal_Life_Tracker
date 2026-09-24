import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { useForgotPassword } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { forgotFormSchema, type ForgotForm } from '../schemas'

export default function ForgotPasswordPage() {
  const forgot = useForgotPassword()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotForm>({ resolver: zodResolver(forgotFormSchema) })

  return (
    <AuthLayout title="Forgot your password?" footer={<Link to="/login">Back to log in</Link>}>
      {forgot.isSuccess ? (
        <p role="status">If an account exists for that email, a reset link is on its way.</p>
      ) : (
        <form onSubmit={handleSubmit((values) => forgot.mutate(values))} noValidate>
          <FormField label="Email" error={errors.email?.message}>
            <input type="email" autoComplete="email" {...register('email')} />
          </FormField>
          {forgot.isError && <p className="form-error">{getErrorMessage(forgot.error)}</p>}
          <Button type="submit" variant="primary" loading={forgot.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
