import express from 'express';
import { SurveyFlowController } from '../controllers/surveyFlowController.js';

const router = express.Router();
const surveyController = new SurveyFlowController();

// Get form with context
router.get('/form/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    const sessionData = req.session || {};
    
    const form = await surveyController.getFormWithContext(formId, sessionData);
    res.json(form);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit form and get next question
router.post('/form/:formId/submit', async (req, res) => {
  try {
    const { formId } = req.params;
    const { data } = req.body;
    
    // Store response in session
    if (!req.session.responses) {
      req.session.responses = {};
    }
    req.session.responses[formId] = data;
    
    // Determine next question
    const { nextQuestion, skills } = await surveyController.getNextQuestion(formId, req.session);
    
    res.json({ 
      nextQuestion, 
      skills,
      redirectUrl: `/survey/${nextQuestion}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
