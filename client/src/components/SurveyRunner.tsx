import React, { useState, useEffect } from 'react';
import { Form } from '@formio/react';
import { startRun, nextStep } from '../api';

type Step = {
  runId: string;
  done: boolean;
  currentTaskId?: string;
  form?: any;
  context: any;
};

export default function SurveyRunner() {
  const [step, setStep] = useState<Step | null>(null);

  useEffect(() => { (async () => setStep(await startRun()))(); }, []);

  if (!step) return <div>Loading…</div>;
  if (step.done) return <div>✅ Completed!<pre>{JSON.stringify(step.context, null, 2)}</pre></div>;

  return (
    <div>
      <h3>Task: {step.currentTaskId}</h3>
      <Form
        form={step.form}
        onSubmit={async (submission: any) => {
          const res = await nextStep(step.runId, step.currentTaskId!, submission.data);
          setStep({ ...res, runId: step.runId });
        }}
      />
    </div>
  );
}
