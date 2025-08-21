const BASE = 'http://localhost:4000';

export async function startRun() {
  const res = await fetch(`${BASE}/api/workflow/start`, { method: 'POST' });
  return res.json();
}

export async function nextStep(runId: string, taskId: string, values: any) {
  const res = await fetch(`${BASE}/api/workflow/next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, taskId, values })
  });
  return res.json();
}
