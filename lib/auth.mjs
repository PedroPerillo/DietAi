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

// Server-side or Clerk-side trouble (bad secret key, JWKS unreachable). Must not look like a
// dead session: the browser signs users out on 401, so this is a 503 instead.
export class AuthUnavailableError extends Error {
  constructor(message = 'Sign-in is temporarily unavailable. Please try again in a moment.') {
    super(message);
    this.status = 503;
  }
}

// Clerk TokenVerificationError reasons that mean the token itself is bad: the user really
// needs to sign in again. Anything else (secret-key-invalid, jwk-remote-*, jwk-local-missing,
// jwk-failed-to-resolve, unexpected errors) is treated as our problem, not theirs.
const TOKEN_REASONS = new Set([
  'token-expired', 'token-invalid', 'token-invalid-algorithm', 'token-invalid-signature', 'token-not-active-yet',
  'token-iat-in-the-future', 'token-invalid-authorized-parties', 'token-verification-failed', 'jwk-kid-mismatch',
]);

export function classifyVerifyError(e) {
  const reason = e?.reason ?? e?.name ?? 'unknown';
  if (TOKEN_REASONS.has(reason)) {
    // An authorized-parties mismatch usually means CLERK_AUTHORIZED_PARTIES is misconfigured.
    const log = reason === 'token-invalid-authorized-parties' ? console.error : console.warn;
    log(`clerk token rejected: ${reason}${reason === 'token-invalid-authorized-parties' ? ` (CLERK_AUTHORIZED_PARTIES=${process.env.CLERK_AUTHORIZED_PARTIES ?? ''})` : ''}`);
    return new AuthError(reason === 'token-expired' ? 'Your session has expired. Please sign in again.' : 'Please sign in again.');
  }
  console.error(`clerk verification unavailable: ${reason}${e?.message ? ` - ${e.message}` : ''}`);
  return new AuthUnavailableError();
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
export async function verifyRequest(req, { verify = verifyToken } = {}) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (!token) throw new AuthError();
  const authorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let payload;
  try {
    payload = await verify(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      ...(authorizedParties.length && { authorizedParties }),
    });
  } catch (e) {
    throw classifyVerifyError(e);
  }
  if (!payload?.sub) throw new AuthError();
  return { userId: payload.sub };
}
