export const EMBEDDED_USER_ID = 'manifest-embedded-local-user';
export const EMBEDDED_USER_NAME = 'Local Manifest instance';
export const EMBEDDED_USER_EMAIL = 'embedded@localhost.invalid';

export function createEmbeddedSession() {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);
  return {
    session: {
      id: 'manifest-embedded-session',
      userId: EMBEDDED_USER_ID,
      token: 'manifest-embedded-local-session',
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ipAddress: '127.0.0.1',
      userAgent: 'Embedded Manifest',
    },
    user: {
      id: EMBEDDED_USER_ID,
      name: EMBEDDED_USER_NAME,
      email: '',
      emailVerified: true,
      image: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  };
}
