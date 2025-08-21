export type RunState = {
  runId: string;
  currentTaskId: string;
  context: Record<string, any>;
};

export type NextStepResponse = {
  done: boolean;
  currentTaskId?: string;
  form?: any;
  context: Record<string, any>;
};
