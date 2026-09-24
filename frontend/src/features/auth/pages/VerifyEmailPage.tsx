import axios from 'axios'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { LoadingState } from '@/shared/ui/StateViews'
import { useVerifyEmail } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { ResendVerificationForm } from '../components/ResendVerificationForm'
import { useUrlToken } from '../useUrlToken'

export default function VerifyEmailPage() {
  const token = useUrlToken()
  const { mutate: verify, isSuccess, isError, error } = useVerifyEmail()
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

  // Only a 400 means the token is bad. Anything else (rate limit, 5xx, waking server, network)
  // failed before the token was used, and the token is gone from the URL, so offer a retry.
  const linkInvalid = axios.isAxiosError(error) && error.response?.status === 400

  if (token && isError && !linkInvalid) {
    return (
      <AuthLayout
        title="We could not verify your email"
        footer={<Link to="/login">Back to log in</Link>}
      >
        <p role="alert">{getErrorMessage(error)}</p>
        <Button variant="primary" onClick={() => verify({ token })}>
          Try again
        </Button>
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
      title={linkInvalid ? 'That link did not work' : 'Check your inbox'}
      footer={<Link to="/login">Back to log in</Link>}
    >
      <p role={linkInvalid ? 'alert' : undefined}>
        {linkInvalid
          ? 'This link is invalid or has expired. Enter your email to get a new one.'
          : 'Open the link in the email we sent you to verify your address. Did not get it? We can send another.'}
      </p>
      <ResendVerificationForm />
    </AuthLayout>
  )
}
