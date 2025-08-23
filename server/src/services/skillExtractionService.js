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
    
    console.log('Extracted skills from LLM:', extractedSkills);
    console.log('Available skills from Neo4j:', availableSkills);
    
    // Match extracted skills with Neo4j skills
    const matchedSkills = await this.matchSkillsWithDatabase(extractedSkills, availableSkills);
    
    console.log('Final matched skills:', matchedSkills);
    
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
    
    console.log(`Primary skill "${extractedSkills.primarySkill}" matched to "${matchedPrimary}"`);
    
    let matchedSecondary = [];
    if (extractedSkills.secSkills && extractedSkills.secSkills !== "No Skills") {
      const secondarySkillsList = extractedSkills.secSkills.split(',').map(s => s.trim());
      for (const skill of secondarySkillsList) {
        const match = await this.findBestSkillMatch(skill, availableSkills);
        console.log(`Secondary skill "${skill}" matched to "${match}"`);
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

    // First try direct match (case-insensitive)
    const directMatch = availableSkills.find(
      skill => skill.toLowerCase() === extractedSkill.toLowerCase()
    );
    if (directMatch) {
      console.log(`Direct match found for "${extractedSkill}": "${directMatch}"`);
      return directMatch;
    }

    // If no direct match, use LLM for semantic matching
    const messages = [
      { 
        role: "system", 
        content: "You are a skill matching assistant. You must return ONLY the exact skill name from the provided list that best matches the input, or 'No Match' if none are relevant. Do not add any explanations or modifications." 
      },
      { 
        role: "user", 
        content: `Input skill: "${extractedSkill}"
        
Available skills in database:
${availableSkills.map((skill, index) => `${index + 1}. ${skill}`).join('\n')}

Return ONLY the exact skill name from the list above that best matches the input skill.
Consider semantic similarity, abbreviations, and related technologies.
For example: "Java SE" should match to "Java", "JS" should match to "JavaScript", etc.

Your response must be exactly one of the skill names from the list above, or "No Match".`
      }
    ];

    try {
      const response = await this.client.getChatCompletions(
        this.deploymentName,
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
      
      // If LLM returned something not in the list, try to find partial match
      const partialMatch = availableSkills.find(skill => 
        skill.toLowerCase().includes(match.toLowerCase()) || 
        match.toLowerCase().includes(skill.toLowerCase())
      );
      
      if (partialMatch) {
        console.log(`Partial match found for "${extractedSkill}": "${partialMatch}"`);
        return partialMatch;
      }
      
      console.log(`No match found for "${extractedSkill}"`);
      return "No Match";
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
