import { Router } from 'express';
import { getAuditLogByMessageId } from '../lib/firestore.js';
import { enqueueWebhookTask } from '../lib/cloud-tasks.js';
import type { TaskPayload } from '../types/index.js';

export const replayRouter = Router();

replayRouter.post('/', async (req, res) => {
  const { message_id } = req.body as { message_id?: string };

  if (!message_id) {
    res.status(400).json({ error: 'message_id required' });
    return;
  }

  try {
    const entry = await getAuditLogByMessageId(message_id);
    if (!entry) {
      res.status(404).json({ error: 'Audit log entry not found' });
      return;
    }

    const payload: TaskPayload = {
      portalId: parseInt(entry.portal_id, 10),
      event: {
        eventId: 0,
        subscriptionId: 0,
        portalId: parseInt(entry.portal_id, 10),
        appId: 0,
        occurredAt: Date.now(),
        subscriptionType: 'conversation.newMessage',
        attemptNumber: 0,
        objectId: parseInt(entry.conversation_id, 10),
        messageId: entry.message_id,
      },
    };

    await enqueueWebhookTask(payload);

    res.json({ queued: true, message_id, portal_id: entry.portal_id });
  } catch (err) {
    console.error('Replay error', { message_id, err });
    res.status(500).json({ error: 'Replay failed' });
  }
});
