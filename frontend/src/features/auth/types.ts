export interface SessionUser {
  id: string
  email: string
  name: string
  currency: string
}

export interface SessionResponse {
  accessToken: string
  user: SessionUser
}
