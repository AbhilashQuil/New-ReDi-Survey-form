import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
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
const neo4jDriver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD));
// Configuration object for easier access
const config = {
    neo4j: {
        uri: process.env.NEO4J_URI,
        username: process.env.NEO4J_USERNAME,
        password: process.env.NEO4J_PASSWORD,
    },
    database: {
        type: process.env.DB_TYPE,
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_DATABASE,
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
    },
    azureOpenAI: {
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION,
    },
};
const runs = new Map();
const NEXT_LINEAR = {
    Q1: 'Q2', Q2: 'Q3', Q3: undefined, Q4: undefined, Q5: undefined, Q6: 'Q7', Q7: 'Q8', Q8: 'Q9', Q9: undefined,
    EXIT_1: undefined, EXIT_2: undefined
};
function chooseNext(state, last) {
    const ctx = state.context;
    if (last === 'Q3') {
        const inferred = (ctx.inferredSkills ?? []);
        const hasValidSkills = inferred.length > 0 && !inferred.includes("No Skill");
        return hasValidSkills ? 'Q4' : 'Q5';
    }
    if (last === 'Q4') {
        // Iterative probing flow:
        // - If any skill got >=1 -> Q7
        // - Else if more skills to probe -> Q4
        // - Else all zero -> EXIT_1
        if (ctx.anySkillAboveZero) {
            return 'Q7';
        }
        const secondary = ctx.secSkills ?? [];
        const totalToProbe = 1 + secondary.length; // primary + secondaries
        const idx = typeof ctx.q4ProbeIndex === 'number' ? ctx.q4ProbeIndex : 0;
        if (idx + 1 < totalToProbe)
            return 'Q4';
        return 'EXIT_1';
    }
    if (last === 'Q5') {
        const sel = (ctx.recentSkills ?? []);
        const hasValidSkills = sel.length > 0 && !sel.includes("No Skills");
        return hasValidSkills ? 'Q6' : 'EXIT_1';
    }
    if (last === 'Q7') {
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
    return (NEXT_LINEAR[last] ?? 'EXIT_2');
}
// Function to get skills from Neo4j
async function getSkillsFromNeo4j() {
    const session = neo4jDriver.session();
    try {
        const result = await session.run('MATCH (s:Skill) RETURN s.name as name');
        return result.records.map(record => record.get('name'));
    }
    catch (error) {
        console.error('Error fetching skills from Neo4j:', error);
        return [];
    }
    finally {
        await session.close();
    }
}
// Function to match skill with Neo4j database
async function matchSkillWithNeo4j(extractedSkill, availableSkills) {
    if (availableSkills.length === 0)
        return extractedSkill;
    // First try direct match (case-insensitive)
    const directMatch = availableSkills.find(skill => skill.toLowerCase() === extractedSkill.toLowerCase());
    if (directMatch) {
        console.log(`Direct match found for "${extractedSkill}": "${directMatch}"`);
        return directMatch;
    }
    // If no direct match, use LLM for semantic matching
    const client = new OpenAIClient(config.azureOpenAI.endpoint, new AzureKeyCredential(config.azureOpenAI.apiKey));
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
        const response = await client.getChatCompletions(config.azureOpenAI.deploymentName, messages, {
            temperature: 0,
            maxTokens: 50,
            topP: 1
        });
        const match = response.choices[0].message.content.trim();
        console.log(`LLM response for "${extractedSkill}": "${match}"`);
        // Verify the match is actually in the available skills list
        if (availableSkills.includes(match)) {
            return match;
        }
        // If not found, return original
        return extractedSkill;
    }
    catch (error) {
        console.error('Error matching skill:', error);
        return extractedSkill;
    }
}
async function inferSkillsFromFreeText(ctx) {
    try {
        const client = new OpenAIClient(config.azureOpenAI.endpoint, new AzureKeyCredential(config.azureOpenAI.apiKey));
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
        const response = await client.getChatCompletions(config.azureOpenAI.deploymentName, messages, {
            temperature: 0.3,
            maxTokens: 200,
            responseFormat: { type: "json_object" }
        });
        const result = JSON.parse(response.choices[0].message.content);
        console.log('AI inference result (before Neo4j matching):', result);
        const availableSkills = await getSkillsFromNeo4j();
        console.log('Available skills from Neo4j:', availableSkills);
        // Deduplicate matched skills (unique, and must exist in Neo4j)
        const matchedSkills = [];
        const skillsInNeo4j = new Set();
        for (const skill of result.skills) {
            if (skill === "No Skill")
                continue;
            const matchedSkill = await matchSkillWithNeo4j(skill, availableSkills);
            if (!availableSkills.includes(matchedSkill)) {
                console.log(`Skill "${skill}" not found in Neo4j, excluding from results`);
                continue;
            }
            if (!skillsInNeo4j.has(matchedSkill)) {
                matchedSkills.push(matchedSkill);
                skillsInNeo4j.add(matchedSkill);
                console.log(`Added unique skill "${matchedSkill}"`);
            }
            else {
                console.log(`Duplicate "${matchedSkill}" skipped`);
            }
        }
        // Match primary skill; ensure it's in Neo4j; if not, fallback to first matched skill
        let matchedPrimary = result.primary;
        if (result.primary && result.primary !== "No Skill") {
            const candidate = await matchSkillWithNeo4j(result.primary, availableSkills);
            if (availableSkills.includes(candidate)) {
                matchedPrimary = candidate;
                console.log(`Primary skill "${result.primary}" matched to "${matchedPrimary}"`);
            }
            else {
                console.log(`Primary skill "${result.primary}" not found in Neo4j; falling back if needed`);
                matchedPrimary = matchedSkills.length > 0 ? matchedSkills[0] : undefined;
            }
        }
        const finalResult = {
            skills: matchedSkills.length > 0 ? matchedSkills : ["No Skill"],
            primary: matchedPrimary === "No Skill" ? undefined : matchedPrimary,
            role: result.role || undefined
        };
        console.log('AI inference result (after Neo4j matching):', finalResult);
        return finalResult;
    }
    catch (error) {
        console.error('Error inferring skills:', error);
        return { skills: [], primary: undefined, role: undefined };
    }
}
function buildQ8OptionsFromYears(yearsBand) {
    const bands = [
        { label: '0-2 years', value: '0-2', max: 2 },
        { label: '3-5 years', value: '3-5', max: 5 },
        { label: '6-9 years', value: '6-9', max: 9 },
        { label: '10+ years', value: '10+', max: Infinity },
    ];
    const map = { '0-2': 2, '3-5': 5, '6-9': 9, '10+': Infinity };
    const selectedMax = yearsBand && yearsBand in map ? map[yearsBand] : Infinity;
    return bands.filter(b => b.max <= selectedMax).map(({ label, value }) => ({ label, value }));
}
function loadForm(fileName, tokens) {
    const p = path.join(formsDir, fileName);
    let json = fs.readFileSync(p, 'utf8');
    json = json.replaceAll('&lt;&lt;name&gt;&gt;', tokens.name ?? '')
        .replaceAll('&lt;&lt;skill&gt;&gt;', tokens.skill ?? '')
        .replaceAll('&lt;&lt;role&gt;&gt;', tokens.role ?? '')
        .replaceAll('{{name}}', tokens.name ?? '')
        .replaceAll('{{skill}}', tokens.skill ?? '')
        .replaceAll('{{role}}', tokens.role ?? '')
        .replaceAll('{{q8Options}}', tokens.q8Options ?? '[]');
    return JSON.parse(json);
}
// Update the loadForm function to handle dynamic data replacement
function loadFormWithSecondarySkills(fileName, tokens, secondarySkills) {
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
    }
    else {
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
        const state = runs.get(runId);
        if (state && state.context.secSkills) {
            // Return secondary skills for this specific run
            const secSkills = state.context.secSkills;
            const skillsMatrix = secSkills.map((skill) => ({
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
app.post('/api/workflow/start', async (_req, res) => {
    const runId = uuid();
    const state = { runId, currentTaskId: 'Q1', context: {} };
    // initialize navigation history
    state.context.navHistory = [];
    runs.set(runId, state);
    try {
        await startWorkflowRun(runId);
    }
    catch { }
    const form = loadForm('Q1.json', { name: 'Candidate' });
    const payload = {
        done: false,
        currentTaskId: 'Q1',
        form,
        context: state.context,
        runId
    };
    res.json(payload);
});
app.post('/api/workflow/next', async (req, res) => {
    const schema = z.object({ runId: z.string(), taskId: z.string(), values: z.record(z.any()) });
    const { runId, taskId, values } = schema.parse(req.body);
    const state = runs.get(runId);
    if (!state || state.currentTaskId !== taskId)
        return res.status(400).json({ error: 'Invalid run or task' });
    // Merge submitted values into context
    state.context = { ...state.context, ...values };
    try {
        await signalFormSubmitted(runId, { taskId, values });
    }
    catch { }
    // After Q3: set up secondary skills and Q4 probing state
    if (taskId === 'Q3') {
        const inf = await inferSkillsFromFreeText(state.context);
        state.context.inferredSkills = inf.skills;
        state.context.suggestedPrimarySkill = inf.primary;
        state.context.inferredRole = inf.role;
        // Build unique secondary skills, excluding primary and "No Skill"
        const secondarySkillsRaw = (inf.skills || []);
        const secondarySkills = secondarySkillsRaw.filter((skill) => skill && skill !== inf.primary && skill !== "No Skill");
        const uniqueSecondaries = Array.from(new Set(secondarySkills));
        state.context.secSkills = uniqueSecondaries;
        // Initialize tracking
        if (!state.context.skillAssessments)
            state.context.skillAssessments = [];
        state.context.q4ProbeIndex = 0;
        state.context.q4Probed = [];
        state.context.anySkillAboveZero = false;
    }
    // Q4 probing: record current skill's score and update state
    if (taskId === 'Q4') {
        const secSkills = state.context.secSkills || [];
        const idx = typeof state.context.q4ProbeIndex === 'number' ? state.context.q4ProbeIndex : 0;
        const currentSkill = idx === 0
            ? (state.context.suggestedPrimarySkill || state.context.primarySkill || 'Unknown Skill')
            : (secSkills[idx - 1] || 'Unknown Skill');
        const score = Number(values.skillProficiency ?? 0);
        if (!state.context.skillAssessments)
            state.context.skillAssessments = [];
        if (!state.context.q4Probed)
            state.context.q4Probed = [];
        state.context.skillAssessments.push({
            skill: currentSkill,
            proficiencyLevel: score
        });
        state.context.q4Probed.push({
            skill: currentSkill,
            proficiencyLevel: score
        });
        if (score >= 1) {
            state.context.anySkillAboveZero = true;
            state.context.primarySkill = currentSkill; // promote
        }
        else {
            const totalToProbe = 1 + secSkills.length;
            if (idx + 1 < totalToProbe) {
                state.context.q4ProbeIndex = idx + 1; // advance to next secondary
            }
        }
    }
    if (taskId === 'Q6') {
        const primary = state.context.suggestedPrimarySkill
            || (Array.isArray(state.context.recentSkills) ? state.context.recentSkills[0] : undefined);
        state.context.primarySkill = primary;
    }
    if (taskId === 'Q7') {
        if (values.skillsMatrix) {
            values.skillsMatrix.forEach((assessment) => {
                state.context.skillAssessments.push({
                    skill: assessment.skill,
                    proficiencyLevel: assessment.proficiency
                });
            });
        }
    }
    const nextId = chooseNext(state, taskId);
    if (nextId.startsWith('EXIT')) {
        runs.delete(runId);
        const exitForm = loadForm(`${nextId}.json`, { role: state.context.inferredRole || '' });
        return res.json({ done: true, currentTaskId: nextId, form: exitForm, context: state.context });
    }
    // Push current task into back-stack for navigation (include Q1 so Q2 can go back)
    const isNavigable = /^Q[1-9]$/.test(taskId);
    if (isNavigable) {
        if (!Array.isArray(state.context.navHistory))
            state.context.navHistory = [];
        state.context.navHistory.push(taskId);
    }
    state.currentTaskId = nextId;
    let form;
    let skillToShow = 'the suggested skill';
    if (nextId === 'Q4') {
        const idx = typeof state.context.q4ProbeIndex === 'number' ? state.context.q4ProbeIndex : 0;
        if (idx === 0) {
            skillToShow = state.context.suggestedPrimarySkill || 'the suggested skill';
        }
        else {
            const list = state.context.secSkills || [];
            skillToShow = list[idx - 1] || (state.context.suggestedPrimarySkill || 'the suggested skill');
        }
        state.context.currentProbeSkill = skillToShow;
        const inject = {
            name: state.context.name || 'Candidate',
            skill: skillToShow,
            role: state.context.inferredRole || 'your role'
        };
        form = loadForm(`${nextId}.json`, inject);
    }
    else if (nextId === 'Q7') {
        // Only include unique secondary skills that were not probed in Q4
        const allSecondaries = Array.from(new Set(state.context.secSkills || []));
        const probedSet = new Set((state.context.q4Probed || []).map((a) => a.skill));
        const remainingSecondaries = allSecondaries.filter(s => !probedSet.has(s));
        const inject = {
            name: state.context.name || 'Candidate',
            skill: 'secondary skills',
            role: state.context.inferredRole || 'your role'
        };
        form = loadFormWithSecondarySkills(`${nextId}.json`, inject, remainingSecondaries);
        if (form.components) {
            const datagrid = form.components.find((c) => c.key === 'skillsMatrix');
            if (datagrid) {
                datagrid.dataSrc = 'values';
                datagrid.data = {
                    values: remainingSecondaries.map(skill => ({
                        skill: skill,
                        proficiency: ''
                    }))
                };
                delete datagrid.data.url;
            }
        }
    }
    else if (nextId === 'Q8') {
        const q8Options = buildQ8OptionsFromYears(state.context.yearsBand);
        const inject = {
            name: state.context.name || 'Candidate',
            skill: state.context.primarySkill || state.context.suggestedPrimarySkill || 'the suggested skill',
            role: state.context.inferredRole || 'your role',
            q8Options: JSON.stringify(q8Options),
        };
        form = loadForm(`${nextId}.json`, inject);
    }
    else {
        const skillToShow = state.context.primarySkill || state.context.suggestedPrimarySkill || 'the suggested skill';
        const inject = {
            name: state.context.name || 'Candidate',
            skill: skillToShow,
            role: state.context.inferredRole || 'your role'
        };
        form = loadForm(`${nextId}.json`, inject);
    }
    res.json({ done: false, currentTaskId: nextId, form, context: state.context });
});
// New: previous-step endpoint (Q2–Q9)
app.post('/api/workflow/prev', async (req, res) => {
    const schema = z.object({ runId: z.string() });
    const { runId } = schema.parse(req.body);
    const state = runs.get(runId);
    if (!state)
        return res.status(400).json({ error: 'Invalid runId' });
    const stack = Array.isArray(state.context.navHistory) ? state.context.navHistory : [];
    if (!stack.length) {
        // Nothing to go back to
        return res.json({
            done: false,
            currentTaskId: state.currentTaskId,
            form: loadForm(`${state.currentTaskId}.json`, {
                name: state.context.name || 'Candidate',
                skill: state.context.primarySkill || state.context.suggestedPrimarySkill || 'the suggested skill',
                role: state.context.inferredRole || 'your role'
            }),
            context: state.context
        });
    }
    const prevId = stack.pop();
    state.context.navHistory = stack;
    state.currentTaskId = prevId;
    let form;
    if (prevId === 'Q4') {
        // Use current q4ProbeIndex to determine which skill to show
        const idx = typeof state.context.q4ProbeIndex === 'number' ? state.context.q4ProbeIndex : 0;
        const secSkills = state.context.secSkills || [];
        const skillToShow = idx === 0
            ? (state.context.suggestedPrimarySkill || 'the suggested skill')
            : (secSkills[idx - 1] || (state.context.suggestedPrimarySkill || 'the suggested skill'));
        state.context.currentProbeSkill = skillToShow;
        form = loadForm('Q4.json', {
            name: state.context.name || 'Candidate',
            skill: skillToShow,
            role: state.context.inferredRole || 'your role'
        });
    }
    else if (prevId === 'Q7') {
        const allSecondaries = Array.from(new Set(state.context.secSkills || []));
        const probedSet = new Set((state.context.q4Probed || []).map((a) => a.skill));
        const remainingSecondaries = allSecondaries.filter(s => !probedSet.has(s));
        form = loadFormWithSecondarySkills('Q7.json', {
            name: state.context.name || 'Candidate',
            skill: 'secondary skills',
            role: state.context.inferredRole || 'your role'
        }, remainingSecondaries);
        if (form.components) {
            const datagrid = form.components.find((c) => c.key === 'skillsMatrix');
            if (datagrid) {
                datagrid.dataSrc = 'values';
                datagrid.data = {
                    values: remainingSecondaries.map(skill => ({
                        skill: skill,
                        proficiency: ''
                    }))
                };
                delete datagrid.data.url;
            }
        }
    }
    else if (prevId === 'Q8') {
        const q8Options = buildQ8OptionsFromYears(state.context.yearsBand);
        form = loadForm('Q8.json', {
            name: state.context.name || 'Candidate',
            skill: state.context.primarySkill || state.context.suggestedPrimarySkill || 'the suggested skill',
            role: state.context.inferredRole || 'your role',
            q8Options: JSON.stringify(q8Options),
        });
    }
    else {
        form = loadForm(`${prevId}.json`, {
            name: state.context.name || 'Candidate',
            skill: state.context.primarySkill || state.context.suggestedPrimarySkill || 'the suggested skill',
            role: state.context.inferredRole || 'your role'
        });
    }
    res.json({
        done: false,
        currentTaskId: prevId,
        form,
        context: state.context
    });
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
