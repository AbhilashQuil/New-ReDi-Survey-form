import { OpenAIClient, AzureKeyCredential } from "@azure/openai";

export class SkillExtractionService {
  constructor() {
    this.client = new OpenAIClient(
      process.env.AZURE_OPENAI_ENDPOINT,
      new AzureKeyCredential(process.env.AZURE_OPENAI_API_KEY)
    );
    this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
  }

  async extractSkillsFromResponses(responses) {
    const { Q1, Q2, Q3 } = responses;
    
    // Combine responses into a single text
    const combinedText = this.combineResponses(Q1, Q2, Q3);
    
    // Extract skills using Azure OpenAI
    const skills = await this.callAzureOpenAIForSkills(combinedText);
    
    return skills;
  }

  combineResponses(q1, q2, q3) {
    // Extract text from form responses
    let text = '';
    
    // Assuming Q1, Q2, Q3 have text fields - adjust based on your actual form structure
    if (q1?.background) text += `Background: ${q1.background}. `;
    if (q2?.experience) text += `Experience: ${q2.experience}. `;
    if (q3?.interests) text += `Interests: ${q3.interests}. `;
    
    return text;
  }

  async callAzureOpenAIForSkills(text) {
    const messages = [
      { 
        role: "system", 
        content: "You are a skill extraction assistant. Always respond with valid JSON." 
      },
      { 
        role: "user", 
        content: `Extract skills from the following text and categorize them:
    
Text: "${text}"

Return a JSON object with:
- primarySkill: The most prominent skill (or "No Skill" if none found)
- secSkills: Comma-separated list of secondary skills (or "No Skills" if none found)

Example output:
{
  "primarySkill": "Web Development",
  "secSkills": "JavaScript, React, Node.js"
}`
      }
    ];

    try {
      const response = await this.client.getChatCompletions(
        this.deploymentName,
        messages,
        {
          temperature: 0.3,
          maxTokens: 200,
          topP: 0.95,
          frequencyPenalty: 0,
          presencePenalty: 0,
          // Azure OpenAI specific: response format for JSON
          responseFormat: { type: "json_object" }
        }
      );

      const result = response.choices[0].message.content;
      return JSON.parse(result);
    } catch (error) {
      console.error('Error extracting skills from Azure OpenAI:', error);
      
      // Log more details for debugging
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      
      return { primarySkill: "No Skill", secSkills: "No Skills" };
    }
  }
}
