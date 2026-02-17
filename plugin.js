
/**
 * YouTrack CSV Importer Plugin for SuperProductivity v1.2.1
 * Imports YouTrack issues from CSV export with preview UI
 */

// Register header button to open the import modal
PluginAPI.registerHeaderButton({
  label: 'Import CSV',
  icon: 'upload_file',
  onClick: () => {
    PluginAPI.showIndexHtmlAsView();
  },
});

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
  try {
    const tasksByProject = new Map();
    const stateTagsSet = new Set();
    const customTagsSet = new Set();

    for (const task of tasks) {
      if (!tasksByProject.has(task.project)) {
        tasksByProject.set(task.project, []);
      }
      tasksByProject.get(task.project).push(task);

      if (task.state) {
        stateTagsSet.add(task.state);
      }

      task.tags.forEach((tag) => customTagsSet.add(tag));
    }

    const projectMap = new Map();

    for (const projectName of tasksByProject.keys()) {
      const project = await getOrCreateProject(projectName);
      projectMap.set(projectName, project);
    }

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

    const stateTagMap = await createStateTags(Array.from(stateTagsSet));
    const customTagMap = await createCustomTags(Array.from(customTagsSet));

    for (const { taskId, originalTask } of createdTasks) {
      const taskTagIds = [];

      if (originalTask.state) {
        const tagId = stateTagMap.get(originalTask.state);
        if (tagId) {
          taskTagIds.push(tagId);
        }
      }

      originalTask.tags.forEach((tagName) => {
        const tagId = customTagMap.get(tagName);
        if (tagId) {
          taskTagIds.push(tagId);
        }
      });

      if (taskTagIds.length > 0) {
        await PluginAPI.updateTask(taskId, {
          tagIds: taskTagIds,
        });
      }
    }
  } catch (error) {
    throw error;
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
 * Create state tags at root level
 */
async function createStateTags(stateNames) {
  const existingTags = await PluginAPI.getAllTags();

  if (stateNames.length === 0) {
    return new Map();
  }

  const tagMap = new Map();

  for (const stateName of stateNames) {
    let tagId;
    const existingTag = existingTags.find((t) => t.title === stateName && !t.parentId);

    if (!existingTag) {
      if (stateName.toLowerCase() === 'in progress') {
        const defaultInProgressTag = existingTags.find(
            (t) => t.title.toLowerCase() === 'in progress' && !t.parentId
        );
        if (defaultInProgressTag) {
          tagId = defaultInProgressTag.id;
        } else {
          const color = getRandomColor();
          tagId = await PluginAPI.addTag({
            title: stateName,
            color: color,
            theme: {
              primary: color,
              isAutoContrast: true,
            },
          });
        }
      } else {
        const color = getRandomColor();
        tagId = await PluginAPI.addTag({
          title: stateName,
          color: color,
          theme: {
            primary: color,
            isAutoContrast: true,
          },
        });
      }
    } else {
      tagId = existingTag.id;
    }

    tagMap.set(stateName, tagId);
  }

  return tagMap;
}

/**
 * Create custom tags at root level
 */
async function createCustomTags(tagNames) {
  if (tagNames.length === 0) {
    return new Map();
  }

  const existingTags = await PluginAPI.getAllTags();
  const tagMap = new Map();

  for (const tagName of tagNames) {
    let tagId;
    const existingTag = existingTags.find((t) => t.title === tagName && !t.parentId);

    if (!existingTag) {
      const color = getRandomColor();

      tagId = await PluginAPI.addTag({
        title: tagName,
        color: color,
        theme: {
          primary: color,
          isAutoContrast: true,
        },
      });
    } else {
      tagId = existingTag.id;
    }

    tagMap.set(tagName, tagId);
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