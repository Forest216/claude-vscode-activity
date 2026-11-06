// Reads existing session signals only; it does not start or stop any work.
export function claudeLocalActivitySummary(session, subagentCount, subagentDot) {
  const permissions = session.permissionRequests.value;
  const dialogs = session.userDialogRequests.value;
  const busy = session.visiblyBusy.value;
  const pendingInput = session.pendingInput.value;
  const hostUnresponsive = session.context.hostUnresponsive.value;
  const heldElsewhere = session.heldElsewhere.value;
  const agents = session.agentMapAgents.value;
  const tasks = session.backgroundTasks.value;
  const outcomes = session.backgroundTaskOutcomes.value;

  let backgroundCount = 0;
  for (const [id, task] of tasks) {
    if (task.taskType === 'local_agent' || agents.has(id) || outcomes.has(id)) continue;
    backgroundCount += 1;
  }

  const mainPermission = permissions.some((request) => request.agentId == null);
  const mainDialog = dialogs.some((request) => request.agentId == null);
  const mainWaiting = mainPermission || mainDialog || (busy && pendingInput);
  let main = 'idle';
  let mainDot = 'idle';
  if (hostUnresponsive) {
    main = 'connection unresponsive';
    mainDot = 'failed';
  } else if (heldElsewhere) {
    main = 'active in another window';
  } else if (mainPermission) {
    main = 'waiting for permission';
    mainDot = 'waiting';
  } else if (mainWaiting) {
    main = 'waiting for input';
    mainDot = 'waiting';
  } else if (busy) {
    main = 'working';
    mainDot = 'running';
  }

  const childDot = subagentCount > 0 && dialogs.some((request) => request.agentId != null)
    ? 'waiting' : subagentDot;
  const backgroundDot = backgroundCount > 0 ? 'running' : 'idle';
  const sections = [
    { kind: 'main', label: `Main ${main}`, state: mainDot, title: `Main agent: ${main}` },
    {
      kind: 'subagents', label: `Subagents ${subagentCount}`, state: childDot,
      title: `Running subagents: ${subagentCount}. Status: ${childDot}.`,
    },
    {
      kind: 'background', label: `Background ${backgroundCount}`, state: backgroundDot,
      title: `Background tasks: ${backgroundCount}. Status: ${backgroundDot}.`,
    },
  ];

  // Keep the aggregate for the button's existing data attribute, not as a visible dot.
  let dot = subagentDot;
  if (mainWaiting || permissions.length > 0 || dialogs.length > 0 || childDot === 'waiting') {
    dot = 'waiting';
  } else if (hostUnresponsive) {
    dot = 'failed';
  } else if (busy || subagentCount > 0 || backgroundCount > 0) {
    dot = 'running';
  }

  return {
    label: sections.map((section) => section.label).join(' · '),
    title: `Main agent: ${main}; running subagents: ${subagentCount}; background tasks: ${backgroundCount}. Each dot describes only the section beside it. Click to open the agent map. Activity status is not a completion percentage.`,
    dot,
    sections,
    backgroundCount,
  };
}
