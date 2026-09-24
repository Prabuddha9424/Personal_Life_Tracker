import { useMutation } from '@tanstack/react-query'
import { queryClient } from '@/shared/lib/queryClient'
import { logoutUser, startSession } from '../session'
import { useAuthStore } from '../store/authStore'
import type { SessionUser } from '../types'
import * as authApi from './authApi'

export function useSessionUser(): SessionUser | null {
  return useAuthStore((state) => state.user)
}

export function useRegister() {
  return useMutation({ mutationFn: authApi.register })
}

export function useVerifyEmail() {
  return useMutation({ mutationFn: authApi.verifyEmail })
}

export function useResendVerification() {
  return useMutation({ mutationFn: authApi.resendVerification })
}

export function useLogin() {
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (session) => {
      // A different person may be logging in on a browser the previous user just left.
      queryClient.clear()
      startSession(session)
    },
  })
}

export function useLogout() {
  return useMutation({ mutationFn: logoutUser })
}

export function useForgotPassword() {
  return useMutation({ mutationFn: authApi.forgotPassword })
}

export function useResetPassword() {
  return useMutation({ mutationFn: authApi.resetPassword })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: startSession,
  })
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: authApi.updateProfile,
    onSuccess: (user) => useAuthStore.getState().setUser(user),
  })
}
