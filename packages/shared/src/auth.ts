export type PublicUser = {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
  /** Holds a platform role: the Admin portal is open to them. */
  platformAdmin: boolean;
};

/** The refresh token never appears here for cookie clients: it travels only in the httpOnly `rt` cookie. */
export type AuthResponse = { user: PublicUser; accessToken: string };
