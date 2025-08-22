import express from 'express';
import session from 'express-session';
import surveyRoutes from './routes/surveyRoutes.js';

const app = express();

app.use(express.json());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Routes
app.use('/api/survey', surveyRoutes);

export default app;
