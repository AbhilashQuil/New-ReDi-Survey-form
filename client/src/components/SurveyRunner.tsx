import { useState, useEffect } from 'react';
import axios from 'axios';
import { Form } from '@formio/react';

interface SurveyState {
  runId: string | null;
  currentTaskId: string | null;
  form: any;
  context: any;
  done: boolean;
}

export default function SurveyRunner() {
  const [surveyState, setSurveyState] = useState<SurveyState>({
    runId: null,
    currentTaskId: null,
    form: null,
    context: {},
    done: false
  });

  // Start the survey when component mounts
  useEffect(() => {
    startSurvey();
  }, []);

  // Start the survey
  const startSurvey = async () => {
    try {
      const response = await axios.post('/api/workflow/start');
      setSurveyState({
        runId: response.data.runId,
        currentTaskId: response.data.currentTaskId,
        form: response.data.form,
        context: response.data.context,
        done: response.data.done || false
      });
    } catch (error) {
      console.error('Failed to start survey:', error);
    }
  };

  // Submit form and go to next step
  const onSubmit = async (submission: any) => {
    if (!surveyState.runId) {
      console.error('No runId available');
      return;
    }

    try {
      const response = await axios.post('/api/workflow/next', {
        runId: surveyState.runId,
        taskId: surveyState.currentTaskId,
        values: submission.data
      });

      if (response.data.done) {
        setSurveyState({
          ...surveyState,
          done: true,
          context: response.data.context
        });
      } else {
        setSurveyState({
          ...surveyState,
          currentTaskId: response.data.currentTaskId,
          form: response.data.form,
          context: response.data.context
        });
      }
    } catch (error) {
      console.error('Failed to submit form:', error);
    }
  };

  // Render the component
  if (surveyState.done) {
    return (
      <div>
        <h2>Survey Complete!</h2>
        <pre>{JSON.stringify(surveyState.context, null, 2)}</pre>
      </div>
    );
  }

  if (!surveyState.form) {
    return <div>Loading survey...</div>;
  }

  return (
    <div>
      <h3>Task: {surveyState.currentTaskId}</h3>
      <Form
        form={surveyState.form}
        onSubmit={onSubmit}
        options={{
          submitMessage: '',
          disableAlerts: true
        }}
      />
    </div>
  );
}