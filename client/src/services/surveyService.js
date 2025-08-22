export class SurveyService {
  async getForm(formId) {
    const response = await fetch(`/api/survey/form/${formId}`);
    return response.json();
  }

  async submitForm(formId, data) {
    const response = await fetch(`/api/survey/form/${formId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
    
    const result = await response.json();
    
    // Redirect to next question
    if (result.nextQuestion) {
      window.location.href = result.redirectUrl;
    }
    
    return result;
  }
}
