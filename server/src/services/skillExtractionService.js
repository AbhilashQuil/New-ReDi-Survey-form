import { OpenAIClient, AzureKeyCredential } from "@azure/openai";
import neo4j from 'neo4j-driver';

export class SkillExtractionService {
  constructor() {
    this.client = new OpenAIClient(
      process.env.AZURE_OPENAI_ENDPOINT,
      new AzureKeyCredential(process.env.AZURE_OPENAI_API_KEY)
    );
    this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
    
    // Initialize Neo4j driver
    this.neo4jDriver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    );
  }

  async extractSkillsFromResponses(responses) {
    const { Q1, Q2, Q3 } = responses;
    
    // Combine responses into a single text
    const combinedText = this.combineResponses(Q1, Q2, Q3);
    
    // Extract skills using Azure OpenAI
    const extractedSkills = await this.callAzureOpenAIForSkills(combinedText);
    
    // Get all available skills from Neo4j
    const availableSkills = await this.getSkillsFromNeo4j();
    
    // Match extracted skills with Neo4j skills
    const matchedSkills = await this.matchSkillsWithDatabase(extractedSkills, availableSkills);
    
    return matchedSkills;
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

  async getSkillsFromNeo4j() {
    const session = this.neo4jDriver.session();
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

  async matchSkillsWithDatabase(extractedSkills, availableSkills) {
    // If no skills were extracted
    if (!extractedSkills.primarySkill || extractedSkills.primarySkill === "No Skill") {
      return { primarySkill: "No Skill", secSkills: "No Skills" };
    }

    // Use LLM to find best matches from available skills
    const matchedPrimary = await this.findBestSkillMatch(
      extractedSkills.primarySkill, 
      availableSkills
    );
    
    let matchedSecondary = [];
    if (extractedSkills.secSkills && extractedSkills.secSkills !== "No Skills") {
      const secondarySkillsList = extractedSkills.secSkills.split(',').map(s => s.trim());
      for (const skill of secondarySkillsList) {
        const match = await this.findBestSkillMatch(skill, availableSkills);
        if (match && match !== "No Match") {
          matchedSecondary.push(match);
        }
      }
    }

    return {
      primarySkill: matchedPrimary || "No Skill",
      secSkills: matchedSecondary.length > 0 ? matchedSecondary.join(", ") : "No Skills"
    };
  }

  async findBestSkillMatch(extractedSkill, availableSkills) {
    if (availableSkills.length === 0) return "No Match";

    const messages = [
      { 
        role: "system", 
        content: "You are a skill matching assistant. Find the best matching skill from the provided list." 
      },
      { 
        role: "user", 
        content: `Given the extracted skill: "${extractedSkill}"
        
Find the best matching skill from this list:
${availableSkills.join(', ')}

Return only the exact skill name from the list that best matches, or "No Match" if none are relevant.
Consider semantic similarity, abbreviations, and related technologies.`
      }
    ];

    try {
      const response = await this.client.getChatCompletions(
        this.deploymentName,
        messages,
        {
          temperature: 0.1,
          maxTokens: 50,
          topP: 0.95
        }
      );

      const match = response.choices[0].message.content.trim();
      
      // Verify the match is actually in the available skills list
      if (availableSkills.includes(match)) {
        return match;
      }
      
      // If LLM returned something not in the list, try case-insensitive match
      const caseInsensitiveMatch = availableSkills.find(
        skill => skill.toLowerCase() === match.toLowerCase()
      );
      
      return caseInsensitiveMatch || "No Match";
    } catch (error) {
      console.error('Error matching skill:', error);
      return "No Match";
    }
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

Focus on technical skills, programming languages, frameworks, tools, and domain expertise.

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
          responseFormat: { type: "json_object" }
        }
      );

      const result = response.choices[0].message.content;
      return JSON.parse(result);
    } catch (error) {
      console.error('Error extracting skills from Azure OpenAI:', error);
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      
      return { primarySkill: "No Skill", secSkills: "No Skills" };
    }
  }

  // Clean up Neo4j connection
  async close() {
    await this.neo4jDriver.close();
  }
}
