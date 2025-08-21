import { Connection, Client } from '@temporalio/client';

export async function startWorkflowRun(runId: string) {
  try {
    const connection = await Connection.connect();
    const client = new Client({ connection });
    await client.workflow.start('surveyWorkflow', {
      taskQueue: 'survey-task-queue',
      workflowId: `survey-${runId}`,
      args: [runId]
    });
  } catch (e) {
    // Temporal not running is fine for starter
  }
}

export async function signalFormSubmitted(runId: string, payload: any) {
  try {
    const connection = await Connection.connect();
    const client = new Client({ connection });
    const handle = client.workflow.getHandle(`survey-${runId}`);
    await handle.signal('formSubmitted', payload);
  } catch (e) {}
}
