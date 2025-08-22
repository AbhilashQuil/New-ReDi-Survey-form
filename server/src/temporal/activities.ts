import { OpenAIClient, AzureKeyCredential } from "@azure/openai";
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const config = {
  azureOpenAI: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION!,
  },
};

export async function fetchDynamicChoices(args: { choiceType: string }): Promise<any[]> {
  // This could fetch from a database or external service
  switch (args.choiceType) {
    case 'skills':
      return [
        { id: "aws", label: "AWS Architecture" },
        { id: "devops", label: "DevOps" },
        { id: "neo4j", label: "Neo4j" },
        { id: "react", label: "React" },
        { id: "python", label: "Python" },
        { id: "javascript", label: "JavaScript" },
        { id: "docker", label: "Docker" },
        { id: "kubernetes", label: "Kubernetes" }
      ];
    case 'skills-matrix':
      return [
        { skill: "AWS Architecture", level: null },
        { skill: "DevOps", level: null },
        { skill: "Neo4j", level: null }
      ];
    default:
      return [];
  }
}

export async function persistAnswers(args: { runId: string; taskId: string; values: any }): Promise<void> {
  // Here you would persist to your database
  // For now, we'll just log
  console.log(`Persisting answers for run ${args.runId}, task ${args.taskId}:`, args.values);
  
  // Example database persistence (uncomment and adapt when ready):
  /*
  await db.responses.create({
    data: {
      runId: args.runId,
      taskId: args.taskId,
      values: args.values,
      timestamp: new Date()
    }
  });
  */
}

export async function inferSkillsFromResponses(args: { 
  jobDesc?: string; 
  responsibilities?: string; 
  yearsBand?: string; 
}): Promise<{ skills: string[], primary?: string, role?: string }> {
  try {
    const client = new OpenAIClient(
      config.azureOpenAI.endpoint,
      new AzureKeyCredential(config.azureOpenAI.apiKey)
    );

    const combinedText = `
      Job Description: ${args.jobDesc || ''}
      Responsibilities: ${args.responsibilities || ''}
      Years of Experience: ${args.yearsBand || ''}
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

export async function computeNextTask(args: { context: any; lastTaskId: string }): Promise<string> {
  const ctx = args.context;
  const last = args.lastTaskId;

  switch (last) {
    case 'Q1':
      return 'Q2';
    
    case 'Q2':
      return 'Q3';
    
    case 'Q3':
      // Check if skills were inferred
      const inferredSkills = ctx.inferredSkills || [];
      const hasValidSkills = inferredSkills.length > 0 && !inferredSkills.includes("No Skill");
      return hasValidSkills ? 'Q4' : 'Q5';
    
    case 'Q4':
      // Check for secondary skills
      const allSkills = ctx.inferredSkills || [];
      const primarySkill = ctx.primarySkill || ctx.suggestedPrimarySkill;
      const secondarySkills = allSkills.filter((skill: string) => 
        skill !== primarySkill && skill !== "No Skills"
      );
      return secondarySkills.length > 0 ? 'Q7' : 'Q8';
    
    case 'Q5':
      // Check if user selected any recent skills
      const selectedSkills = ctx.recentSkills || [];
      const hasSelectedSkills = selectedSkills.length > 0 && !selectedSkills.includes("No Skills");
      return hasSelectedSkills ? 'Q6' : 'EXIT_1';
    
    case 'Q6':
      return 'Q7';
    
    case 'Q7':
      return 'Q8';
    
    case 'Q8':
      return 'Q9';
    
    case 'Q9':
      // Check user's choice
      switch (ctx.proceedChoice) {
        case 'proceed':
          return 'EXIT_2';
        case 'retake':
          // Reset context and start over
          args.context = {};
          return 'Q1';
        default:
          return 'EXIT_1';
      }
    
    default:
      return 'EXIT_1';
  }
}

export async function generateSummary(args: { context: any }): Promise<string> {
  const ctx = args.context;
  
  // Generate a summary of the user's profile
  const summary = {
    name: ctx.name || 'Unknown',
    role: ctx.inferredRole || 'Not determined',
    primarySkill: ctx.primarySkill || 'Not specified',
    allSkills: [
      ...(ctx.inferredSkills || []),
      ...(ctx.recentSkills || [])
    ].filter((skill, index, self) => self.indexOf(skill) === index),
    experience: ctx.yearsBand || 'Not specified',
    proficiencyLevel: ctx.skillProficiency || 'Not assessed'
  };
  
  return JSON.stringify(summary, null, 2);
}

export async function validateFormData(args: { taskId: string; values: any }): Promise<{ valid: boolean; errors?: string[] }> {
  const errors: string[] = [];
  
  // Add validation logic based on taskId
  switch (args.taskId) {
    case 'Q1':
      if (!args.values.name?.trim()) {
        errors.push('Name is required');
      }
      break;
    
    case 'Q2':
      if (!args.values.jobDesc?.trim()) {
        errors.push('Job description is required');
      }
      break;
    
    case 'Q3':
      if (!args.values.responsibilities?.trim()) {
        errors.push('Responsibilities are required');
      }
      if (!args.values.yearsBand) {
        errors.push('Years of experience is required');
      }
      break;
    
    // Add more validation as needed
  }
  
  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}