# Workflow-driven Survey (Form.io + BPMN + Temporal)

This is a minimal starter for a **React** survey UI powered by **Form.io**, a **BPMN** editor (**bpmn-js**), and an optional durable backend based on **Temporal**.

## Quick start (no Temporal required)

### 1) Server
```bash
cd server
npm i
npm run dev
# server -> http://localhost:4000
```

### 2) Client
```bash
cd client
npm i
npm run dev
# open the Vite URL printed in the console
```

The client will render:
- a BPMN canvas (empty to start; the example diagram is at `server/src/bpmn/survey-flow.bpmn` if you want to load/visualize it),
- the current survey step driven by the backend.

## Turn on Temporal (optional)
- Start Temporal Server (Temporalite or docker `temporalio/auto-setup`).
- In a new terminal:
```bash
cd server
npm run worker
```
The HTTP server will try to start a workflow for each run and signal it on submissions. You can move branching, persistence, and external calls into Temporal **activities**.

## Where to plug your logic
- Replace `/api/options/*` endpoints in `server/src/index.ts` with calls to **Neo4j**, **MySQL**, or **LLM**.
- Implement `inferSkillsFromFreeText` in `server/src/index.ts` to parse Q2/Q3 and populate `inferredSkills`, `suggestedPrimarySkill`, and `inferredRole`.
- If you enable Temporal, move those calls into `src/temporal/activities.ts` and call them from the workflow.

## Forms
All step forms live in `server/src/forms/*.json` and use Form.io schema. Tokens `<<name>>`, `<<skill>>`, and `<<role>>` are injected by the server before sending to the client.

## License
All libraries used have permissive/free licenses (MIT/Apache for the core pieces). See each package for details.
