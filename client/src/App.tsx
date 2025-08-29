import React from 'react';
import SurveyRunner from './components/SurveyRunner';
import './styles.css';

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-accent">ReDi</span> Skills Survey
        </div>
        <div className="header-actions">
          {/* room for links/toggles if needed */}
        </div>
      </header>

      <main className="content">
        <section className="card">
          <h2 className="card-title">Tell us about your experience</h2>
          <p className="card-subtitle">
            We’ll guide you through a few short steps and infer your primary and secondary skills.
          </p>
          <SurveyRunner />
        </section>
      </main>
    </div>
  );
}
