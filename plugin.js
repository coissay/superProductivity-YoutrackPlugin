
/**
 * YouTrack CSV Importer Plugin for SuperProductivity v1.4.0
 * Imports YouTrack issues from CSV export or syncs directly with YouTrack API
 */

const YOUTRACK_BASE_URL = 'https://youtrack.nperf.org';
const CONFIG_KEY = 'youtrack-sync-config';
const SYNC_INTERVAL_KEY = 'youtrack-last-sync';
const LAST_SYNC_TIMESTAMP_KEY = 'youtrack-last-sync-display';
const SYNC_PAGE_SIZE = 200;
const SYNC_MAX_ISSUES = 1000;
const DEFAULT_DUE_DATE_FIELD = 'Due Date';

// Register header button to open the import modal
PluginAPI.registerHeaderButton({
  label: 'YouTrack Sync',
  icon: 'view_kanban',
  onClick: () => {
    PluginAPI.showIndexHtmlAsView();
  },
});

/**
 * Save configuration
 */
async function saveConfig(config) {
  await PluginAPI.persistDataSynced(JSON.stringify({
    [CONFIG_KEY]: config,
  }));
}

/**
 * Load configuration
 */
async function loadConfig() {
  const data = await PluginAPI.loadSyncedData();
  if (data) {
    const parsed = JSON.parse(data);
    return parsed[CONFIG_KEY] || {};
  }
  return {};
}

// ==========================================
// SAVED QUERY PRESETS
// ==========================================

/**
 * Upserts a query preset ({ id, name, query, assignee }) into the config's preset list.
 * Returns the updated config - caller is responsible for persisting it via saveConfig.
 */
function saveQueryPreset(config, preset) {
  const presets = Array.isArray(config.queryPresets) ? [...config.queryPresets] : [];
  const id = preset.id || Date.now().toString(36);
  const index = presets.findIndex((p) => p.id === id);
  const updated = {
    id,
    name: preset.name,
    query: preset.query,
    assignee: preset.assignee || '',
    sprintFormat: preset.sprintFormat || DEFAULT_SPRINT_FORMAT,
    sprintDurationDays: preset.sprintDurationDays || DEFAULT_SPRINT_DURATION_DAYS,
    sprintStartDate: preset.sprintStartDate || '',
    sprintAutoEnabled: !!preset.sprintAutoEnabled,
    syncIntervalHours: preset.syncIntervalHours || 2,
    enableAutoSync: preset.enableAutoSync !== false,
    terminalStatuses: preset.terminalStatuses || '',
    dueDateFieldName: preset.dueDateFieldName || DEFAULT_DUE_DATE_FIELD,
    useSprintEndDateAsDueDate: !!preset.useSprintEndDateAsDueDate,
    allowSprintCarryOver: !!preset.allowSprintCarryOver,
  };

  if (index === -1) {
    presets.push(updated);
  } else {
    presets[index] = updated;
  }

  return { ...config, queryPresets: presets };
}

/**
 * Removes a query preset by id. Returns the updated config - caller persists via saveConfig.
 */
function deleteQueryPreset(config, id) {
  const presets = Array.isArray(config.queryPresets) ? config.queryPresets : [];
  return { ...config, queryPresets: presets.filter((p) => p.id !== id) };
}

// ==========================================
// SPRINT TAG GENERATION
// ==========================================

const DEFAULT_SPRINT_FORMAT = '{YEAR_SHORT}S{SPRINT_NUM_PADDED}';
const DEFAULT_SPRINT_DURATION_DAYS = 15;

/**
 * Number of working days (Mon-Fri) elapsed between two dates,
 * converted into a sprint number (1-indexed) given a sprint duration
 */
function calculateSprintNumber(startDate, currentDate, durationDays) {
  let sprintNum = 1;
  let workDays = 0;
  const checkDate = new Date(startDate);

  while (checkDate < currentDate) {
    const dayOfWeek = checkDate.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      workDays++;
      if (workDays === durationDays) {
        sprintNum++;
        workDays = 0;
      }
    }
    checkDate.setDate(checkDate.getDate() + 1);
  }

  return sprintNum;
}

/**
 * Generates a sprint title from a format string and a sprint number
 * Placeholders: {YEAR} (e.g. 2026), {YEAR_SHORT} (e.g. 26), {SPRINT_NUM} (e.g. 8), {SPRINT_NUM_PADDED} (e.g. 08)
 */
function generateSprintTitle(sprintNumber, format, year) {
  const yearShort = String(year).slice(-2);
  return format
      .split('{YEAR_SHORT}').join(yearShort)
      .split('{YEAR}').join(String(year))
      .split('{SPRINT_NUM_PADDED}').join(String(sprintNumber).padStart(2, '0'))
      .split('{SPRINT_NUM}').join(String(sprintNumber));
}

/**
 * Computes the current sprint title from the sprint config (format, duration, start date)
 */
function getCurrentSprintTitle(sprintConfig) {
  const format = sprintConfig.sprintFormat || DEFAULT_SPRINT_FORMAT;
  const durationDays = sprintConfig.sprintDurationDays || DEFAULT_SPRINT_DURATION_DAYS;
  const startDate = new Date(sprintConfig.sprintStartDate || Date.now());
  const now = new Date();

  const sprintNumber = calculateSprintNumber(startDate, now, durationDays);
  return generateSprintTitle(sprintNumber, format, now.getFullYear());
}

/**
 * Returns the calendar date right after the Nth sprint (1-indexed) finishes,
 * i.e. the start date of sprint N+1 - walks day by day counting working days,
 * same rules as calculateSprintNumber, so the two stay consistent.
 */
function getSprintBoundaryDate(startDate, durationDays, sprintNumber) {
  let workDays = 0;
  let completedSprints = 0;
  const checkDate = new Date(startDate);

  while (completedSprints < sprintNumber) {
    const dayOfWeek = checkDate.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      workDays++;
      if (workDays === durationDays) {
        completedSprints++;
        workDays = 0;
      }
    }
    checkDate.setDate(checkDate.getDate() + 1);
  }

  return checkDate;
}

/**
 * Formats a Date's LOCAL calendar date as "YYYY-MM-DD" - deliberately not toISOString(),
 * which converts to UTC and would shift the date backwards whenever the Date's time-of-day
 * (carried over from parsing a date-only string as UTC midnight) lands in the early morning
 * hours local time, rolling the UTC calendar date back by one.
 */
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Computes the last calendar day of the current sprint ("YYYY-MM-DD"), i.e. the day right
 * before the next sprint's boundary date.
 */
function getCurrentSprintEndDate(sprintConfig) {
  const durationDays = sprintConfig.sprintDurationDays || DEFAULT_SPRINT_DURATION_DAYS;
  const startDate = new Date(sprintConfig.sprintStartDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const sprintNumber = calculateSprintNumber(startDate, now, durationDays);
  const boundary = getSprintBoundaryDate(startDate, durationDays, sprintNumber);
  boundary.setDate(boundary.getDate() - 1);
  return formatLocalDate(boundary);
}

/**
 * Decides whether incoming tasks' due date should be forced to the current sprint's end date
 * instead of whatever the Due Date custom field says. Only applies when automatic sprint is
 * enabled, the "use sprint end date" toggle is on, and carry-over is NOT allowed - when
 * carry-over is allowed, tickets are expected to span sprints, so the normal field mapping
 * (or no due date) is used instead. Returns a "YYYY-MM-DD" string, or null.
 */
function computeDueDateOverride(config) {
  if (!config.sprintAutoEnabled || !config.sprintStartDate) {
    return null;
  }
  if (!config.useSprintEndDateAsDueDate || config.allowSprintCarryOver) {
    return null;
  }
  return getCurrentSprintEndDate(config);
}

/**
 * Previews the next N sprint titles (starting from the current sprint), plus how
 * many days remain until the next sprint starts - without depending on the
 * persisted config - used by the "Test" button
 */
function previewSprintTitles(format, durationDays, startDateStr, count = 6) {
  const resolvedFormat = format || DEFAULT_SPRINT_FORMAT;
  const resolvedDuration = durationDays || DEFAULT_SPRINT_DURATION_DAYS;
  const startDate = new Date(startDateStr || Date.now());
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const currentSprintNum = calculateSprintNumber(startDate, now, resolvedDuration);
  const titles = [];
  for (let i = 0; i < count; i++) {
    titles.push(generateSprintTitle(currentSprintNum + i, resolvedFormat, now.getFullYear()));
  }

  const nextSprintStart = getSprintBoundaryDate(startDate, resolvedDuration, currentSprintNum);
  nextSprintStart.setHours(0, 0, 0, 0);
  const daysUntilNextSprint = Math.round((nextSprintStart - now) / (1000 * 60 * 60 * 24));

  return { titles, daysUntilNextSprint };
}

/**
 * Resolves a raw YouTrack query by replacing the {CURRENT_SPRINT} placeholder
 * with the current sprint, and appending an Assignee filter if set
 */
function resolveYouTrackQuery(rawQuery, config) {
  let query = (rawQuery || '').trim();
  const hasPlaceholder = query.includes('{CURRENT_SPRINT}');

  if (hasPlaceholder && !config.sprintAutoEnabled) {
    throw new Error(
        'The query contains {CURRENT_SPRINT} but automatic sprint is not enabled ' +
        '(checkbox in the "Automatic sprint" section).'
    );
  }

  if (config.sprintAutoEnabled) {
    if (!config.sprintStartDate) {
      throw new Error('Automatic sprint is enabled but no start date is configured.');
    }
    query = query.split('{CURRENT_SPRINT}').join(getCurrentSprintTitle(config));
  }

  if (config.assignee && config.assignee.trim()) {
    query += ` Assignee: ${config.assignee.trim()}`;
  }

  return query.trim();
}

/**
 * Splits a comma-separated "terminal statuses" string into a trimmed, non-empty list
 */
function parseTerminalStatuses(raw) {
  return (raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
}

/**
 * Fetch issues from YouTrack API using a raw YouTrack query string.
 * Paginates with $skip until a page returns fewer than SYNC_PAGE_SIZE issues,
 * up to a SYNC_MAX_ISSUES safety cap (logged if hit, so truncation isn't silent).
 * `terminalStatusesRaw` is a comma-separated list of statuses (e.g. "Done, MEP, Canceled")
 * that should mark the resulting task as done instead of adding a status tag.
 */
async function fetchFromYouTrack(token, query, terminalStatusesRaw, dueDateFieldName, dueDateOverride) {
  try {
    const allIssues = [];
    let skip = 0;

    while (true) {
      const url = new URL(`${YOUTRACK_BASE_URL}/api/issues`);
      url.searchParams.append('query', query);
      url.searchParams.append(
          'fields',
          'id,idReadable,summary,description,project(name,shortName),customFields(name,value(name))'
      );
      url.searchParams.append('$top', String(SYNC_PAGE_SIZE));
      url.searchParams.append('$skip', String(skip));

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`YouTrack API error: ${response.status} ${response.statusText}`);
      }

      const page = await response.json();
      allIssues.push(...page);

      const hitSafetyCap = allIssues.length >= SYNC_MAX_ISSUES;
      if (page.length < SYNC_PAGE_SIZE || hitSafetyCap) {
        if (hitSafetyCap && page.length === SYNC_PAGE_SIZE) {
          console.warn(
              `YouTrack query truncated at ${SYNC_MAX_ISSUES} issues — refine your query to narrow results.`
          );
        }
        break;
      }

      skip += SYNC_PAGE_SIZE;
    }

    return convertYouTrackIssuesToTasks(
        allIssues,
        parseTerminalStatuses(terminalStatusesRaw),
        dueDateFieldName || DEFAULT_DUE_DATE_FIELD,
        dueDateOverride || null
    );
  } catch (error) {
    throw new Error(`Failed to fetch from YouTrack: ${error.message}`);
  }
}

/**
 * Convert a YouTrack date custom field value (millisecond timestamp) into a
 * "YYYY-MM-DD" string matching the Task#dueDay shape, or null if absent/invalid.
 */
function toDueDay(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Convert YouTrack issues to SuperProductivity task format.
 * If an issue's State matches one of `terminalStatuses` (case-insensitive), the resulting
 * task is marked `isDone: true` and the status is NOT added as a tag - only Priority is.
 */
function convertYouTrackIssuesToTasks(issues, terminalStatuses = [], dueDateFieldName = DEFAULT_DUE_DATE_FIELD, dueDateOverride = null) {
  return issues.map((issue) => {
    const customFields = issue.customFields || [];
    const getCustomField = (name) => {
      const field = customFields.find((f) => f.name === name);
      return field?.value?.name || field?.value || null;
    };

    const state = getCustomField('State') || '';
    const priority = getCustomField('Priority') || '';
    const dueDay = dueDateOverride || toDueDay(getCustomField(dueDateFieldName));
    const isTerminal = !!state && terminalStatuses.some(
        (s) => s.toLowerCase() === state.toLowerCase()
    );

    const header = `YouTrack: ${issue.idReadable}\nPriority: ${priority || 'N/A'}`;
    const body = (issue.description || '').trim();

    return {
      title: `${issue.idReadable} - ${issue.summary}`,
      project: issue.project?.name || issue.project?.shortName || 'YouTrack',
      description: body ? `${header}\n\n${body}` : header,
      tags: [isTerminal ? null : state, priority].filter(Boolean),
      dueDay: dueDay,
      isDone: isTerminal,
      issueId: issue.idReadable,
    };
  });
}

/**
 * Records "now" as the last time a YouTrack sync actually ran (manual or automatic),
 * for display in the UI - independent of the auto-sync interval gating, which uses
 * its own separate key and only updates when tasks were actually found.
 */
function recordLastSyncTimestamp() {
  localStorage.setItem(LAST_SYNC_TIMESTAMP_KEY, Date.now().toString());
}

/**
 * Returns the timestamp (ms) of the last sync run, or null if none happened yet.
 */
function getLastSyncTimestamp() {
  const value = localStorage.getItem(LAST_SYNC_TIMESTAMP_KEY);
  return value ? parseInt(value, 10) : null;
}

/**
 * Auto-sync with YouTrack (called periodically)
 */
async function autoSyncYouTrack() {
  try {
    const config = await loadConfig();

    if (!config.token || !config.query || !config.enableAutoSync) {
      return; // Not configured or disabled
    }

    const lastSync = localStorage.getItem(SYNC_INTERVAL_KEY);
    const now = Date.now();
    const syncInterval = (config.syncIntervalHours || 2) * 60 * 60 * 1000;

    // Only sync if interval has passed
    if (lastSync && (now - parseInt(lastSync)) < syncInterval) {
      return;
    }

    const tasks = await fetchFromYouTrack(
        config.token,
        resolveYouTrackQuery(config.query, config),
        config.terminalStatuses,
        config.dueDateFieldName,
        computeDueDateOverride(config)
    );
    recordLastSyncTimestamp();

    if (tasks.length > 0) {
      const { created, updated } = await importTasks(tasks);
      localStorage.setItem(SYNC_INTERVAL_KEY, now.toString());

      if (created > 0 || updated > 0) {
        PluginAPI.notify({
          title: 'YouTrack Sync',
          body: `${created} new task(s), ${updated} updated`,
        });
      }
    }
  } catch (error) {
    console.error('Auto-sync error:', error);
    PluginAPI.showSnack({ msg: `YouTrack auto-sync failed: ${error.message}`, type: 'ERROR' });
  }
}

// Set up auto-sync check on plugin load (runs every 5 minutes)
setInterval(autoSyncYouTrack, 5 * 60 * 1000);

/**
 * Calculate statistics from parsed tasks
 */
function calculateStats(tasks) {
  const projects = new Set();
  const tags = new Set();

  tasks.forEach((task) => {
    projects.add(task.project);
    task.tags.forEach((tag) => tags.add(tag));
  });

  return {
    totalTasks: tasks.length,
    projectCount: projects.size,
    tagCount: tags.size,
  };
}

/**
 * Parse CSV content (RFC 4180 compliant).
 * `terminalStatusesRaw` works the same way as for the YouTrack sync path: a comma-separated
 * list of statuses (e.g. "Done, MEP") - a row whose State matches one (case-insensitive)
 * gets `isDone: true` instead of a status tag.
 */
function parseCSV(text, terminalStatusesRaw) {
  const terminalStatuses = parseTerminalStatuses(terminalStatusesRaw);
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.substring(1);
  }

  const rows = parseCSVRows(text);

  if (rows.length < 2) {
    throw new Error('The CSV file is empty or invalid');
  }

  const headers = rows[0];
  const summaryIndex = headers.indexOf('Summary');
  const projectIndex = headers.indexOf('Project');
  const descriptionIndex = headers.indexOf('Description');
  const issueIdIndex = headers.indexOf('Issue Id');
  const tagsIndex = headers.indexOf('Tags');
  const stateIndex = headers.indexOf('State');

  if (summaryIndex === -1 || projectIndex === -1) {
    throw new Error('Required columns are missing (Summary or Project)');
  }

  const tasks = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    if (values.length <= summaryIndex) continue;

    const issueId = issueIdIndex !== -1 ? (values[issueIdIndex] || '') : '';
    const summary = values[summaryIndex] || '';
    const title = issueId ? `${issueId} - ${summary}` : summary;

    const csvTags = tagsIndex !== -1 ? (values[tagsIndex] || '') : '';
    const tagsList = csvTags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

    const state = stateIndex !== -1 ? (values[stateIndex] || '') : '';
    const isTerminal = !!state && terminalStatuses.some(
        (s) => s.toLowerCase() === state.toLowerCase()
    );
    if (state && !isTerminal) {
      tagsList.push(state);
    }

    const task = {
      title: title,
      project: values[projectIndex] || 'Default',
      description: descriptionIndex !== -1 ? (values[descriptionIndex] || '') : '',
      tags: tagsList,
      isDone: isTerminal,
      issueId: issueId || null,
    };

    if (task.title && task.title.trim()) {
      tasks.push(task);
    }
  }

  return tasks;
}

/**
 * Parse CSV into rows, handling quoted fields with newlines
 */
function parseCSVRows(text) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
        continue;
      } else if (char === '\r' && nextChar === '\n') {
        currentRow.push(currentField);
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i += 2;
        continue;
      } else if (char === '\r') {
        currentRow.push(currentField);
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.length > 0) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Get all tags with their colors for display
 */
async function getAllTagsWithColors() {
  return await PluginAPI.getAllTags();
}

/**
 * Finds an existing task whose title is prefixed with "<issueId> - ", within a given task pool.
 */
function findTaskByIssueId(issueId, taskPool) {
  if (!issueId) {
    return undefined;
  }
  return taskPool.find((t) => t.title.startsWith(`${issueId} - `));
}

/**
 * Classifies incoming tasks against existing SuperProductivity tasks. Active matches always
 * take priority over archived ones, so a ticket that was previously revived (re-created after
 * coming back from a Done/archived state) gets updated on later syncs instead of re-created
 * every time - otherwise the stale archived copy would keep matching forever and spawn a new
 * duplicate on every single sync.
 * - toUpdate: a matching ACTIVE task exists ({ existing, incoming } pairs)
 * - toSkip: no active match, but a matching ARCHIVED task exists AND the incoming status is
 *   still one of the "statuses to mark as Done" (the archive is correct, leave it alone)
 * - toCreate: no active match and either no archived match, or an archived match whose incoming
 *   status is NOT done - since the Plugin API has no way to un-archive a task, the only option
 *   is to create a new active task for it
 */
async function classifySyncTasks(tasks) {
  const [activeTasks, archivedTasks] = await Promise.all([
    PluginAPI.getTasks(),
    PluginAPI.getArchivedTasks(),
  ]);

  const toCreate = [];
  const toUpdate = [];
  const toSkip = [];

  for (const task of tasks) {
    const existingActive = findTaskByIssueId(task.issueId, activeTasks);
    if (existingActive) {
      toUpdate.push({ existing: existingActive, incoming: task });
      continue;
    }

    const archivedMatch = findTaskByIssueId(task.issueId, archivedTasks);
    if (archivedMatch) {
      if (task.isDone) {
        toSkip.push(task);
      } else {
        toCreate.push(task);
      }
      continue;
    }

    toCreate.push(task);
  }

  return { toCreate, toUpdate, toSkip };
}

/**
 * True if two arrays contain the same set of values, ignoring order (works for tag ids or titles).
 */
function sameSet(a, b) {
  const setA = new Set(a || []);
  const setB = new Set(b || []);
  if (setA.size !== setB.size) {
    return false;
  }
  for (const value of setA) {
    if (!setB.has(value)) {
      return false;
    }
  }
  return true;
}

/**
 * Splits a classifySyncTasks() `toUpdate` list into tasks that actually have a difference
 * (title, notes, due date, isDone, project or tags) vs ones that are already in sync and would
 * be a no-op update. Read-only (never creates tags/projects) so it's safe to call during preview,
 * before the user has confirmed anything.
 */
async function splitUpdatesByChange(toUpdate) {
  const [existingTags, existingProjects] = await Promise.all([
    PluginAPI.getAllTags(),
    PluginAPI.getAllProjects(),
  ]);
  const tagTitleById = new Map(existingTags.map((t) => [t.id, t.title]));
  const projectTitleById = new Map(existingProjects.map((p) => [p.id, p.title]));

  const changed = [];
  const unchanged = [];

  for (const pair of toUpdate) {
    const { existing, incoming } = pair;
    const desiredNotes = (incoming.description && incoming.description.trim()) || '';
    const existingTagTitles = (existing.tagIds || [])
        .map((id) => tagTitleById.get(id))
        .filter(Boolean);
    const existingProjectTitle = projectTitleById.get(existing.projectId) || '';

    const hasChanges = (
        existing.title !== incoming.title ||
        (existing.notes || '') !== desiredNotes ||
        (existing.dueDay || null) !== (incoming.dueDay || null) ||
        Boolean(existing.isDone) !== Boolean(incoming.isDone) ||
        existingProjectTitle !== incoming.project ||
        !sameSet(existingTagTitles, incoming.tags)
    );

    if (hasChanges) {
      changed.push(pair);
    } else {
      unchanged.push(pair);
    }
  }

  return { changed, unchanged };
}

/**
 * Import tasks into SuperProductivity: creates tasks for new YouTrack/CSV issues,
 * and updates already-imported tasks (matched by the "<issueId> - " title prefix)
 * in place when their title, description, tags, due date or project changed.
 * Tasks matching an ARCHIVED task are skipped entirely (never recreated, never touched).
 */
async function importTasks(tasks) {
  const { toCreate, toUpdate } = await classifySyncTasks(tasks);
  let created = 0;
  let updated = 0;

  const allInvolvedTasks = [...toCreate, ...toUpdate.map((u) => u.incoming)];

  const tagTitlesSet = new Set();
  const projectNamesSet = new Set();
  for (const task of allInvolvedTasks) {
    task.tags.forEach((tag) => tagTitlesSet.add(tag));
    projectNamesSet.add(task.project);
  }

  const tagMap = await ensureTagsExist(Array.from(tagTitlesSet));

  const projectMap = new Map();
  for (const projectName of projectNamesSet) {
    projectMap.set(projectName, await getOrCreateProject(projectName));
  }

  const computeTagIds = (task) => Array.from(new Set(task.tags))
      .map((title) => tagMap.get(title))
      .filter(Boolean);

  // CREATE
  for (const task of toCreate) {
    const project = projectMap.get(task.project);
    const taskData = {
      title: task.title,
      projectId: project.id,
      tagIds: computeTagIds(task),
    };

    if (task.description && task.description.trim()) {
      taskData.notes = task.description;
    }
    if (task.dueDay) {
      taskData.dueDay = task.dueDay;
    }
    if (task.isDone) {
      taskData.isDone = true;
    }

    try {
      await PluginAPI.addTask(taskData);
      created++;
    } catch (error) {
      console.error(`Failed to create task "${task.title}":`, error);
    }
  }

  // UPDATE
  for (const { existing, incoming } of toUpdate) {
    const desiredProject = projectMap.get(incoming.project);
    const desiredTagIds = computeTagIds(incoming);
    const desiredNotes = (incoming.description && incoming.description.trim()) || '';
    const desiredDueDay = incoming.dueDay || null;

    const updates = {};
    if (existing.title !== incoming.title) {
      updates.title = incoming.title;
    }
    if ((existing.notes || '') !== desiredNotes) {
      updates.notes = desiredNotes;
    }
    if (!sameSet(existing.tagIds, desiredTagIds)) {
      updates.tagIds = desiredTagIds;
    }
    if ((existing.dueDay || null) !== desiredDueDay) {
      updates.dueDay = desiredDueDay;
    }
    if (Boolean(existing.isDone) !== Boolean(incoming.isDone)) {
      updates.isDone = Boolean(incoming.isDone);
    }
    if (existing.projectId !== desiredProject.id) {
      updates.projectId = desiredProject.id;
    }

    if (Object.keys(updates).length === 0) {
      continue;
    }

    try {
      await PluginAPI.updateTask(existing.id, updates);
      updated++;
    } catch (error) {
      console.error(`Failed to update task "${incoming.title}":`, error);
    }
  }

  return { created, updated };
}

/**
 * Generate a random color in hex format
 */
function getRandomColor() {
  const r = Math.floor(Math.random() * 200) + 55;
  const g = Math.floor(Math.random() * 200) + 55;
  const b = Math.floor(Math.random() * 200) + 55;

  const toHex = (num) => {
    const hex = num.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/**
 * Fetches or creates the required tags (states + custom tags) in a single pass,
 * to avoid reading getAllTags() twice and missing tags that were just created
 * (which would create duplicates / fail to link them)
 */
async function ensureTagsExist(tagTitles) {
  const tagMap = new Map();
  if (tagTitles.length === 0) {
    return tagMap;
  }

  const existingTags = await PluginAPI.getAllTags();

  for (const title of tagTitles) {
    const existingTag = existingTags.find((t) => t.title === title);

    if (existingTag) {
      tagMap.set(title, existingTag.id);
      continue;
    }

    try {
      const tagId = await PluginAPI.addTag({
        title: title,
        color: getRandomColor(),
      });
      tagMap.set(title, tagId);
    } catch (error) {
      console.error(`Failed to create tag "${title}":`, error);
    }
  }

  return tagMap;
}

/**
 * Get or create a project with random color
 */
async function getOrCreateProject(projectName) {
  const projects = await PluginAPI.getAllProjects();
  const existing = projects.find((p) => p.title === projectName);

  if (existing) {
    return existing;
  }

  const color = getRandomColor();

  const projectId = await PluginAPI.addProject({
    title: projectName,
    theme: {
      primary: color,
    },
    isEnableBacklog: true,
  });

  return {
    id: projectId,
    title: projectName,
    isEnableBacklog: true,
  };
}

// EXPOSE FUNCTIONS TO WINDOW FOR IFRAME ACCESS
window.parseCSV = parseCSV;
window.calculateStats = calculateStats;
window.importTasks = importTasks;
window.classifySyncTasks = classifySyncTasks;
window.splitUpdatesByChange = splitUpdatesByChange;
window.getAllTagsWithColors = getAllTagsWithColors;
window.fetchFromYouTrack = fetchFromYouTrack;
window.saveConfig = saveConfig;
window.loadConfig = loadConfig;
window.saveQueryPreset = saveQueryPreset;
window.deleteQueryPreset = deleteQueryPreset;
window.autoSyncYouTrack = autoSyncYouTrack;
window.previewSprintTitles = previewSprintTitles;
window.resolveYouTrackQuery = resolveYouTrackQuery;
window.recordLastSyncTimestamp = recordLastSyncTimestamp;
window.getLastSyncTimestamp = getLastSyncTimestamp;
window.computeDueDateOverride = computeDueDateOverride;
