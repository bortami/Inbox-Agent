import { CloudTasksClient } from '@google-cloud/tasks';
import type { TaskPayload } from '../types/index.js';

let _tasksClient: CloudTasksClient | null = null;

function getTasksClient(): CloudTasksClient {
  if (!_tasksClient) {
    _tasksClient = new CloudTasksClient();
  }
  return _tasksClient;
}

export async function enqueueWebhookTask(payload: TaskPayload): Promise<void> {
  const project = process.env.GCP_PROJECT_ID!;
  const location = process.env.GCP_LOCATION ?? 'us-central1';
  const queue = process.env.CLOUD_TASKS_QUEUE ?? 'webhook-processing';
  const serviceUrl = process.env.SERVICE_URL!;
  const serviceAccountEmail = process.env.SERVICE_ACCOUNT_EMAIL!;

  const parent = getTasksClient().queuePath(project, location, queue);

  await getTasksClient().createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: `${serviceUrl}/tasks/process`,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        oidcToken: {
          serviceAccountEmail,
          audience: serviceUrl,
        },
      },
    },
  });
}
