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
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    startSurvey();
  }, []);

  const startSurvey = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const response = await axios.post('/api/workflow/start');
      setSurveyState({
        runId: response.data.runId,
        currentTaskId: response.data.currentTaskId,
        form: response.data.form,
        context: response.data.context,
        done: response.data.done || false
      });
    } catch (error: any) {
      setErrorMsg(error?.response?.data?.error || 'Failed to start survey.');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (submission: any) => {
    if (!surveyState.runId) {
      setErrorMsg('No runId available.');
      return;
    }
    setErrorMsg(null);
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
    } catch (error: any) {
      setErrorMsg(error?.response?.data?.error || 'Failed to submit form.');
    }
  };

  if (loading) {
    return (
      <div className="state-block">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line short" />
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="state-block error">
        <strong>Something went wrong</strong>
        <div className="muted">{errorMsg}</div>
        <button className="btn" onClick={startSurvey}>Try again</button>
      </div>
    );
  }

  if (surveyState.done) {
    return (
      <div className="state-block success">
        <h3>Survey complete!</h3>
        <p className="muted">Here’s a summary of your responses:</p>
        <pre className="summary-pre">{JSON.stringify(surveyState.context, null, 2)}</pre>
      </div>
    );
  }

  if (!surveyState.form) {
    return <div className="state-block">Preparing your first step…</div>;
  }

  return (
    <div className="survey">
      <div className="step-header">
        <div className="step-dot" />
        <div>
          <div className="step-label">Current step</div>
          <div className="step-title">{surveyState.currentTaskId}</div>
        </div>
      </div>

      <div className="form-surface">
        <Form
          form={surveyState.form}
          onSubmit={onSubmit}
          options={{
            submitMessage: '',
            disableAlerts: true
          }}
        />
      </div>
    </div>
  );
}
