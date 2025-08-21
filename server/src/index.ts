import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { NextStepResponse, RunState } from './types.js';
// Optional Temporal bridge (safe if Temporal isn't running)
import { startWorkflowRun, signalFormSubmitted } from './temporal/client.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const formsDir = path.resolve(process.cwd(), 'src/forms');

type StepId = 'Q1'|'Q2'|'Q3'|'Q4'|'Q5'|'Q6'|'Q7'|'Q8'|'Q9'|'EXIT_1'|'EXIT_2';

const runs = new Map<string, RunState>();

const NEXT_LINEAR: Record<StepId, StepId|undefined> = {
  Q1:'Q2', Q2:'Q3', Q3:undefined, Q4:'Q7', Q5:undefined, Q6:'Q7', Q7:'Q8', Q8:'Q9', Q9:undefined,
  EXIT_1:undefined, EXIT_2:undefined
};

function chooseNext(state: RunState, last: StepId): StepId {
  const ctx = state.context;

  if (last === 'Q3') {
    const inferred = (ctx.inferredSkills ?? []) as string[];
    return inferred.length > 0 ? 'Q4' : 'Q5';
  }
  if (last === 'Q5') {
    const sel = (ctx.recentSkills ?? []) as string[];
    return sel.length > 0 ? 'Q6' : 'EXIT_1';
  }
  if (last === 'Q9') {
    switch (ctx.proceedChoice) {
      case 'proceed': return 'EXIT_2';
      case 'retake':
        state.context = {};
        return 'Q1';
      default: return 'EXIT_1';
    }
  }
  return (NEXT_LINEAR[last] ?? 'EXIT_2') as StepId;
}

async function inferSkillsFromFreeText(ctx: any): Promise<{ skills: string[], primary?: string, role?: string }> {
  // TODO: call Azure OpenAI / Neo4j using ctx.jobDesc, ctx.responsibilities, ctx.yearsBand
  return { skills: [], primary: undefined, role: undefined };
}

function loadForm(fileName: string, tokens: Record<string,string>) {
  const p = path.join(formsDir, fileName);
  let json = fs.readFileSync(p, 'utf8');
  json = json.replaceAll('&lt;&lt;name&gt;&gt;', tokens.name ?? '')
             .replaceAll('&lt;&lt;skill&gt;&gt;', tokens.skill ?? '')
             .replaceAll('&lt;&lt;role&gt;&gt;', tokens.role ?? '');
  return JSON.parse(json);
}

// Mock options
app.get('/api/options/skills', (_req, res) => {
  res.json([
    { id: "aws", label: "AWS Architecture" },
    { id: "devops", label: "DevOps" },
    { id: "neo4j", label: "Neo4j" },
    { id: "react", label: "React" }
  ]);
});

app.get('/api/options/skills-matrix', (_req, res) => {
  res.json([
    { skill: "AWS Architecture", level: null },
    { skill: "DevOps", level: null },
    { skill: "Neo4j", level: null }
  ]);
});

app.post('/api/workflow/start', async (_req, res) => {
  const runId = uuid();
  const state: RunState = { runId, currentTaskId: 'Q1', context: {} };
  runs.set(runId, state);
  try { await startWorkflowRun(runId); } catch {}
  const form = loadForm('Q1.json', { name: 'Candidate' });
  const payload: NextStepResponse = { done: false, currentTaskId: 'Q1', form, context: state.context };
  res.json(payload);
});

app.post('/api/workflow/next', async (req, res) => {
  const schema = z.object({ runId: z.string(), taskId: z.string(), values: z.record(z.any()) });
  const { runId, taskId, values } = schema.parse(req.body);
  const state = runs.get(runId);
  if (!state || state.currentTaskId !== taskId) return res.status(400).json({ error: 'Invalid run or task' });

  state.context = { ...state.context, ...values };

  try { await signalFormSubmitted(runId, { taskId, values }); } catch {}

  if (taskId === 'Q3') {
    const inf = await inferSkillsFromFreeText(state.context);
    state.context.inferredSkills = inf.skills;
    state.context.suggestedPrimarySkill = inf.primary;
    state.context.inferredRole = inf.role;
  }
  if (taskId === 'Q4' || taskId === 'Q6') {
    const primary = state.context.suggestedPrimarySkill
      || (Array.isArray(state.context.recentSkills) ? state.context.recentSkills[0] : undefined);
    state.context.primarySkill = primary;
  }

  const nextId = chooseNext(state, taskId as StepId);

  if ((nextId as string).startsWith('EXIT')) {
    runs.delete(runId);
    const exitForm = loadForm(`${nextId}.json`, { role: state.context.inferredRole || '' });
    return res.json({ done: true, currentTaskId: nextId, form: exitForm, context: state.context });
  }

  state.currentTaskId = nextId;
  const inject = {
    name: state.context.name || 'Candidate',
    skill: state.context.primarySkill || state.context.suggestedPrimarySkill || 'the suggested skill',
    role: state.context.inferredRole || 'your role'
  };
  const form = loadForm(`${nextId}.json`, inject);
  res.json({ done: false, currentTaskId: nextId, form, context: state.context });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
