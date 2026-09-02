function normalizeId(value) {
  return String(value ?? '').trim();
}

function normalizeDependencies(task = {}) {
  return Array.isArray(task.dependencies)
    ? [...new Set(task.dependencies.map(normalizeId).filter(Boolean))]
    : [];
}

function assignFinalTaskIds(tasks = [], startId = 1, externalIdMap = new Map()) {
  const idMap = new Map(externalIdMap instanceof Map ? externalIdMap : Object.entries(externalIdMap || {}));
  const assigned = (Array.isArray(tasks) ? tasks : []).map((task, index) => {
    const finalId = startId + index;
    idMap.set(normalizeId(task.id), String(finalId));
    return { ...task, id: finalId };
  });

  return assigned.map((task, index) => ({
    ...task,
    dependencies: normalizeDependencies(tasks[index]).map((dependency) => (
      idMap.get(dependency) || dependency
    )),
  }));
}

function getTransitiveDependencyIds(task, tasks = []) {
  const byId = new Map((Array.isArray(tasks) ? tasks : []).map((item) => [normalizeId(item.id), item]));
  const visited = new Set();
  const visit = (taskId) => {
    const current = byId.get(normalizeId(taskId));
    if (!current) return;
    normalizeDependencies(current).forEach((dependencyId) => {
      if (visited.has(dependencyId)) return;
      visited.add(dependencyId);
      visit(dependencyId);
    });
  };
  visit(task?.id);
  return [...visited];
}

function validateTaskGraph(tasks = []) {
  const list = Array.isArray(tasks) ? tasks : [];
  const errors = [];
  const idCounts = new Map();
  const byId = new Map();

  list.forEach((task, index) => {
    const id = normalizeId(task.id);
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
    if (!byId.has(id)) byId.set(id, { task, index });
  });

  idCounts.forEach((count, id) => {
    if (!id || count > 1) {
      errors.push({
        code: 'DUPLICATE_TASK_ID',
        taskId: id || null,
        detail: id ? `Task ID ${id} appears ${count} times.` : 'A task has an empty ID.',
      });
    }
  });

  list.forEach((task, index) => {
    const id = normalizeId(task.id);
    normalizeDependencies(task).forEach((dependencyId) => {
      if (dependencyId === id) {
        errors.push({ code: 'SELF_DEPENDENCY', taskId: id, dependencyId, detail: `Task ${id} depends on itself.` });
        return;
      }
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        errors.push({
          code: 'DEPENDENCY_NOT_FOUND',
          taskId: id,
          dependencyId,
          detail: `Task ${id} depends on missing task ${dependencyId}.`,
        });
        return;
      }
      const isQualityGate = String(task.sourceBlueprintId || '').toLowerCase().endsWith('.quality_gate');
      if (isQualityGate && dependency.index >= index) {
        errors.push({
          code: 'QUALITY_GATE_DEPENDENCY_INVALID',
          taskId: id,
          dependencyId,
          detail: `Quality gate ${id} must depend only on earlier tasks.`,
        });
      }
    });
  });

  const visiting = new Set();
  const visited = new Set();
  const cycleKeys = new Set();
  const visit = (id, trail = []) => {
    if (visiting.has(id)) {
      const cycleStart = trail.indexOf(id);
      const cycle = [...trail.slice(cycleStart), id];
      const key = cycle.join('>');
      if (!cycleKeys.has(key)) {
        cycleKeys.add(key);
        errors.push({
          code: 'DEPENDENCY_CYCLE',
          taskId: id,
          cycle,
          detail: `Task dependency cycle detected: ${cycle.join(' -> ')}.`,
        });
      }
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    const nextTrail = [...trail, id];
    normalizeDependencies(byId.get(id).task).forEach((dependencyId) => visit(dependencyId, nextTrail));
    visiting.delete(id);
    visited.add(id);
  };
  byId.forEach((_, id) => visit(id));

  const inProgress = list.filter((task) => String(task.status || '').toLowerCase() === 'in-progress');
  if (inProgress.length > 1) {
    errors.push({
      code: 'MULTIPLE_IN_PROGRESS_TASKS',
      taskIds: inProgress.map((task) => normalizeId(task.id)),
      detail: `Only one task may be in progress; found ${inProgress.length}.`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export {
  assignFinalTaskIds,
  getTransitiveDependencyIds,
  validateTaskGraph,
};
