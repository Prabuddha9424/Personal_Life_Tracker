import { zodResolver } from '@hookform/resolvers/zod'
import axios from 'axios'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { pushToast } from '@/shared/ui/toast'
import { useLogin, useResendVerification } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { loginFormSchema, type LoginForm } from '../schemas'

/** Where to go after login: the page the user was sent away from, if it is a local path. */
function redirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const from = state.from
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from
  }
  return '/'
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useLogin()
  const resend = useResendVerification()
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginFormSchema) })

  const unverified = axios.isAxiosError(login.error) && login.error.response?.status === 403

  function onSubmit(values: LoginForm) {
    login.mutate(values, {
      onSuccess: () => navigate(redirectTarget(location.state), { replace: true }),
    })
  }

  function onResend() {
    resend.mutate(
      { email: getValues('email') },
      {
        onSuccess: () =>
          pushToast('If that account needs verifying, a new link is on its way.', 'success'),
      },
    )
  }

  return (
    <AuthLayout
      title="Log in"
      footer={
        <>
          <Link to="/forgot-password">Forgot your password?</Link>
          <Link to="/register">Create an account</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Email" error={errors.email?.message}>
          <input type="email" autoComplete="email" {...register('email')} />
        </FormField>
        <FormField label="Password" error={errors.password?.message}>
          <input type="password" autoComplete="current-password" {...register('password')} />
        </FormField>
        {login.isError && <p className="form-error">{getErrorMessage(login.error)}</p>}
        <Button type="submit" variant="primary" loading={login.isPending}>
          Log in
        </Button>
        {unverified && (
          <Button onClick={onResend} loading={resend.isPending}>
            Resend verification email
          </Button>
        )}
      </form>
    </AuthLayout>
  )
}
