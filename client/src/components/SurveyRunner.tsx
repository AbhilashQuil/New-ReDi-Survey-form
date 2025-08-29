import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Form } from '@formio/react';
import '../styles/theme.css';

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

  // submitting overlay states
  const [submitting, setSubmitting] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const overlayTimer = useRef<number | null>(null);

  // Q4 zero-confirm modal states
  const [showZeroModal, setShowZeroModal] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<any | null>(null);

  useEffect(() => {
    startSurvey();
    return () => {
      if (overlayTimer.current) window.clearTimeout(overlayTimer.current);
    };
  }, []);

  const delayedShowOverlay = () => {
    overlayTimer.current = window.setTimeout(() => setOverlayVisible(true), 150);
  };

  const hideOverlayWithMinTime = async () => {
    if (overlayTimer.current) {
      window.clearTimeout(overlayTimer.current);
      overlayTimer.current = null;
    }
    if (overlayVisible) {
      await new Promise((r) => setTimeout(r, 300));
    }
    setOverlayVisible(false);
  };

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

  const submitToServer = async (submission: any) => {
    if (!surveyState.runId) {
      setErrorMsg('No runId available.');
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    delayedShowOverlay();
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
    } finally {
      await hideOverlayWithMinTime();
      setSubmitting(false);
    }
  };

  const onSubmit = async (submission: any) => {
    if (submitting) return;
    if (surveyState.currentTaskId === 'Q4' && Number(submission.data?.skillProficiency) === 0) {
      setPendingSubmission(submission);
      setShowZeroModal(true);
      return;
    }
    await submitToServer(submission);
  };

  const onConfirmZero = async () => {
    setShowZeroModal(false);
    if (pendingSubmission) {
      const sub = pendingSubmission;
      setPendingSubmission(null);
      await submitToServer(sub);
    }
  };

  const onCancelZero = () => {
    setShowZeroModal(false);
    setPendingSubmission(null);
  };

  const goPrev = async () => {
    if (!surveyState.runId || submitting) return;
    setSubmitting(true);
    delayedShowOverlay();
    try {
      const response = await axios.post('/api/workflow/prev', {
        runId: surveyState.runId
      });
      setSurveyState({
        ...surveyState,
        currentTaskId: response.data.currentTaskId,
        form: response.data.form,
        context: response.data.context,
        done: response.data.done || false
      });
    } catch (error: any) {
      setErrorMsg(error?.response?.data?.error || 'Failed to load previous step.');
    } finally {
      await hideOverlayWithMinTime();
      setSubmitting(false);
    }
  };

  const triggerFormSubmit = () => {
    if (submitting) return;
    const formEl = document.querySelector('.form-surface form') as HTMLFormElement | null;
    if (formEl) {
      // Let Form.io handle validation and data extraction
      formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
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

  const currentSkill = surveyState?.context?.currentProbeSkill;
  const showNav = /^Q[2-9]$/.test(String(surveyState.currentTaskId || ''));

  return (
    <div className="survey" aria-busy={submitting ? 'true' : 'false'}>
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

      {showNav && (
        <div className="nav-actions">
          <button
            onClick={goPrev}
            disabled={submitting}
            className="btn btn-secondary nav-btn"
          >
            Previous
          </button>
          <button
            onClick={triggerFormSubmit}
            disabled={submitting}
            className="btn btn-primary nav-btn"
          >
            Next
          </button>
        </div>
      )}

      {/* Zero confirmation modal for Q4 */}
      {showZeroModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="zero-modal-title"
          className="modal-overlay"
        >
          <div className="modal-card">
            <h3 id="zero-modal-title" className="modal-title">
              Confirm zero proficiency
            </h3>
            <p className="modal-body">
              You selected 0 (no proficiency){' '}
              {currentSkill ? <>for <b>{currentSkill}</b></> : null}. Do you want to confirm this?
            </p>
            <div className="modal-actions">
              <button onClick={onCancelZero} className="btn btn-secondary">
                Go back
              </button>
              <button onClick={onConfirmZero} className="btn btn-primary">
                Confirm 0
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit overlay */}
      {overlayVisible && (
        <div
          role="status"
          aria-live="polite"
          className="overlay"
        >
          <div className="overlay-content">
            <div className="spinner" />
            <div className="overlay-text">
              {surveyState.currentTaskId === 'Q1' ? 'Loading…' : 'Submitting…'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
