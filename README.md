# YouTrack Importer for SuperProductivity

SuperProductivity plugin to bring YouTrack issues into SuperProductivity, either as a one-off
CSV import or as a live, repeatable sync directly against the YouTrack REST API.

## 📋 Features

The plugin's modal has two tabs:

- **📁 Manual Import** — import a YouTrack CSV export once.
- **🔗 YouTrack Sync** — connect directly to a YouTrack instance with a token, filter tickets
  with a YouTrack query, preview what will change, and sync on demand or automatically.

Both paths share the same import pipeline, so projects, tags, and the update-on-change behavior
described below apply no matter which tab you use.

### Core import behavior

- ✅ **Automatic project creation** if the target project doesn't exist yet
- ✅ **Tags from status and priority**: a task's YouTrack `State` and `Priority` are both turned
  into SuperProductivity tags (created automatically if they don't exist)
- ✅ **Due dates**: YouTrack's `Due Date` custom field is mapped to the task's due day
- ✅ **Stable YouTrack ID** kept in the task title (`ISSUE-ID - Summary`) — this is what makes
  re-syncing safe (see below)
- 🔁 **Update instead of duplicate**: re-importing/re-syncing the same ticket updates the
  existing task (title, description, tags, due date, project) instead of creating a duplicate
- 🎨 **Random colors** for newly created projects and tags

## 🔗 YouTrack Sync tab

### 1. Connection

Paste a permanent YouTrack API token (generate one in YouTrack under **Settings → Tokens**).

### 2. Ticket filter

Write a YouTrack query exactly as you would in the YouTrack search bar, e.g.:

```
Level: -Epic,-{Big Epic},-Goal project: {Web sites & services} State: -Canceled -Done Sprints: 26S08
```

- **Assignee (optional)**: if filled, an `Assignee: ...` clause is appended to the query
  automatically — no need to write it yourself.
- **Saved presets**: name and save the current query + assignee combo to switch quickly between
  filters (e.g. different boards or sprints) without retyping them. Presets are stored alongside
  the rest of the plugin config and survive restarts.

### 3. Automatic sprint (optional, collapsed by default)

If your queries need "the current sprint" rather than a hardcoded one, use the `{CURRENT_SPRINT}`
placeholder anywhere in your query (e.g. `Sprints: {CURRENT_SPRINT}`), then:

1. Check **Enable automatic sprint**.
2. Set the **format** (placeholders: `{YEAR}` → `2026`, `{YEAR_SHORT}` → `26`,
   `{SPRINT_NUM}` → `8`, `{SPRINT_NUM_PADDED}` → `08`; e.g. `{YEAR_SHORT}S{SPRINT_NUM_PADDED}` → `26S08`).
3. Set the **sprint duration** in working days and the **start date** (the Monday your sprint #1 began).
4. Use **Test configuration** to preview the current and next few generated sprint tags before
   relying on it.

If `{CURRENT_SPRINT}` appears in your query but this is left disabled, syncing fails with a clear
error instead of sending the literal placeholder text to YouTrack — this also protects against
double-counting a sprint filter you've already hardcoded elsewhere in the query.

### 4. Automatic sync (optional, collapsed by default)

Enable and pick an interval (hourly up to daily); a background check runs every 5 minutes and
triggers a real sync once the configured interval has elapsed. Uses the same dedupe/update
behavior as a manual sync — safe to leave running indefinitely.

### 5. Test connection / Sync now / Save

- **Test connection** — fetches matching tickets and reports a count, without importing anything.
- **Sync now** — fetches matching tickets, classifies them (**New** / **Updated** / **Unchanged**)
  and shows a preview list before anything is written. **Confirm sync** applies it; **Cancel**
  discards it.
- **Save** — persists the token, query, assignee, sprint config, schedule and presets.

## 📁 Manual Import tab

Export your issues from YouTrack as CSV, then:

1. Choose the CSV file and click **Parse**.
2. Review the preview (task/project/tag counts + sample list).
3. Click **Import**.

### Expected CSV structure

```csv
Issue Id,Project,State,Tags,Summary,Description
HEW-260,helloWorld,Review,"HelloWorldr,Architecture","📖 Color management","Define a JSON file..."
NHW-2838,New Hello,In Progress,"Star,Module","Hello design","Create a design..."
```

| Column | Required | Description |
|---------|-------------|-------------|
| **Issue Id** | ⭐ | YouTrack identifier (e.g. `NPW-260`) — needed for update-on-reimport to work |
| **Project** | ✅ | Project name |
| **Summary** | ✅ | Task title |
| **State** | ⭐ | Status (→ tag) |
| **Tags** | ⭐ | Custom tags (comma-separated) |
| **Description** | 📝 | Full description |

⭐ = Recommended &nbsp;&nbsp; 📝 = Optional

CSV rows without an **Issue Id** can still be imported, they just can't be matched on a future
re-import (no stable ID to key off), so re-importing the same CSV without an Issue Id column will
always create new tasks rather than updating existing ones.

## 🔧 How sync/import works (technical)

```
1️⃣ Fetch tickets (CSV parse, or paginated YouTrack API query)
   ↓
2️⃣ Classify against existing tasks by the "<Issue Id> - " title prefix:
     - matches an ARCHIVED task → skip entirely
     - matches an ACTIVE task   → update
     - no match                → create
   ↓
3️⃣ Create/fetch PROJECTS and TAGS needed by the whole batch
   ↓
4️⃣ Create new tasks; update changed tasks (title, notes, tags, due date, project)
```

- **Project/tag matching** is by exact title (case-sensitive); existing ones are reused.
- **YouTrack field extraction**: `State` and `Priority` are YouTrack custom fields (not built-in
  issue attributes), read via the issue's `customFields`. `Project` is a built-in field, read
  directly. `Due Date` is assumed to be a custom field literally named `Due Date` — there's no UI
  to remap this if your YouTrack instance uses a different field name.
- **Pagination**: the YouTrack API is queried in pages of 200 issues, looping until a page comes
  back short, up to a safety cap of 1000 issues per query (logged to the console if hit — narrow
  your query if you rely on more than that).

## 🐛 Troubleshooting

### Tasks don't go to the right projects

1. Check that a **Project** column/field exists and is correct.
2. Reinstall the plugin if you're not on the latest version.

### Tags are not assigned

1. Open DevTools (the plugin iframe supports the same inspector) to see detailed `console.error` logs.
2. Confirm the relevant `State`/`Priority`/`Tags` data is actually present on the source ticket.

### Sync creates duplicates anyway

This should no longer happen for any ticket with a stable ID. If it does, check that the task's
title still starts with `<Issue Id> - ` — if it was renamed locally, the match will fail and a
new task gets created instead of updating the renamed one.

### Error during sync/import

- Check the token is valid and not expired.
- Make sure the CSV is UTF-8 encoded.
- Try a narrower query/sample first to isolate the issue.

## 📝 Current limitations

- ❌ No bidirectional sync — changes made in SuperProductivity are never pushed back to YouTrack
- ❌ `Due Date` field name is hardcoded — no UI to map a differently-named custom field
- ❌ CSV rows without an Issue Id can't be deduped/updated on re-import
- ❌ No sub-task import
- ❌ No story points import

## 🔮 Possible future enhancements

- 🔗 Push completed/edited tasks back to YouTrack
- 🛠️ Configurable custom-field mapping (due date, story points, etc.)
- 📦 Multiple YouTrack connections/instances in one config

## 📄 License

This plugin is provided as-is, without warranty.

## 🤝 Contributing

Open to contribution. To report a bug or suggest an improvement:
1. Open DevTools during import/sync.
2. Copy the error logs.
3. Describe expected vs actual behavior.

## 📚 Resources

- [SuperProductivity Plugin API Documentation](https://github.com/super-productivity/super-productivity/blob/master/docs/wiki/2.15-Develop-a-Plugin.md)
- [YouTrack CSV Export Guide](https://www.jetbrains.com/help/youtrack/incloud/export-issues.html)
- [YouTrack REST API: Search and Command Attributes](https://www.jetbrains.com/help/youtrack/devportal/api-issues.html)

---

**Version**: 1.4.0
**Compatibility**: SuperProductivity 14.0.0+
**Author**: ycoissard

Happy syncing! 🚀
