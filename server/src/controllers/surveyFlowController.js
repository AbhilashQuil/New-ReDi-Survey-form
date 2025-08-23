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
        const skills = await this.skillService.extractSkillsFromResponses(responses);
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
      return this.processFormWithSkill(formData, sessionData.extractedSkills.primarySkill);
    }
    
    return formData;
  }

  processFormWithSkill(formData, skill) {
    // Deep clone to avoid mutation
    const processedForm = JSON.parse(JSON.stringify(formData));
    
    // Replace placeholder in components
    this.replaceSkillPlaceholder(processedForm.components, skill);
    
    return processedForm;
  }

  replaceSkillPlaceholder(components, skill) {
    components.forEach(component => {
      if (component.type === 'content' && component.html) {
        // Fix: Replace {{skill}} instead of <<skill>>
        component.html = component.html.replace(/\{\{skill\}\}/g, skill);
      }
      if (component.label) {
        // Fix: Replace {{skill}} instead of <<skill>>
        component.label = component.label.replace(/\{\{skill\}\}/g, skill);
      }
      if (component.components) {
        this.replaceSkillPlaceholder(component.components, skill);
      }
    });
  }
}