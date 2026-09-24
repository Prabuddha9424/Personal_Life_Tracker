declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. Use req.user.id to scope every tenant query. */
      user?: { id: string }
    }
  }
}

export {}
