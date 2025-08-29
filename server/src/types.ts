export interface SkillAssessment {
  skill: string;
  proficiencyLevel: number;
}

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
  secSkills?: string[]; // list of secondary skills

  // Q4 probing flow
  q4ProbeIndex?: number; // 0 = primary, 1..N = index into secSkills + 1
  q4Probed?: SkillAssessment[]; // history of probed skills at Q4
  anySkillAboveZero?: boolean; // true if any probed skill has >= 1
  currentProbeSkill?: string; // what Q4 is currently asking for

  // Aggregated assessments from Q4 and Q7
  skillAssessments?: SkillAssessment[];

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
