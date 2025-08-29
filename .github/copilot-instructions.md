# ReDi Survey Form Application

ALWAYS follow these instructions first and only search for additional information if the instructions here are incomplete or found to be incorrect.

This is a workflow-driven survey application using React (client), Express/TypeScript (server), Form.io forms, BPMN workflow visualization, and optional Temporal backend integration with Azure OpenAI and Neo4j.

## Quick Start

### 1. Install Dependencies
```bash
# Root dependencies (Neo4j driver)
npm install

# Server dependencies  
cd server
npm install  # Takes ~2 seconds

# Client dependencies
cd ../client
npm install  # Takes ~2 seconds
```

### 2. Environment Setup
**CRITICAL**: The server requires environment variables. Create `server/.env` with:
```bash
# Required environment variables - use mock values for development
AZURE_OPENAI_ENDPOINT=https://mock-endpoint.openai.azure.com/
AZURE_OPENAI_API_KEY=mock-key-12345
AZURE_OPENAI_DEPLOYMENT_NAME=mock-deployment
AZURE_OPENAI_API_VERSION=2023-05-15
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=mock-password
DB_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=survey_db
DB_USERNAME=survey_user
DB_PASSWORD=mock-db-password
PORT=4000
```

### 3. Start Development Servers
**Start both servers in separate terminals:**

```bash
# Terminal 1 - Server (Express backend)
cd server
npm run dev
# Server starts at http://localhost:4000
# Takes ~5 seconds to start
```

```bash
# Terminal 2 - Client (React frontend)
cd client  
npm run dev
# Client starts at http://localhost:3000
# Takes ~5 seconds to start
```

## Build Commands

### Server Build
```bash
cd server
npm run build  # TypeScript compilation - Takes ~3 seconds
# WARNING: Currently has TypeScript errors in production build
# Use npm run dev for development which works with tsx
```

### Client Build  
```bash
cd client
npm run build  # Vite production build - Takes ~13 seconds
# NEVER CANCEL: Build takes 15 seconds. Set timeout to 30+ seconds.
# Creates optimized bundle in dist/ folder
```

### Production Server
```bash
cd server
npm run start  # Runs compiled JavaScript from dist/
# Only works after npm run build (currently has build errors)
```

## Application Validation

### Manual Testing Scenarios
**ALWAYS test these complete user flows after making changes:**

1. **Survey Flow Test**:
   - Navigate to http://localhost:3000
   - Verify BPMN canvas loads (top half of page)
   - Verify survey form loads with "Welcome to ReDi!" message
   - Select experience level (0-2, 3-5, 6-9, or 10+ years)
   - Click "Next" button
   - Verify progression to Q2 ("How would you describe your job?")
   - Test form submissions and workflow progression

2. **API Endpoint Test**:
   ```bash
   curl -X POST http://localhost:4000/api/workflow/start
   # Should return JSON with form data and runId
   ```

3. **Server Health Check**:
   ```bash
   curl http://localhost:4000/api/options/skills
   # Should return array of skill options
   ```

## Architecture & Key Locations

### Server Structure (`/server/src/`)
- `index.ts` - Main Express server with API endpoints
- `temporal/` - Temporal workflow components (optional)
  - `activities.ts` - Temporal activities (Azure OpenAI integration)
  - `workflows.ts` - Temporal workflow definitions
  - `worker.ts` - Temporal worker (has build issues)
  - `client.ts` - Temporal client connection
- `forms/` - Form.io JSON form definitions (Q1.json, Q2.json, etc.)
- `types.ts` - TypeScript type definitions

### Client Structure (`/client/src/`)
- `main.tsx` - React app entry point
- `App.tsx` - Main app component
- `components/SurveyRunner.tsx` - Survey form component
- `api.ts` - API client for server communication

### Key APIs
- `POST /api/workflow/start` - Start new survey session
- `POST /api/workflow/next` - Submit form and get next step
- `GET /api/options/skills` - Get available skills list
- `GET /api/options/skills-matrix` - Get skills matrix for assessment

## Common Issues & Solutions

### Build Errors
- **TypeScript errors in server build**: Use `npm run dev` for development. The dev server works correctly with tsx, but production builds currently have TypeScript strict mode errors.
- **Temporal worker errors**: The worker requires workflow files to be compiled, but this is optional for basic functionality.

### Development Issues
- **Missing environment variables**: Server will exit with error if .env file is missing required variables.
- **Port conflicts**: Default ports are 3000 (client) and 4000 (server).
- **Form.io CDN issues**: Some Form.io assets may be blocked in restricted environments but core functionality works.

## Development Workflow

### Making Changes
1. **Always start both dev servers first** using the commands above
2. **Test the complete survey flow** after any changes
3. **API changes**: Modify `server/src/index.ts` and test endpoints
4. **Form changes**: Edit JSON files in `server/src/forms/`
5. **UI changes**: Modify React components in `client/src/components/`

### External Integrations
- **Azure OpenAI**: Used for skill inference (mock credentials work for testing)
- **Neo4j**: Used for skill matching (mock credentials work for testing)  
- **Temporal**: Optional workflow engine (can be disabled for basic functionality)

### Time Expectations
- **Installation**: ~5 seconds total for all dependencies
- **Development startup**: ~10 seconds to start both servers
- **Client build**: ~15 seconds. NEVER CANCEL. Set timeout to 30+ minutes.
- **Server build**: ~3 seconds (but has TypeScript errors)

## Testing & Validation

**CRITICAL**: Always validate changes by:
1. Starting both development servers
2. Testing the complete survey workflow in browser
3. Verifying API endpoints respond correctly
4. Testing form submissions and navigation

**No linting or testing scripts available** - validation is manual through browser testing and API calls.

The application works correctly in development mode even without external services (Azure OpenAI, Neo4j, Temporal) due to mock environment variables and graceful error handling.