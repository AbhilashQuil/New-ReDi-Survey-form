export async function fetchDynamicChoices(args: any) {
  return [{ id: 'example', label: 'Example' }];
}

export async function persistAnswers(args: { runId: string; taskId: string; values: any }) {
  return;
}

export async function computeNextTask(args: { context: any; lastTaskId: string }): Promise<string> {
  const years = Number(args.context?.yearsExp || 0);
  if (args.lastTaskId === 'IntroForm') return years >= 5 ? 'SeniorForm' : 'JuniorForm';
  return 'End';
}
