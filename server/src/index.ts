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
import neo4j from 'neo4j-driver';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_DEPLOYMENT_NAME',
  'AZURE_OPENAI_API_VERSION',
  'NEO4J_URI',
  'NEO4J_USERNAME',
  'NEO4J_PASSWORD'
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

// Initialize Neo4j driver
const neo4jDriver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!)
);

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
    const secondarySkills = ctx.secSkills || [];
    return secondarySkills.length > 0 ? 'Q7' : 'Q8';
  }
  
  if (last === 'Q5') {
    const sel = (ctx.recentSkills ?? []) as string[];
    const hasValidSkills = sel.length > 0 && !sel.includes("No Skills");
    return hasValidSkills ? 'Q6' : 'EXIT_1';
  }
  
  if (last === 'Q7') {
    // After Q7, go to Q8
    return 'Q8';
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

// Function to get skills from Neo4j
async function getSkillsFromNeo4j(): Promise<string[]> {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      'MATCH (s:Skill) RETURN s.name as name'
    );
    return result.records.map(record => record.get('name'));
  } catch (error) {
    console.error('Error fetching skills from Neo4j:', error);
    return [];
  } finally {
    await session.close();
  }
}

// Function to match skill with Neo4j database
async function matchSkillWithNeo4j(extractedSkill: string, availableSkills: string[]): Promise<string> {
  if (availableSkills.length === 0) return extractedSkill;

  // First try direct match (case-insensitive)
  const directMatch = availableSkills.find(
    skill => skill.toLowerCase() === extractedSkill.toLowerCase()
  );
  if (directMatch) {
    console.log(`Direct match found for "${extractedSkill}": "${directMatch}"`);
    return directMatch;
  }

  // If no direct match, use LLM for semantic matching
  const client = new OpenAIClient(
    config.azureOpenAI.endpoint,
    new AzureKeyCredential(config.azureOpenAI.apiKey)
  );

  const messages = [
    { 
      role: "system", 
      content: "You are a skill matching assistant. You must return ONLY the exact skill name from the provided list that best matches the input, or return the original skill if no match is found. Do not add any explanations." 
    },
    { 
      role: "user", 
      content: `Input skill: "${extractedSkill}"
      
Available skills in database:
${availableSkills.map((skill, index) => `${index + 1}. ${skill}`).join('\n')}

Return ONLY the exact skill name from the list above that best matches the input skill.
For example: "Java SE" should match to "Java", "JS" should match to "JavaScript", etc.
If no good match exists, return the original skill: "${extractedSkill}"`
    }
  ];

  try {
    const response = await client.getChatCompletions(
      config.azureOpenAI.deploymentName,
      messages,
      {
        temperature: 0,
        maxTokens: 50,
        topP: 1
      }
    );

    const match = response.choices[0].message.content.trim();
    console.log(`LLM response for "${extractedSkill}": "${match}"`);
    
    // Verify the match is actually in the available skills list
    if (availableSkills.includes(match)) {
      return match;
    }
    
    // If not found, return original
    return extractedSkill;
  } catch (error) {
    console.error('Error matching skill:', error);
    return extractedSkill;
  }
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

    console.log('AI inference result (before Neo4j matching):', result);
    
    // Get available skills from Neo4j
    const availableSkills = await getSkillsFromNeo4j();
    console.log('Available skills from Neo4j:', availableSkills);
    
    // Match each extracted skill with Neo4j database and only keep those that exist in Neo4j
    const matchedSkills = [];
    const skillsInNeo4j = new Set<string>();
    
    for (const skill of result.skills) {
      if (skill !== "No Skill") {
        const matchedSkill = await matchSkillWithNeo4j(skill, availableSkills);
        // Only add if the skill exists in Neo4j
        if (availableSkills.includes(matchedSkill)) {
          matchedSkills.push(matchedSkill);
          skillsInNeo4j.add(matchedSkill);
          console.log(`Skill "${skill}" matched to "${matchedSkill}" (exists in Neo4j)`);
        } else {
          console.log(`Skill "${skill}" not found in Neo4j, excluding from results`);
        }
      }
    }
    
    // Match primary skill
    let matchedPrimary = result.primary;
    if (result.primary && result.primary !== "No Skill") {
      matchedPrimary = await matchSkillWithNeo4j(result.primary, availableSkills);
      // Check if primary skill exists in Neo4j
      if (!availableSkills.includes(matchedPrimary)) {
        console.log(`Primary skill "${result.primary}" not found in Neo4j`);
        // If primary skill doesn't exist in Neo4j, pick the first matched skill as primary
        matchedPrimary = matchedSkills.length > 0 ? matchedSkills[0] : undefined;
      } else {
        console.log(`Primary skill "${result.primary}" matched to "${matchedPrimary}"`);
      }
    }
    
    const finalResult = {
      skills: matchedSkills.length > 0 ? matchedSkills : ["No Skill"],
      primary: matchedPrimary === "No Skill" ? undefined : matchedPrimary,
      role: result.role || undefined
    };
    
    console.log('AI inference result (after Neo4j matching):', finalResult);
    
    return finalResult;
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

// Update the loadForm function to handle dynamic data replacement
function loadFormWithSecondarySkills(fileName: string, tokens: Record<string,string>, secondarySkills?: string[]) {
  const p = path.join(formsDir, fileName);
  let json = fs.readFileSync(p, 'utf8');
  
  // Replace tokens
  json = json.replaceAll('&lt;&lt;name&gt;&gt;', tokens.name ?? '')
             .replaceAll('&lt;&lt;skill&gt;&gt;', tokens.skill ?? '')
             .replaceAll('&lt;&lt;role&gt;&gt;', tokens.role ?? '')
             .replaceAll('{{name}}', tokens.name ?? '')
             .replaceAll('{{skill}}', tokens.skill ?? '')
             .replaceAll('{{role}}', tokens.role ?? '');
  
  // If secondary skills are provided, create the default value
  if (secondarySkills && secondarySkills.length > 0) {
    const secSkillsData = secondarySkills.map(skill => ({
      skill: skill,
      proficiency: ''
    }));
    json = json.replace('{{secSkillsData}}', JSON.stringify(secSkillsData));
  } else {
    json = json.replace('{{secSkillsData}}', '[]');
  }
  
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

app.get('/api/options/skills-matrix', (req, res) => {
  // Check if this is being called from a form context
  const { runId } = req.query;
  
  if (runId) {
    const state = runs.get(runId as string);
    if (state && state.context.secSkills) {
      // Return secondary skills for this specific run
      const secSkills = state.context.secSkills;
      const skillsMatrix = secSkills.map((skill: string) => ({
        skill: skill,
        proficiency: null
      }));
      return res.json(skillsMatrix);
    }
  }
  
  // Default response if no context
  res.json([
    { skill: "AWS Architecture", proficiency: null },
    { skill: "DevOps", proficiency: null },
    { skill: "Neo4j", proficiency: null }
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

  if (taskId === 'Q3') {
    const inf = await inferSkillsFromFreeText(state.context);
    state.context.inferredSkills = inf.skills;
    state.context.suggestedPrimarySkill = inf.primary;
    state.context.inferredRole = inf.role;
    
    // Calculate secondary skills - only those that are different from primary and exist in Neo4j
    // Note: inf.skills already contains only skills that exist in Neo4j due to the matching logic
    const secondarySkills = inf.skills.filter((skill: string) => 
      skill !== inf.primary && skill !== "No Skill"
    );
    state.context.secSkills = secondarySkills;
    
    console.log('Primary skill:', inf.primary);
    console.log('Secondary skills (all from Neo4j):', secondarySkills);
    
    // Initialize skill assessment tracking
    state.context.skillAssessments = [];
  }
  
  if (taskId === 'Q4') {
    // Store the primary skill assessment
    const primarySkill = state.context.suggestedPrimarySkill;
    
    if (!state.context.skillAssessments) {
      state.context.skillAssessments = [];
    }
    
    state.context.skillAssessments.push({
      skill: primarySkill,
      proficiencyLevel: values.skillProficiency
    });
    
    // Set primary skill
    state.context.primarySkill = primarySkill;
  }
  
  if (taskId === 'Q6') {
    const primary = state.context.suggestedPrimarySkill
      || (Array.isArray(state.context.recentSkills) ? state.context.recentSkills[0] : undefined);
    state.context.primarySkill = primary;
  }
  
  if (taskId === 'Q7') {
    // Store all secondary skill assessments
    if (values.skillsMatrix) {
      values.skillsMatrix.forEach((assessment: any) => {
        state.context.skillAssessments.push({
          skill: assessment.skill,
          proficiencyLevel: assessment.proficiency
        });
      });
    }
    
    console.log('All skill assessments:', state.context.skillAssessments);
  }

  const nextId = chooseNext(state, taskId as StepId);

  if ((nextId as string).startsWith('EXIT')) {
    runs.delete(runId);
    const exitForm = loadForm(`${nextId}.json`, { role: state.context.inferredRole || '' });
    return res.json({ done: true, currentTaskId: nextId, form: exitForm, context: state.context });
  }

  state.currentTaskId = nextId;

  let form;
  let skillToShow = 'the suggested skill';
  
  if (nextId === 'Q4') {
    // Q4 shows primary skill
    skillToShow = state.context.suggestedPrimarySkill || 'the suggested skill';
    console.log('Q4 - Primary skill:', skillToShow);
    
    const inject = {
      name: state.context.name || 'Candidate',
      skill: skillToShow,
      role: state.context.inferredRole || 'your role'
    };
    
    form = loadForm(`${nextId}.json`, inject);
  } else if (nextId === 'Q7') {
    // Q7 shows secondary skills
    const secondarySkills = state.context.secSkills || [];
    
    console.log('Q7 - Loading with secondary skills:', secondarySkills);
    
    const inject = {
      name: state.context.name || 'Candidate',
      skill: 'secondary skills',
      role: state.context.inferredRole || 'your role'
    };
    
    form = loadFormWithSecondarySkills(`${nextId}.json`, inject, secondarySkills);
    
    // Update the form to use embedded data instead of URL
    if (form.components) {
      const datagrid = form.components.find((c: any) => c.key === 'skillsMatrix');
      if (datagrid) {
        // Change from URL to values
        datagrid.dataSrc = 'values';
        datagrid.data = {
          values: secondarySkills.map(skill => ({
            skill: skill,
            proficiency: ''
          }))
        };
        // Remove the URL property
        delete datagrid.data.url;
      }
    }
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
  
  res.json({ done: false, currentTaskId: nextId, form, context: state.context });
});

// Cleanup on server shutdown
process.on('SIGINT', async () => {
  await neo4jDriver.close();
  process.exit(0);
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
