import { verifyToken } from '@clerk/backend';

// Clerk sign-in is on only when both keys are configured; without them the app stays open
// (local dev, demos). The publishable key is public; the secret key never leaves the server.
export const authEnabled = () => Boolean(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

export class AuthError extends Error {
  constructor(message = 'Please sign in to continue.') {
    super(message);
    this.status = 401;
  }
}

// A publishable key is "pk_<env>_" + base64("<frontend-api-host>$"). The browser loads
// Clerk's scripts from that host, so validate it strictly before handing it out.
export function frontendApiFromKey(key) {
  const encoded = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(String(key ?? ''))?.[2];
  if (!encoded) return null;
  const host = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? host : null;
}

export function publicAuthConfig() {
  if (!authEnabled()) return null;
  const frontendApi = frontendApiFromKey(process.env.CLERK_PUBLISHABLE_KEY);
  return frontendApi ? { publishableKey: process.env.CLERK_PUBLISHABLE_KEY, frontendApi } : null;
}

// Verifies the Clerk session token from "Authorization: Bearer <token>" and returns the user.
// CLERK_AUTHORIZED_PARTIES (comma-separated origins) pins tokens to this app's origin(s).
export async function verifyRequest(req) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (!token) throw new AuthError();
  const authorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let payload;
  try {
    payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      ...(authorizedParties.length && { authorizedParties }),
    });
  } catch {
    throw new AuthError('Your session has expired. Please sign in again.');
  }
  if (!payload?.sub) throw new AuthError();
  return { userId: payload.sub };
}
