import { useState, useEffect, useRef } from 'react';
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
    // show after 150ms to avoid flash on fast requests
    overlayTimer.current = window.setTimeout(() => setOverlayVisible(true), 150);
  };

  const hideOverlayWithMinTime = async () => {
    // ensure at least 300ms visible if it was shown
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
    // Intercept Q4 zero case to show confirmation modal
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
  const showPrev = /^Q[2-9]$/.test(String(surveyState.currentTaskId || ''));

  return (
    <div className="survey" aria-busy={submitting ? 'true' : 'false'}>
      <div className="step-header">
        <div className="step-dot" />
        <div>
          <div className="step-label">Current step</div>
          <div className="step-title">{surveyState.currentTaskId}</div>
        </div>
      </div>

      <div className="form-surface" style={{ position: 'relative' }}>
        <Form
          form={surveyState.form}
          onSubmit={onSubmit}
          options={{
            submitMessage: '',
            disableAlerts: true
          }}
        />

        {overlayVisible && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(255,255,255,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              pointerEvents: 'auto'
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: '3px solid rgba(161,0,255,0.25)',
                  borderTopColor: '#A100FF',
                  animation: 'spin 0.8s linear infinite'
                }}
              />
              <div style={{ marginTop: 12, color: '#7A00CC', fontWeight: 600 }}>
                {surveyState.currentTaskId === 'Q1' ? 'Loading…' : 'Submitting…'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Centered navigation bar */}
      {showPrev && (
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 12 }}>
          <button
            onClick={goPrev}
            disabled={submitting}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #ccc',
              background: '#fff',
              cursor: submitting ? 'not-allowed' : 'pointer'
            }}
          >
            Previous
          </button>
        </div>
      )}

      {/* Zero confirmation modal for Q4 */}
      {showZeroModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="zero-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 8,
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
              maxWidth: 480,
              width: '90%',
              padding: 20
            }}
          >
            <h3 id="zero-modal-title" style={{ margin: 0, color: '#7A00CC' }}>
              Confirm zero proficiency
            </h3>
            <p style={{ marginTop: 12 }}>
              You selected 0 (no proficiency){' '}
              {currentSkill ? <>for <b>{currentSkill}</b></> : null}. Do you want to confirm this?
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={onCancelZero} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #ccc', background: '#fff' }}>
                Go back
              </button>
              <button onClick={onConfirmZero} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: '#A100FF', color: '#fff' }}>
                Confirm 0
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Styling: center and lower the in-form "Next" button; spinner keyframes */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg);} }
        /* Center the Form.io submit button and add top gap */
        .form-surface .formio-component-button {
          display: flex;
          justify-content: center;
          margin-top: 24px;
        }
        /* Slightly lower the whole nav area */
        .survey .form-surface { margin-bottom: 8px; }
      `}</style>
    </div>
  );
}
