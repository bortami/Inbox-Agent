import { Router } from 'express';
import { verifyHubSpotSignature } from '../lib/hubspot-verify.js';
import { enqueueWebhookTask } from '../lib/cloud-tasks.js';
import type { WebhookEvent, TaskPayload } from '../types/index.js';

export const webhookRouter = Router();

webhookRouter.post('/', verifyHubSpotSignature, async (req, res) => {
  // Return 200 immediately — HubSpot will retry if we don't respond fast enough
  res.sendStatus(200);

  const events: WebhookEvent[] = req.body;
  console.log(`Webhook received: ${events.length} event(s) from portal ${events[0]?.portalId}`);

  for (const event of events) {
    if (
      event.subscriptionType === 'conversation.newMessage' &&
      (event.messageType === 'MESSAGE' || event.messageType == null)
    ) {
      const payload: TaskPayload = { portalId: event.portalId, event };
      try {
        await enqueueWebhookTask(payload);
        console.log(`Task enqueued for messageId=${event.messageId} conversationId=${event.objectId}`);
      } catch (err) {
        console.error('Failed to enqueue task', { eventId: event.eventId, err });
      }
    }
  }
});
