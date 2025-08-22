import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { NextStepResponse, RunState } from './types.js';
import { startWorkflowRun, signalFormSubmitted } from './temporal/client.js';
import { OpenAIClient, AzureKeyCredential } from "@azure/openai";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_DEPLOYMENT_NAME',
  'AZURE_OPENAI_API_VERSION'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const app = express();
// app.use(cors());
app.use(cors({
  origin: 'http://localhost:3000', // or your client URL
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const PORT = process.env.PORT || 4000;
const formsDir = path.resolve(process.cwd(), 'src/forms');

// Configuration object for easier access
const config = {
  neo4j: {
    uri: process.env.NEO4J_URI!,
    username: process.env.NEO4J_USERNAME!,
    password: process.env.NEO4J_PASSWORD!,
  },
  database: {
    type: process.env.DB_TYPE!,
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_DATABASE!,
    username: process.env.DB_USERNAME!,
    password: process.env.DB_PASSWORD!,
  },
  azureOpenAI: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION!,
  },
};

type StepId = 'Q1'|'Q2'|'Q3'|'Q4'|'Q5'|'Q6'|'Q7'|'Q8'|'Q9'|'EXIT_1'|'EXIT_2';

const runs = new Map<string, RunState>();

const NEXT_LINEAR: Record<StepId, StepId|undefined> = {
  Q1:'Q2', Q2:'Q3', Q3:undefined, Q4:undefined, Q5:undefined, Q6:'Q7', Q7:'Q8', Q8:'Q9', Q9:undefined,
  EXIT_1:undefined, EXIT_2:undefined
};

function chooseNext(state: RunState, last: StepId): StepId {
  const ctx = state.context;

  if (last === 'Q3') {
    const inferred = (ctx.inferredSkills ?? []) as string[];
    // Check if we have valid skills (not "No Skill")
    const hasValidSkills = inferred.length > 0 && !inferred.includes("No Skill");
    return hasValidSkills ? 'Q4' : 'Q5';
  }
  
  if (last === 'Q4') {
    // After Q4, check if we have secondary skills
    const allSkills = (ctx.inferredSkills ?? []) as string[];
    const primarySkill = ctx.primarySkill || ctx.suggestedPrimarySkill;
    const secondarySkills = allSkills.filter((skill: string) => 
      skill !== primarySkill && skill !== "No Skills"
    );
    return secondarySkills && secondarySkills.length > 0 ? 'Q7' : 'Q8';
  }
  
  if (last === 'Q5') {
    const sel = (ctx.recentSkills ?? []) as string[];
    const hasValidSkills = sel.length > 0 && !sel.includes("No Skills");
    return hasValidSkills ? 'Q6' : 'EXIT_1';
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
  try {
    // Initialize Azure OpenAI client
    const client = new OpenAIClient(
      config.azureOpenAI.endpoint,
      new AzureKeyCredential(config.azureOpenAI.apiKey)
    );

    // Combine responses from Q1, Q2, Q3
    const combinedText = `
      Job Description: ${ctx.jobDesc || ''}
      Responsibilities: ${ctx.responsibilities || ''}
      Years of Experience: ${ctx.yearsBand || ''}
    `;

    const messages = [
      { 
        role: "system", 
        content: "You are a skill extraction assistant. Extract technical skills and identify the primary skill and potential job role from the provided text." 
      },
      { 
        role: "user", 
        content: `Extract skills from the following information:

${combinedText}

Return a JSON object with:
- skills: Array of all technical skills found (or ["No Skill"] if none found)
- primary: The most prominent skill (or "No Skill" if none clearly stands out)
- role: The inferred job role based on the description (or undefined if unclear)

Example output:
{
  "skills": ["JavaScript", "React", "Node.js", "AWS"],
  "primary": "React",
  "role": "Frontend Developer"
}`
      }
    ];

    const response = await client.getChatCompletions(
      config.azureOpenAI.deploymentName,
      messages,
      {
        temperature: 0.3,
        maxTokens: 200,
        responseFormat: { type: "json_object" }
      }
    );

    const result = JSON.parse(response.choices[0].message.content);

    console.log('AI inference result:', result);
    
    // Ensure we return the expected structure
    return {
      skills: result.skills || [],
      primary: result.primary === "No Skill" ? undefined : result.primary,
      role: result.role || undefined
    };
  } catch (error) {
    console.error('Error inferring skills:', error);
    return { skills: [], primary: undefined, role: undefined };
  }
}

function loadForm(fileName: string, tokens: Record<string,string>) {
  const p = path.join(formsDir, fileName);
  let json = fs.readFileSync(p, 'utf8');
  json = json.replaceAll('&lt;&lt;name&gt;&gt;', tokens.name ?? '')
             .replaceAll('&lt;&lt;skill&gt;&gt;', tokens.skill ?? '')
             .replaceAll('&lt;&lt;role&gt;&gt;', tokens.role ?? '')
             .replaceAll('{{name}}', tokens.name ?? '')
             .replaceAll('{{skill}}', tokens.skill ?? '')
             .replaceAll('{{role}}', tokens.role ?? '');
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

// app.post('/api/workflow/start', async (_req, res) => {
//   const runId = uuid();
//   const state: RunState = { runId, currentTaskId: 'Q1', context: {} };
//   runs.set(runId, state);
//   try { await startWorkflowRun(runId); } catch {}
//   const form = loadForm('Q1.json', { name: 'Candidate' });
//   const payload: NextStepResponse = { done: false, currentTaskId: 'Q1', form, context: state.context };
//   res.json(payload);
// });

app.post('/api/workflow/start', async (_req, res) => {
  const runId = uuid();
  const state: RunState = { runId, currentTaskId: 'Q1', context: {} };
  runs.set(runId, state);
  try { await startWorkflowRun(runId); } catch {}
  const form = loadForm('Q1.json', { name: 'Candidate' });
  const payload: NextStepResponse = { 
    done: false, 
    currentTaskId: 'Q1', 
    form, 
    context: state.context,
    runId // Add this line to include runId in response
  };
  res.json(payload);
});

app.post('/api/workflow/next', async (req, res) => {
  const schema = z.object({ runId: z.string(), taskId: z.string(), values: z.record(z.any()) });
  const { runId, taskId, values } = schema.parse(req.body);
  const state = runs.get(runId);
  if (!state || state.currentTaskId !== taskId) return res.status(400).json({ error: 'Invalid run or task' });

  state.context = { ...state.context, ...values };

  try { await signalFormSubmitted(runId, { taskId, values }); } catch {}

  // if (taskId === 'Q3') {
  //   const inf = await inferSkillsFromFreeText(state.context);
  //   state.context.inferredSkills = inf.skills;
  //   state.context.suggestedPrimarySkill = inf.primary;
  //   state.context.inferredRole = inf.role;
  // }

  if (taskId === 'Q3') {
    const inf = await inferSkillsFromFreeText(state.context);
    state.context.inferredSkills = inf.skills;
    state.context.suggestedPrimarySkill = inf.primary;
    state.context.inferredRole = inf.role;
    
    // Initialize skill assessment tracking
    state.context.currentSkillIndex = 0;
    state.context.skillAssessments = [];
  }
  
  // if (taskId === 'Q4' || taskId === 'Q6') {
  //   const primary = state.context.suggestedPrimarySkill
  //     || (Array.isArray(state.context.recentSkills) ? state.context.recentSkills[0] : undefined);
  //   state.context.primarySkill = primary;
  // }

  if (taskId === 'Q4') {
    // Store the skill assessment
    const currentSkillIndex = state.context.currentSkillIndex || 0;
    const skills = state.context.inferredSkills || [];
    const currentSkill = skills[currentSkillIndex];
    
    if (!state.context.skillAssessments) {
      state.context.skillAssessments = [];
    }
    
    state.context.skillAssessments.push({
      skill: currentSkill,
      proficiencyLevel: values.proficiencyLevel
    });
    
    // Move to next skill if available
    if (currentSkillIndex < skills.length - 1) {
      state.context.currentSkillIndex = currentSkillIndex + 1;
    }
  }
  
  if (taskId === 'Q6') {
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
  // const inject = {
  //   name: state.context.name || 'Candidate',
  //   skill: state.context.primarySkill || state.context.suggestedPrimarySkill || 'the suggested skill',
  //   role: state.context.inferredRole || 'your role'
  // };

  // Determine which skill to show for Q4
  // let skillToShow = 'the suggested skill';
  // if (nextId === 'Q4') {
  //   const currentSkillIndex = state.context.currentSkillIndex || 0;
  //   const skills = state.context.inferredSkills || [];
  //   skillToShow = skills[currentSkillIndex] || 'the suggested skill';
  // } else {
  //   skillToShow = state.context.primarySkill || state.context.suggestedPrimarySkill || 'the suggested skill';
  // }

  // const inject = {
  //   name: state.context.name || 'Candidate',
  //   skill: skillToShow,
  //   role: state.context.inferredRole || 'your role'
  // };

  let skillToShow = 'the suggested skill';
  
  if (nextId === 'Q4') {
    // When going to Q4, we need to use the skills from inference
    const inferredSkills = state.context.inferredSkills || [];
    const currentSkillIndex = state.context.currentSkillIndex || 0;
  
    console.log('Q4 - Inferred skills:', inferredSkills);
    console.log('Q4 - Current skill index:', currentSkillIndex);
  
    if (inferredSkills.length > 0 && currentSkillIndex < inferredSkills.length) {
      skillToShow = inferredSkills[currentSkillIndex];
    } else if (state.context.suggestedPrimarySkill) {
      skillToShow = state.context.suggestedPrimarySkill;
    }
  } else {
    skillToShow = state.context.primarySkill || state.context.suggestedPrimarySkill || 'the suggested skill';
  }
  
  console.log('Skill to show:', skillToShow);
  
  const inject = {
    name: state.context.name || 'Candidate',
    skill: skillToShow,
    role: state.context.inferredRole || 'your role'
  };

  console.log('Loading form:', nextId);
  console.log('Inject object:', inject);
  console.log('Current context:', state.context);

  const form = loadForm(`${nextId}.json`, inject);
  res.json({ done: false, currentTaskId: nextId, form, context: state.context });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log('Azure OpenAI configured:', {
    endpoint: config.azureOpenAI.endpoint,
    deployment: config.azureOpenAI.deploymentName,
    apiVersion: config.azureOpenAI.apiVersion
  });
});