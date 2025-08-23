import { SkillExtractionService } from '../services/skillExtractionService.js';
import fs from 'fs/promises';
import path from 'path';

export class SurveyFlowController {
  constructor() {
    this.skillService = new SkillExtractionService();
  }

  async getNextQuestion(currentQuestion, sessionData) {
    const responses = sessionData.responses || {};
    
    switch (currentQuestion) {
      case 'Q3':
        // After Q3, extract skills and determine next question
        console.log('=== Q3 completed, extracting skills ===');
        console.log('Responses:', JSON.stringify(responses, null, 2));
        
        const skills = await this.skillService.extractSkillsFromResponses(responses);
        
        console.log('=== Skills returned from extraction service ===');
        console.log('Extracted skills:', JSON.stringify(skills, null, 2));
        
        sessionData.extractedSkills = skills;
        
        if (skills.primarySkill === "No Skill") {
          return { nextQuestion: 'Q5', skills };
        } else {
          return { nextQuestion: 'Q4', skills };
        }
        
      case 'Q4':
        // After Q4, check secondary skills to determine next
        const { extractedSkills } = sessionData;
        
        if (extractedSkills.secSkills !== "No Skills") {
          return { nextQuestion: 'Q7', skills: extractedSkills };
        } else {
          return { nextQuestion: 'Q8', skills: extractedSkills };
        }
        
      default:
        // Default linear progression
        const questionNumber = parseInt(currentQuestion.substring(1));
        return { nextQuestion: `Q${questionNumber + 1}`, skills: sessionData.extractedSkills };
    }
  }

  async getFormWithContext(formId, sessionData) {
    const formPath = path.join(process.cwd(), 'server', 'src', 'forms', `${formId}.json`);
    const formData = JSON.parse(await fs.readFile(formPath, 'utf8'));
    
    // Process Q4 with skill context
    if (formId === 'Q4' && sessionData.extractedSkills?.primarySkill) {
      console.log('=== Processing Q4 with skill context ===');
      console.log('Primary skill to use:', sessionData.extractedSkills.primarySkill);
      console.log('All extracted skills:', JSON.stringify(sessionData.extractedSkills, null, 2));
      
      return this.processFormWithSkill(formData, sessionData.extractedSkills.primarySkill);
    }
    
    return formData;
  }

  processFormWithSkill(formData, skill) {
    console.log('=== Processing form with skill ===');
    console.log('Skill to replace:', skill);
    
    // Deep clone to avoid mutation
    const processedForm = JSON.parse(JSON.stringify(formData));
    
    // Replace placeholder in components
    this.replaceSkillPlaceholder(processedForm.components, skill);
    
    // Log the processed form to verify replacement
    console.log('=== Processed form components ===');
    processedForm.components.forEach((component, index) => {
      if (component.type === 'content' && component.html) {
        console.log(`Component ${index} HTML:`, component.html);
      }
    });
    
    return processedForm;
  }

  replaceSkillPlaceholder(components, skill) {
    components.forEach(component => {
      if (component.type === 'content' && component.html) {
        const originalHtml = component.html;
        component.html = component.html.replace(/\{\{skill\}\}/g, skill);
        if (originalHtml !== component.html) {
          console.log('Replaced placeholder in HTML');
          console.log('Original:', originalHtml);
          console.log('New:', component.html);
        }
      }
      if (component.label) {
        const originalLabel = component.label;
        component.label = component.label.replace(/\{\{skill\}\}/g, skill);
        if (originalLabel !== component.label) {
          console.log('Replaced placeholder in label');
          console.log('Original:', originalLabel);
          console.log('New:', component.label);
        }
      }
      if (component.components) {
        this.replaceSkillPlaceholder(component.components, skill);
      }
    });
  }
}
