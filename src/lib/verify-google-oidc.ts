import { OAuth2Client } from 'google-auth-library';
import type { Request, Response, NextFunction } from 'express';

const client = new OAuth2Client();

// Validates a Google-signed OIDC token attached by Cloud Tasks / Cloud Scheduler.
// audience must match the value the caller signed with (typically the Cloud Run URL).
// allowedEmails restricts callers to specific service accounts.
export function verifyGoogleOidcToken(audience: string, allowedEmails: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    const idToken = auth.slice('Bearer '.length);

    try {
      const ticket = await client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload?.email || !allowedEmails.includes(payload.email)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      next();
    } catch (err) {
      console.warn('OIDC verification failed', err);
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}
