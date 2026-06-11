import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export function verifyAdminToken(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers['x-admin-token'];
  const expected = process.env.REPLAY_ADMIN_TOKEN;

  if (typeof provided !== 'string' || !expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
