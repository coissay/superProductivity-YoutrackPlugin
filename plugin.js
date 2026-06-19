
/**
 * YouTrack CSV Importer Plugin for SuperProductivity v1.3.0
 * Imports YouTrack issues from CSV export or syncs directly with YouTrack API
 */

const YOUTRACK_BASE_URL = 'https://youtrack.nperf.org';
const CONFIG_KEY = 'youtrack-sync-config';
const SYNC_INTERVAL_KEY = 'youtrack-last-sync';

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
 * Previews the next N sprint titles (starting from the current sprint)
 * without depending on the persisted config - used by the "Test" button
 */
function previewSprintTitles(format, durationDays, startDateStr, count = 6) {
  const resolvedFormat = format || DEFAULT_SPRINT_FORMAT;
  const resolvedDuration = durationDays || DEFAULT_SPRINT_DURATION_DAYS;
  const startDate = new Date(startDateStr || Date.now());
  const now = new Date();

  const currentSprintNum = calculateSprintNumber(startDate, now, resolvedDuration);
  const titles = [];
  for (let i = 0; i < count; i++) {
    titles.push(generateSprintTitle(currentSprintNum + i, resolvedFormat, now.getFullYear()));
  }
  return titles;
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
 * Fetch issues from YouTrack API using a raw YouTrack query string
 */
async function fetchFromYouTrack(token, query) {
  const url = new URL(`${YOUTRACK_BASE_URL}/api/issues`);
  url.searchParams.append('query', query);
  url.searchParams.append('fields', 'id,idReadable,summary,project(name,shortName),customFields(name,value(name))');
  url.searchParams.append('$top', '200');

  try {
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

    const issues = await response.json();
    return convertYouTrackIssuesToTasks(issues);
  } catch (error) {
    throw new Error(`Failed to fetch from YouTrack: ${error.message}`);
  }
}

/**
 * Convert YouTrack issues to SuperProductivity task format
 */
function convertYouTrackIssuesToTasks(issues) {
  return issues.map((issue) => {
    const customFields = issue.customFields || [];
    const getCustomField = (name) => {
      const field = customFields.find((f) => f.name === name);
      return field?.value?.name || field?.value || null;
    };

    const state = getCustomField('State') || '';
    const priority = getCustomField('Priority') || 'N/A';

    return {
      title: `${issue.idReadable} - ${issue.summary}`,
      project: issue.project?.name || issue.project?.shortName || 'YouTrack',
      description: `YouTrack: ${issue.idReadable}\nPriority: ${priority}`,
      tags: state ? [state] : [],
      state: state,
      issueId: issue.idReadable,
    };
  });
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

    const tasks = await fetchFromYouTrack(config.token, resolveYouTrackQuery(config.query, config));

    if (tasks.length > 0) {
      await importTasks(tasks);
      localStorage.setItem(SYNC_INTERVAL_KEY, now.toString());
    }
  } catch (error) {
    console.error('Auto-sync error:', error);
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
 * Parse CSV content (RFC 4180 compliant)
 */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.substring(1);
  }

  const rows = parseCSVRows(text);

  if (rows.length < 2) {
    throw new Error('Le fichier CSV est vide ou invalide');
  }

  const headers = rows[0];
  const summaryIndex = headers.indexOf('Summary');
  const projectIndex = headers.indexOf('Project');
  const descriptionIndex = headers.indexOf('Description');
  const issueIdIndex = headers.indexOf('Issue Id');
  const tagsIndex = headers.indexOf('Tags');
  const stateIndex = headers.indexOf('State');

  if (summaryIndex === -1 || projectIndex === -1) {
    throw new Error('Colonnes requises manquantes (Summary ou Project)');
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

    const task = {
      title: title,
      project: values[projectIndex] || 'Default',
      description: descriptionIndex !== -1 ? (values[descriptionIndex] || '') : '',
      tags: tagsList,
      state: state,
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
 * Import tasks into SuperProductivity
 */
async function importTasks(tasks) {
  const tasksByProject = new Map();
  const tagTitlesSet = new Set();

  for (const task of tasks) {
    if (!tasksByProject.has(task.project)) {
      tasksByProject.set(task.project, []);
    }
    tasksByProject.get(task.project).push(task);

    if (task.state) {
      tagTitlesSet.add(task.state);
    }

    task.tags.forEach((tag) => tagTitlesSet.add(tag));
  }

  const projectMap = new Map();

  for (const projectName of tasksByProject.keys()) {
    const project = await getOrCreateProject(projectName);
    projectMap.set(projectName, project);
  }

  const tagMap = await ensureTagsExist(Array.from(tagTitlesSet));

  const createdTasks = [];

  for (const [projectName, projectTasks] of tasksByProject) {
    const project = projectMap.get(projectName);

    for (const task of projectTasks) {
      const taskData = {
        title: task.title,
        projectId: project.id,
        tagIds: [],
      };

      if (task.description && task.description.trim()) {
        taskData.notes = task.description;
      }

      const taskId = await PluginAPI.addTask(taskData);

      createdTasks.push({
        taskId: taskId,
        originalTask: task,
      });
    }
  }

  for (const { taskId, originalTask } of createdTasks) {
    const tagTitles = new Set(originalTask.tags);
    if (originalTask.state) {
      tagTitles.add(originalTask.state);
    }

    const taskTagIds = Array.from(tagTitles)
        .map((title) => tagMap.get(title))
        .filter(Boolean);

    if (taskTagIds.length > 0) {
      try {
        await PluginAPI.updateTask(taskId, { tagIds: taskTagIds });
      } catch (error) {
        console.error(`Failed to link tags to task "${originalTask.title}":`, error);
      }
    }
  }
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
window.getAllTagsWithColors = getAllTagsWithColors;
window.fetchFromYouTrack = fetchFromYouTrack;
window.saveConfig = saveConfig;
window.loadConfig = loadConfig;
window.autoSyncYouTrack = autoSyncYouTrack;
window.previewSprintTitles = previewSprintTitles;
window.resolveYouTrackQuery = resolveYouTrackQuery;
