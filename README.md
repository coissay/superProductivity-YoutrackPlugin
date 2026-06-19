# YouTrack CSV Importer for SuperProductivity

SuperProductivity plugin to import your YouTrack issues exported as CSV directly into your SuperProductivity projects.

## 📋 Features

### Complete YouTrack data import

- ✅ **Import tasks** with title and description
- ✅ **Automatic project creation** if they don't exist
- ✅ **Import State tags** (In Progress, Blocked, Review, Stand by, Backlog Sprint)
- ✅ **Import custom tags** from the CSV Tags column
- ✅ **Preserve YouTrack Issue IDs** in task titles
- ✅ **Random colors** for projects and tags

### Smart management

- 🎯 **Correct assignment**: Tasks go to the right projects
- 🏷️ **Automatic tags**: Combination of State tags + custom tags
- 🎨 **Visual customization**: Random colors to differentiate projects and tags
- 📊 **Standard CSV support**: Compatible with YouTrack CSV export

## 📥 Installation

1. Download the `youtrack-csv-importer-v1.1.zip` file
2. In SuperProductivity, go to **Settings → Plugins**
3. Click on **Install Plugin from File**
4. Select the downloaded ZIP file
5. Enable the plugin

## 🚀 Usage

### 1. Export from YouTrack

In YouTrack, export your issues as CSV:
1. Select your issues
2. Export → CSV
3. Make sure the following columns are included:
   - **Issue Id** (required)
   - **Summary** (required)
   - **Project** (required)
   - **State** (recommended)
   - **Tags** (recommended)
   - **Description** (optional)

### 2. Import into SuperProductivity

1. Click the **"Import CSV"** button in the top bar
2. Select your YouTrack CSV file
3. Wait during the import
4. ✅ You'll see a success notification!

### 3. Import result

Your tasks are created with:
- **Title**: `ISSUE-ID - Summary` (e.g., `NPW-260 - 📖 Custom color management`)
- **Project**: Corresponding project (automatically created if needed)
- **Description**: Full YouTrack description content
- **State tags**: Tag corresponding to status (In Progress, Review, etc.)
- **Custom tags**: All tags from the Tags column

## 📊 Expected CSV structure

Example of compatible CSV structure:

```csv
Issue Id,Project,State,Tags,Summary,Description
HEW-260,helloWorld,Review,"HelloWorldr,Architecture","📖 Color management","Define a JSON file..."
NHW-2838,New Hello,In Progress,"Star,Module","Hello design","Create a design..."
```

### Supported columns

| Column | Required | Description |
|---------|-------------|-------------|
| **Issue Id** | ✅ | YouTrack identifier (e.g., NPW-260) |
| **Project** | ✅ | Project name |
| **Summary** | ✅ | Task title |
| **State** | ⭐ | Status (→ State tag) |
| **Tags** | ⭐ | Custom tags (comma-separated) |
| **Description** | 📝 | Full description |

⭐ = Recommended  
📝 = Optional

## 🎨 Tag management

### State tags (root level)

Automatically created at the Tags menu root:
- **Review** 🟣
- **In Progress** 🔵
- **Blocked** 🔴
- **Stand by** ⚫
- **Backlog Sprint** 🟡

### Custom tags (root level)

Tags from the "Tags" column are created at root level. You can then manually move them to folders if desired.

Examples: `Webapp Partner`, `Architecture`, `Core`, `Star`, etc.

## 🔧 Import workflow (technical)

The plugin follows this process:

```
1️⃣ Create PROJECTS
   ↓
2️⃣ Create TASKS (without tags)
   ↓
3️⃣ Create/fetch TAGS
   ↓
4️⃣ Update TASKS with tags
```

This order ensures that:
- ✅ Tasks go to the right projects
- ✅ Tags are assigned correctly
- ✅ No conflicts or assignment errors

## ⚙️ Configuration

### Random colors

- **Projects** receive a random primary color
- **Tags** also receive a random color
- Color range: Various hues with 60-80% saturation

### Duplicate detection

- **Existing projects** are reused (no duplicates)
- **Existing tags** are reused (no duplicates)
- Detection by **exact name** (case-sensitive)

## 🐛 Troubleshooting

### Tasks don't go to the right projects

1. Check that the **Project** column exists in the CSV
2. Make sure project names are correct
3. Reinstall the plugin by removing the old version

### Tags are not assigned

1. Open the console (F12) to see detailed logs
2. Check that **State** and **Tags** columns exist
3. Share the logs for diagnosis

### Error during import

- Check that the CSV is encoded in **UTF-8**
- Make sure there are no special characters in names
- Test with a small data sample first

## 📝 Current limitations

- ❌ No sub-task management
- ❌ No date import (Due Date, Created, etc.)
- ❌ No priority import
- ❌ No story points import
- ❌ No user assignment

These features may be added in future versions.

## 🔮 Possible future enhancements

- 📅 Assign planned date
- 👤 Task assignment
- 🎯 Priority management
- 🔄 Detection and update of existing tasks
- 🔗 Bidirectional synchronization with YouTrack

## 📄 License

This plugin is provided as-is, without warranty.

## 🤝 Contributing

Open to contribution
To report a bug or suggest an improvement:
1. Open the console (F12) during import
2. Copy the error logs
3. Describe expected vs actual behavior

## 📚 Resources

- [SuperProductivity Plugin API Documentation](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md)
- [YouTrack CSV Export Guide](https://www.jetbrains.com/help/youtrack/incloud/export-issues.html)

---

**Version**: 1.3.0  
**Compatibility**: SuperProductivity 14.0.0+  
**Author**: COISSARD Yoann

Happy importing! 🚀

