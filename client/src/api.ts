const BASE = import.meta.env.VITE_API_BASE ?? '';

export async function startRun() {
  const res = await fetch(`${BASE}/api/workflow/start`, { method: 'POST' });
  if (!res.ok) throw new Error(`startRun failed: ${res.status}`);
  return res.json();
}

export async function nextStep(runId: string, taskId: string, values: any) {
  const res = await fetch(`${BASE}/api/workflow/next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, taskId, values })
  });
  if (!res.ok) throw new Error(`nextStep failed: ${res.status}`);
  return res.json();
}
