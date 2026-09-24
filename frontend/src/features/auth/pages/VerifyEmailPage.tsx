import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { LoadingState } from '@/shared/ui/StateViews'
import { useVerifyEmail } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { ResendVerificationForm } from '../components/ResendVerificationForm'
import { useUrlToken } from '../useUrlToken'

export default function VerifyEmailPage() {
  const token = useUrlToken()
  const { mutate: verify, isSuccess, isError } = useVerifyEmail()
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    verify({ token })
  }, [token, verify])

  if (isSuccess) {
    return (
      <AuthLayout title="Email verified">
        <p>Your email is verified. You can log in now.</p>
        <Link className="btn btn--primary" to="/login">
          Log in
        </Link>
      </AuthLayout>
    )
  }

  if (token && !isError) {
    return (
      <AuthLayout title="Verifying your email">
        <LoadingState label="Verifying…" />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={isError ? 'That link did not work' : 'Check your inbox'}
      footer={<Link to="/login">Back to log in</Link>}
    >
      <p role={isError ? 'alert' : undefined}>
        {isError
          ? 'This link is invalid or has expired. Enter your email to get a new one.'
          : 'Open the link in the email we sent you to verify your address. Did not get it? We can send another.'}
      </p>
      <ResendVerificationForm />
    </AuthLayout>
  )
}
