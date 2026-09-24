import { httpClient } from '@/shared/api/httpClient'
import type { SessionResponse, SessionUser } from '../types'

export async function register(input: {
  name: string
  email: string
  password: string
  currency: string
}): Promise<void> {
  await httpClient.post('/auth/register', input)
}

export async function verifyEmail(input: { token: string }): Promise<void> {
  await httpClient.post('/auth/verify-email', input)
}

export async function resendVerification(input: { email: string }): Promise<void> {
  await httpClient.post('/auth/resend-verification', input)
}

export async function login(input: { email: string; password: string }): Promise<SessionResponse> {
  const { data } = await httpClient.post<SessionResponse>('/auth/login', input)
  return data
}

/** Uses the refresh cookie. skipAuthRefresh stops a 401 here from triggering another refresh. */
export async function refresh(): Promise<SessionResponse> {
  const { data } = await httpClient.post<SessionResponse>('/auth/refresh', undefined, {
    skipAuthRefresh: true,
  })
  return data
}

export async function logout(): Promise<void> {
  await httpClient.post('/auth/logout', undefined, { skipAuthRefresh: true })
}

export async function forgotPassword(input: { email: string }): Promise<void> {
  await httpClient.post('/auth/forgot-password', input)
}

export async function resetPassword(input: { token: string; password: string }): Promise<void> {
  await httpClient.post('/auth/reset-password', input)
}

export async function changePassword(input: {
  currentPassword: string
  newPassword: string
}): Promise<SessionResponse> {
  const { data } = await httpClient.post<SessionResponse>('/auth/change-password', input)
  return data
}

export async function updateProfile(input: { name: string }): Promise<SessionUser> {
  const { data } = await httpClient.patch<{ user: SessionUser }>('/auth/me', input)
  return data.user
}
