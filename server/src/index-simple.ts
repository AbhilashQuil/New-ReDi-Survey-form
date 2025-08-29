import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';

const app = express();
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const PORT = process.env.PORT || 4000;
const formsDir = path.resolve(process.cwd(), 'src/forms');

type StepId = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9' | 'EXIT_1' | 'EXIT_2';

interface FormContext {
  name?: string;
  jobDesc?: string;
  responsibilities?: string;
  yearsBand?: string;
  inferredSkills?: string[];
  suggestedPrimarySkill?: string;
  inferredRole?: string;
  primarySkill?: string;
  recentSkills?: string[];
  proceedChoice?: 'proceed' | 'retake' | string;
  [key: string]: any;
}

interface RunState {
  runId: string;
  currentTaskId: string;
  context: FormContext;
}

const runs = new Map<string, RunState>();

function loadForm(fileName: string, tokens: Record<string,string>) {
  const p = path.join(formsDir, fileName);
  let json = fs.readFileSync(p, 'utf8');
  json = json.replaceAll('&lt;&lt;name&gt;&gt;', tokens.name ?? '')
             .replaceAll('&lt;&lt;skill&gt;&gt;', tokens.skill ?? '')
             .replaceAll('&lt;&lt;role&gt;&gt;', tokens.role ?? '')
             .replaceAll('{{name}}', tokens.name ?? '')
             .replaceAll('{{skill}}', tokens.skill ?? '')
             .replaceAll('{{role}}', tokens.role ?? '')
             .replaceAll('{{secSkillsData}}', '[]');
  return JSON.parse(json);
}

function chooseNext(state: RunState, last: StepId): StepId {
  const ctx = state.context;

  if (last === 'Q1') {
    return 'Q2';
  }
  
  if (last === 'Q2') {
    return 'Q3';
  }

  if (last === 'Q3') {
    // Mock: assume we have skills for testing
    return 'Q4';
  }
  
  if (last === 'Q4') {
    return 'Q5';
  }
  
  if (last === 'Q5') {
    return 'Q6';
  }
  
  if (last === 'Q6') {
    return 'Q7';
  }
  
  if (last === 'Q7') {
    return 'Q8';
  }
  
  if (last === 'Q8') {
    return 'Q9';
  }
  
  if (last === 'Q9') {
    return 'EXIT_2';
  }
  
  return 'EXIT_1';
}

// Mock inference function
async function inferSkillsFromFreeText(ctx: any): Promise<{ skills: string[], primary?: string, role?: string }> {
  // Mock response for testing
  return {
    skills: ['JavaScript', 'React', 'Node.js'],
    primary: 'React',
    role: 'Frontend Developer'
  };
}

app.post('/api/workflow/start', async (req, res) => {
  const runId = uuid();
  const state: RunState = {
    runId,
    currentTaskId: 'Q1',
    context: {}
  };
  runs.set(runId, state);

  const form = loadForm('Q1.json', {
    name: 'Candidate',
    skill: '',
    role: ''
  });
  
  res.json({ done: false, currentTaskId: 'Q1', form, context: state.context, runId });
});

app.post('/api/workflow/next', async (req, res) => {
  const schema = z.object({ runId: z.string(), taskId: z.string(), values: z.record(z.any()) });
  const { runId, taskId, values } = schema.parse(req.body);
  const state = runs.get(runId);
  if (!state || state.currentTaskId !== taskId) return res.status(400).json({ error: 'Invalid run or task' });

  state.context = { ...state.context, ...values };

  if (taskId === 'Q3') {
    const inf = await inferSkillsFromFreeText(state.context);
    state.context.inferredSkills = inf.skills;
    state.context.suggestedPrimarySkill = inf.primary;
    state.context.inferredRole = inf.role;
  }

  const nextId = chooseNext(state, taskId as StepId);
  state.currentTaskId = nextId;

  if (nextId.startsWith('EXIT_')) {
    const form = loadForm(`${nextId}.json`, {
      name: state.context.name || 'Candidate',
      skill: '',
      role: state.context.inferredRole || 'your role'
    });
    return res.json({ done: true, currentTaskId: nextId, form, context: state.context, runId });
  }

  let form;
  let skillToShow = '';
  
  if (nextId === 'Q4') {
    // Q4 shows primary skill
    skillToShow = state.context.suggestedPrimarySkill || 'React';
    console.log('Q4 - Primary skill:', skillToShow);
    
    const inject = {
      name: state.context.name || 'Candidate',
      skill: skillToShow,
      role: state.context.inferredRole || 'your role'
    };
    
    form = loadForm(`${nextId}.json`, inject);
  } else {
    skillToShow = state.context.primarySkill || state.context.suggestedPrimarySkill || 'the suggested skill';
    
    const inject = {
      name: state.context.name || 'Candidate',
      skill: skillToShow,
      role: state.context.inferredRole || 'your role'
    };
    
    form = loadForm(`${nextId}.json`, inject);
  }
  
  console.log('Loading form:', nextId);
  console.log('Current context:', state.context);
  
  res.json({ done: false, currentTaskId: nextId, form, context: state.context, runId });
});

// Mock API endpoints
app.get('/api/options/skills', (req, res) => {
  const mockSkills = [
    { id: 'javascript', label: 'JavaScript' },
    { id: 'react', label: 'React' },
    { id: 'nodejs', label: 'Node.js' },
    { id: 'python', label: 'Python' },
    { id: 'java', label: 'Java' }
  ];
  res.json(mockSkills);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});