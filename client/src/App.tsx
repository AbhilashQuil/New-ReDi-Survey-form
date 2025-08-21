import React from 'react';
import BpmnEditor from './components/BpmnEditor';
import SurveyRunner from './components/SurveyRunner';

export default function App() {
  return (
    <div style={{ padding: 16, display: 'grid', gap: 16 }}>
      <h2>Workflow-driven Survey (Form.io + BPMN + Temporal)</h2>
      <BpmnEditor />
      <SurveyRunner />
    </div>
  );
}
