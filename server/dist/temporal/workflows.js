import { proxyActivities, defineSignal, setHandler, condition } from '@temporalio/workflow';
const { fetchDynamicChoices, persistAnswers, computeNextTask, inferSkillsFromResponses, validateFormData, generateSummary } = proxyActivities({
    startToCloseTimeout: '1 minute',
});
export const formSubmittedSignal = defineSignal('formSubmitted');
export async function surveyWorkflow(runId) {
    let currentTaskId = 'Q1';
    let context = {};
    let isComplete = false;
    setHandler(formSubmittedSignal, async ({ taskId, values }) => {
        // Validate form data
        const validation = await validateFormData({ taskId, values });
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors?.join(', ')}`);
        }
        // Persist answers
        await persistAnswers({ runId, taskId, values });
        // Update context
        context = { ...context, ...values };
        // Special handling for Q3 - infer skills
        if (taskId === 'Q3') {
            const skillsResult = await inferSkillsFromResponses({
                jobDesc: context.jobDesc,
                responsibilities: context.responsibilities,
                yearsBand: context.yearsBand
            });
            context.inferredSkills = skillsResult.skills;
            context.suggestedPrimarySkill = skillsResult.primary;
            context.inferredRole = skillsResult.role;
        }
        // Special handling for Q4 and Q6 - set primary skill
        if (taskId === 'Q4' || taskId === 'Q6') {
            const primary = context.suggestedPrimarySkill ||
                (Array.isArray(context.recentSkills) ? context.recentSkills[0] : undefined);
            context.primarySkill = primary;
        }
        // Compute next task
        const nextTask = await computeNextTask({ context, lastTaskId: taskId });
        currentTaskId = nextTask;
        // Check if we've reached an exit
        if (nextTask.startsWith('EXIT')) {
            isComplete = true;
        }
    });
    // Wait for completion
    await condition(() => isComplete);
    // Generate final summary
    const summary = await generateSummary({ context });
    console.log('Survey completed. Summary:', summary);
}
