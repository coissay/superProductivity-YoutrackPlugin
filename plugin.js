/**
 * YouTrack CSV Importer Plugin for SuperProductivity
 * Imports YouTrack issues from CSV export
 */

console.log('YouTrack CSV Importer plugin loaded');

// Register header button for CSV import
PluginAPI.registerHeaderButton({
  id: 'youtrack-csv-import-btn',
  label: 'Import CSV',
  icon: 'upload_file',
  onClick: () => {
    importCSV();
  },
});

/**
 * Show file picker and process CSV
 */
function importCSV() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv';
  
  fileInput.onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const tasks = parseCSV(text);
      
      if (tasks.length === 0) {
        PluginAPI.showSnack({
          msg: 'Aucune tâche trouvée dans le fichier CSV',
          type: 'WARNING',
        });
        return;
      }
      
      await importTasks(tasks);
      
      PluginAPI.showSnack({
        msg: `✅ ${tasks.length} tâche(s) importée(s) avec succès`,
        type: 'SUCCESS',
      });
    } catch (error) {
      console.error('Error importing CSV:', error);
      PluginAPI.showSnack({
        msg: `❌ Erreur: ${error.message}`,
        type: 'ERROR',
      });
    }
  };
  
  fileInput.click();
}

/**
 * Parse CSV content (RFC 4180 compliant)
 */
function parseCSV(text) {
  // Remove BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.substring(1);
  }

  const rows = parseCSVRows(text);
  
  if (rows.length < 2) {
    throw new Error('Le fichier CSV est vide ou invalide');
  }

  // Parse header
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

  // Parse data rows
  const tasks = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    if (values.length <= summaryIndex) continue;

    const issueId = issueIdIndex !== -1 ? (values[issueIdIndex] || '') : '';
    const summary = values[summaryIndex] || '';
    
    // Combine Issue ID with Summary
    const title = issueId ? `${issueId} - ${summary}` : summary;

    // Parse tags from CSV (comma-separated)
    const csvTags = tagsIndex !== -1 ? (values[tagsIndex] || '') : '';
    const tagsList = csvTags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    // Get state
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
 * Import tasks into SuperProductivity
 */
async function importTasks(tasks) {
  try {
    // Group tasks by project
    const tasksByProject = new Map();
    
    // Collect unique state tags and custom tags
    const stateTagsSet = new Set();
    const customTagsSet = new Set();
    
    for (const task of tasks) {
      if (!tasksByProject.has(task.project)) {
        tasksByProject.set(task.project, []);
      }
      tasksByProject.get(task.project).push(task);
      
      // Collect state tags
      if (task.state) {
        stateTagsSet.add(task.state);
      }
      
      // Collect custom tags
      task.tags.forEach((tag) => customTagsSet.add(tag));
    }

    // STEP 1: Create ALL projects FIRST
    const projectMap = new Map();
    
    for (const projectName of tasksByProject.keys()) {
      const project = await getOrCreateProject(projectName);
      projectMap.set(projectName, project);
    }

    // STEP 2: Create all tasks WITHOUT tags (to ensure they go in the right project)
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

        // PluginAPI.addTask returns the taskId directly as a string
        const taskId = await PluginAPI.addTask(taskData);

        createdTasks.push({
          taskId: taskId,
          originalTask: task
        });
      }
    }

    // STEP 3: Create ALL tags AFTER tasks are created
    const stateTagMap = await createStateTags(Array.from(stateTagsSet));
    const customTagMap = await createCustomTags(Array.from(customTagsSet));

    // STEP 4: Update tasks with their tags
    for (const { taskId, originalTask } of createdTasks) {
      const taskTagIds = [];

      // Add state tag if exists
      if (originalTask.state) {
        const tagId = stateTagMap.get(originalTask.state);
        if (tagId) {
          taskTagIds.push(tagId);  // ← tagId est déjà une STRING
        }
      }

      // Add custom tags
      originalTask.tags.forEach((tagName) => {
        const tagId = customTagMap.get(tagName);
        if (tagId) {
          taskTagIds.push(tagId);  // ← tagId est déjà une STRING
        }
      });

      // Update task with tags
      if (taskTagIds.length > 0) {
        await PluginAPI.updateTask(taskId, {
          tagIds: taskTagIds,  // ← Array de strings, pas d'objets
        });
      }
    }

  } catch (error) {
    console.error('ERROR in importTasks:', error);
    throw error;
  }
}

/**
 * Generate a random color in hex format
 * Using a simple approach with good color variety
 */
function getRandomColor() {
  // Generate random RGB values with good saturation
  const r = Math.floor(Math.random() * 200) + 55; // 55-255
  const g = Math.floor(Math.random() * 200) + 55;
  const b = Math.floor(Math.random() * 200) + 55;
  
  // Convert to hex
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

  // DEBUG: Afficher la structure complète d'un tag
  if (existingTags.length > 0) {
    console.log('First tag structure:', JSON.stringify(existingTags[0], null, 2));
  }

  console.log('all tags:', existingTags);

  if (stateNames.length === 0) {
    return new Map();
  }

  const tagMap = new Map();

  for (const stateName of stateNames) {
    let tagId;
    const existingTag = existingTags.find((t) => t.title === stateName && !t.parentId);

    if (!existingTag) {
      const color = getRandomColor();

      // PluginAPI.addTag returns the tagId directly as a STRING
      tagId = await PluginAPI.addTag({
        title: stateName,
        color: color,
        theme: {
          primary: color,
          isAutoContrast: true,
        },
      });
    } else {
      // For existing tags, use their ID
      tagId = existingTag.id;
    }

    // Store the tagId STRING, not the tag object
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

      // PluginAPI.addTag returns the tagId directly as a STRING
      tagId = await PluginAPI.addTag({
        title: tagName,
        color: color,
        theme: {
          primary: color,
          isAutoContrast: true,
        },
      });
    } else {
      // For existing tags, use their ID
      tagId = existingTag.id;
    }

    // Store the tagId STRING, not the tag object
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

  // PluginAPI.addProject returns the projectId directly as a string
  const projectId = await PluginAPI.addProject({
    title: projectName,
    theme: {
      primary: color,
    },
    isEnableBacklog: true,
  });

  // Return project object with the ID
  return {
    id: projectId,
    title: projectName,
    isEnableBacklog: true,
  };
}

/**
 * Create a task in SuperProductivity
 */
async function createTask(projectId, task, tagIds) {
  const taskData = {
    title: task.title,
    projectId: projectId,
    tagIds: tagIds || [],
  };

  if (task.description && task.description.trim()) {
    taskData.notes = task.description;
  }

  const result = await PluginAPI.addTask(taskData);

  // The PluginBridge returns taskId as a property
  return {
    id: result?.taskId || result?.id,
    taskId: result?.taskId || result?.id,
    ...result
  };
}
