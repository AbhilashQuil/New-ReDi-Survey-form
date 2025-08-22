export interface FormContext {
  name?: string;
  jobDesc?: string;
  responsibilities?: string;
  yearsBand?: string;
  inferredSkills?: string[];
  suggestedPrimarySkill?: string;
  inferredRole?: string;
  primarySkill?: string;
  recentSkills?: string[];
  proceedChoice?: 'proceed' | 'retake' | string;
  [key: string]: any;
}

export interface RunState {
  runId: string;
  currentTaskId: string;
  context: FormContext;
}

export interface NextStepResponse {
  done: boolean;
  currentTaskId: string;
  form: any;
  context: FormContext;
  runId?: string;
}
