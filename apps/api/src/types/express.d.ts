export {};

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      auth?: { userId: string };
    }
  }
}
