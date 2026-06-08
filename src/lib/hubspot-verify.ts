import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes

export function verifyHubSpotSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const signature = req.headers['x-hubspot-signature-v3'] as string | undefined;
  const timestamp = req.headers['x-hubspot-request-timestamp'] as string | undefined;

  if (!signature || !timestamp) {
    res.status(400).json({ error: 'Missing HubSpot signature headers' });
    return;
  }

  // Reject stale requests
  const requestAge = Date.now() - parseInt(timestamp, 10);
  if (requestAge > MAX_TIMESTAMP_AGE_MS || requestAge < 0) {
    res.status(400).json({ error: 'Request timestamp out of range' });
    return;
  }

  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET!;
  const rawBody: string = (req as Request & { rawBody?: string }).rawBody ?? '';
  const method = req.method.toUpperCase();
  // Cloud Run terminates TLS internally — req.protocol is always 'http'. HubSpot
  // signs with the public https:// URL, so hardcode the scheme to match.
  const uri = `https://${req.get('host')}${req.originalUrl}`;

  const signatureString = `${method}${uri}${rawBody}${timestamp}`;
  const expectedSignature = createHmac('sha256', clientSecret)
    .update(signatureString)
    .digest('base64');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}
