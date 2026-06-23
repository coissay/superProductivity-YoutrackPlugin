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
- ✅ **Ticket description in the task notes**: the YouTrack issue's description (or the CSV
  Description column) is copied into the task's notes, prefixed with the issue ID and priority
- ✅ **Tags from status and priority**: a task's YouTrack `State` and `Priority` are both turned
  into SuperProductivity tags (created automatically if they don't exist) — unless the status is
  in your configured "statuses to mark as Done" list (see Status handling below), in which case
  the task is marked Done instead of tagged
- ✅ **Due dates**: YouTrack's `Due Date` custom field is mapped to the task's due day
- ✅ **Stable YouTrack ID** kept in the task title (`ISSUE-ID - Summary`) — this is what makes
  re-syncing safe (see below)
- 🔁 **Update instead of duplicate**: re-importing/re-syncing the same ticket updates the
  existing task (title, description, tags, due date, project) instead of creating a duplicate
- 🎨 **Random colors** for newly created projects and tags

## 🔗 YouTrack Sync tab

### 1. Connection

Enter your YouTrack instance's base URL (e.g. `https://youtrack.example.com`, no trailing slash),
then paste a permanent YouTrack API token (generate one in YouTrack under **Settings → Tokens** —
the help link under the token field opens that page directly once the URL above is filled in).

### 2. Saved presets

A preset captures the **whole** sync configuration except the token: URL, query, assignee, automatic
sprint settings, automatic sync schedule, and the "statuses to mark as Done" list (see below).
Name and save your current settings, then switch between presets (e.g. different boards or
sprints) without retyping anything. Presets are stored alongside the rest of the plugin config
and survive restarts.

### 3. Ticket filter

Write a YouTrack query exactly as you would in the YouTrack search bar, e.g.:

```
Level: -Epic,-{Big Epic},-Goal project: {Web sites & services} State: -Canceled -Done Sprints: 26S08
```

**Assignee (optional)**: if filled, an `Assignee: ...` clause is appended to the query
automatically — no need to write it yourself.

### 4. Automatic sprint (optional, collapsed by default)

If your queries need "the current sprint" rather than a hardcoded one, use the `{CURRENT_SPRINT}`
placeholder anywhere in your query (e.g. `Sprints: {CURRENT_SPRINT}`), then:

1. Check **Enable automatic sprint**.
2. Set the **format** (placeholders: `{YEAR}` → `2026`, `{YEAR_SHORT}` → `26`,
   `{SPRINT_NUM}` → `8`, `{SPRINT_NUM_PADDED}` → `08`; e.g. `{YEAR_SHORT}S{SPRINT_NUM_PADDED}` → `26S08`).
3. Set the **sprint duration** in working days and the **start date** (the Monday your sprint #1 began).
4. **Use sprint end date as due date** (optional) — if your YouTrack instance has no Due Date
   field, check this to set each ticket's due date to the last day of its current sprint instead.
5. **Allow tickets to carry over to the next sprint** (optional) — if checked, the sprint end
   date above is not enforced; due date falls back to the normal field mapping (or no due date)
   instead. Useful for teams where tickets aren't required to finish within the sprint they're
   filed in. Leave unchecked if your tickets never carry over (the common case).
6. Use **Test configuration** to preview the current and next few generated sprint tags before
   relying on it.

If `{CURRENT_SPRINT}` appears in your query but this is left disabled, syncing fails with a clear
error instead of sending the literal placeholder text to YouTrack — this also protects against
double-counting a sprint filter you've already hardcoded elsewhere in the query.

### 5. Automatic sync (optional, collapsed by default)

Enable and pick an interval (15 minutes up to daily); a background check runs every 5 minutes and
triggers a real sync once the configured interval has elapsed. Uses the same dedupe/update
behavior as a manual sync — safe to leave running indefinitely.

### 6. Status handling (optional, collapsed by default)

YouTrack statuses that mean "this ticket is finished" (e.g. `Done`, `MEP`, `TO_MEP`, `Canceled`
— adjust the list to match your team's workflow) can be listed here, comma-separated. A ticket
whose status matches gets the task marked **Done** in SuperProductivity instead of getting a
status tag.

> Plugins can't archive a task directly — there's no such method in the Plugin API. Marking it
> Done is the closest equivalent; SuperProductivity's own archiving (manual or automatic,
> depending on your settings) takes it from there.

If your query already excludes these statuses (e.g. `State: -Done -Canceled`), tickets that move
into one of them will simply stop being returned by the query and won't be touched at all on the
next sync — they're never auto-marked Done unless your query still returns them. To have the
plugin actively mark them Done when they transition, make sure your query doesn't exclude the
listed statuses.

⚠️ This list only controls what happens to a ticket *after* it's fetched — it does not filter
what the query returns. If your query keeps matching tickets in these statuses (no `-Done
-Canceled -MEP` etc. in the query itself), they'll keep showing up in every "Sync now" preview as
**Already archived** forever (correctly skipped, no duplicate/update — just expected, recurring
noise). Add the exclusion to the query text itself if you'd rather they stop being fetched at all
once finished.

**Mark tickets Done when they no longer match the query** (off by default): by default, a ticket
that simply disappears from your query results (e.g. removed from the current sprint, reassigned,
or otherwise no longer matching) is left completely untouched in SuperProductivity — the plugin
only ever acts on tickets the query actually returns. Enabling this checkbox closes that gap: any
ticket seen in a previous sync that's missing from the current one gets marked **Done** (the
same archiving proxy used above).

- Only affects tickets that were seen in a *previous* sync with this checkbox already enabled —
  turning it on has no effect the very first time, since there's no baseline yet to compare
  against. From the next sync onward it works as expected.
- An empty sync result is ignored entirely (nothing gets marked Done), since that's more likely a
  misconfigured query or expired token than "every ticket left the sprint" — without this guard a
  bad query could wipe out everything in one shot.
- The CSV import tab never affects or is affected by this tracking — it's scoped to the YouTrack
  Sync tab only.
- ⚠️ If you regularly change the query/sprint filter itself (not just what's *in* the sprint),
  tickets that fall outside the new query will also get marked Done, even though they didn't
  technically "leave" anything — they just stopped matching. Leave this off if you switch queries
  often.

### 7. Field mapping (optional, collapsed by default)

YouTrack's `Due Date` custom field is read by name. If your instance names that field
differently (it must match exactly, case-sensitive), enter it here. Leave empty to use the
default, `Due Date`.

If your instance has no due-date field at all, see **Use sprint end date as due date** in the
Automatic sprint section above instead — that takes priority over this field mapping whenever
it's enabled and carry-over isn't allowed.

### 8. Test connection / Sync now / Save

- **Test connection** — fetches matching tickets and reports a count, without importing anything.
- **Sync now** — fetches matching tickets and classifies them into **New**, **To update**
  (something actually changed — title, notes, tags, due date, status or project), **Already in
  sync** (matches an existing task but nothing differs — no-op), **Archived** (matches a
  ticket already correctly archived as Done), and **Removed** (only when "Mark tickets Done when
  they no longer match the query" is enabled — see Status handling above), and shows a preview
  list before anything is written. **Confirm sync** applies it; **Cancel**
  discards it.
- **Save** — persists the token, query, assignee, sprint config, schedule, status handling,
  field mapping and presets.

A **"Last synced: ..."** line is always visible at the bottom of the tab, updated after every
manual or automatic sync, so it's easy to confirm auto-sync (including the new 15/30-minute
intervals) is actually running in the background without checking DevTools.

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
     - matches an ARCHIVED task AND still a "Done" status → skip entirely (already correct)
     - matches an ARCHIVED task BUT status is active again → create a new active task
     - matches an ACTIVE task                              → update
     - no match                                             → create
   ↓
3️⃣ Create/fetch PROJECTS and TAGS needed by the whole batch
   ↓
4️⃣ Create new tasks; update changed tasks (title, notes, tags, due date, project)
```

- **Project/tag matching** is by exact title (case-sensitive); existing ones are reused.
- **Reviving an archived ticket**: the Plugin API has no way to un-archive/restore a task, so if
  a ticket that was previously synced as Done (and got archived, by you or SuperProductivity's own
  auto-archiving) later moves back to a non-Done status in YouTrack, the plugin can't bring the
  old task back — it creates a brand-new active task for it instead. The old archived copy is
  left behind untouched (harmless, but it does mean a "dead" duplicate sits in your archive
  history for that ticket).
- **YouTrack field extraction**: `State` and `Priority` are YouTrack custom fields (not built-in
  issue attributes), read via the issue's `customFields`. `Project` is a built-in field, read
  directly. `Due Date` is read from a custom field named `Due Date` by default — configurable via
  the Field mapping section if your instance uses a different name.
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

## 🔐 Permissions & API usage

This plugin requests no elevated permissions (`permissions: []` in `manifest.json` — no
`nodeExecution`). For transparency, `manifest.json` also lists exactly which capabilities it uses:

- **`pluginApiUsage`**: the `PluginAPI` methods called — `addProject`, `addTag`, `addTask`,
  `getAllProjects`, `getAllTags`, `getArchivedTasks`, `getTasks`, `loadSyncedData`,
  `persistDataSynced`, `registerHeaderButton`, `showIndexHtmlAsView`, `updateTask`.
- **`networkUsage`**: the plugin makes direct `fetch()` calls to whatever YouTrack instance URL
  you configure, using the API token you provide, to search/fetch issues. No other network access.
- **Token storage**: your API token is stored in this device's `localStorage` only — it is never
  included in the synced profile config (`persistDataSynced`), so it won't end up in a profile
  backup/export or get copied to another device alongside the rest of your settings. Everything
  else (URL, query, presets, sprint/sync settings) is stored in the regular synced config and
  will follow you across devices; the token has to be re-entered on each one.

## 📝 Current limitations

- ❌ No bidirectional sync — changes made in SuperProductivity are never pushed back to YouTrack
- ❌ No un-archive support (Plugin API limitation): a ticket that goes Done → archived → active
  again in YouTrack comes back as a new task, leaving a harmless but orphaned duplicate in your
  archive history
- ❌ CSV rows without an Issue Id can't be deduped/updated on re-import
- ❌ No sub-task import
- ❌ No story points import

## 🔮 Possible future enhancements

- 🔗 Push completed/edited tasks back to YouTrack
- 🛠️ Configurable custom-field mapping for story points
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

**Version**: 1.7.6
**Compatibility**: SuperProductivity 14.0.0+
**Author**: ycoissard

Happy syncing! 🚀
