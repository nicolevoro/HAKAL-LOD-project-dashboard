# חכ"ל · BI Dashboard 2026

A production-ready, role-based BI dashboard for the חכ"ל municipal infrastructure work plan.  
No backend required — runs entirely as static files (HTML + CSS + JS + JSON).

---

## Project Structure

```
hakhal-app/
├── index.html       ← Shell: login screen + dashboard layout (no project data)
├── style.css        ← All visual styles (login, topbar, KPIs, charts, tables, map)
├── script.js        ← All application logic (auth, data, charts, tables, map)
├── projects.json    ← ⭐ THE ONLY FILE YOU EVER NEED TO REPLACE TO UPDATE DATA
├── managers.json    ← Access codes and roles
└── README.md        ← This file
```

---

## How to Update Project Data

1. Export the work plan Excel to the data pipeline script (the Python extractor).
2. The script produces a new `projects.json`.
3. **Replace `projects.json` in the repository.**
4. Commit and push — GitHub Pages will serve the updated data automatically.

**You never need to edit `index.html`, `style.css`, or `script.js`.**

---

## projects.json — Field Reference

Each project object has these fields:

| Field          | Type    | Description |
|----------------|---------|-------------|
| `id`           | string  | Unique project ID from Excel |
| `sub`          | string  | Sub-project name (enriched for Raanan's numeric plots) |
| `project`      | string  | Parent project name |
| `manager`      | string  | Must match `managers.json → name` for role-based filtering |
| `status`       | string  | e.g. `"ביצוע"`, `"תכנון מפורט"`, `"טרם החל"` |
| `neighborhood` | string  | Used in the map and Hood filter |
| `is_ext`       | boolean | `true` → appears in the External (גורמי חוץ) table |
| `is_eiruv`     | boolean | `true` → appears in the עירוב שימושים table |
| `supervisor`   | string  | External contractor (shown only when `is_ext` is true) |
| `plan`         | object  | Planned milestones keyed by quarter, e.g. `"Q1 2026"` |
| `exec`         | object  | Actual execution milestones keyed by quarter |
| `comp`         | object  | Compliance status per quarter (`"בוצע"`, `"לא בוצע"`, etc.) |
| `blockers`     | string  | Free-text blockers |
| `notes`        | string  | Dashboard notes |
| `delays_mgmt`  | string  | Delay management notes |
| `blocks_mgmt`  | string  | Blocker management notes |
| `yr2027-9`     | string  | Multi-year milestones |
| `risk_score`   | number  | Auto-calculated risk score (לא בוצע=3, צפי לאי עמידה=2, +1 if blockers) |
| `coords`       | array   | `[lat, lng]` for the map marker |

---

## managers.json — Access Codes

```json
[
  { "code": "1234", "name": "רענן סיטון",     "role": "manager" },
  { "code": "9999", "name": "מנהל מערכת",     "role": "admin"   }
]
```

### Roles

| Role      | Sees |
|-----------|------|
| `admin`   | All projects, all filters visible |
| `manager` | Only their own projects (`project.manager === user.name`), no filter bar |

### How to Add a New Manager

1. Open `managers.json`.
2. Add a new object: `{ "code": "XXXX", "name": "שם המנהל", "role": "manager" }`.
3. Make sure the `name` exactly matches the value in `projects.json → manager`.
4. Save and push.

### Changing an Access Code

Edit the `code` field in `managers.json`. The session persists in the browser's
`localStorage` under the key `hakhal_user`, so after a code change the user
will need to log in again.

---

## Deploying to GitHub Pages

1. Create a new GitHub repository (e.g. `hakhal-dashboard`).
2. Push all files to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "initial deploy"
   git branch -M main
   git remote add origin https://github.com/YOUR_ORG/hakhal-dashboard.git
   git push -u origin main
   ```
3. In GitHub → Settings → Pages → Source: **Deploy from branch → main / root**.
4. Your dashboard will be live at:
   `https://YOUR_ORG.github.io/hakhal-dashboard/`

> **Note on CORS:** All files must be served from the same origin.  
> GitHub Pages handles this correctly out of the box.  
> Opening `index.html` directly from your file system (`file://`) will block `fetch()`.  
> Use `npx serve .` locally to test.

---

## Local Development

```bash
# In the hakhal-app folder:
npx serve .
# Then open http://localhost:3000
```

---

## Login Persistence

Sessions are stored in `localStorage`. This means:
- Refreshing the page keeps the user logged in.
- Closing the **tab** does NOT log out.
- The user must click **יציאה ↩** to log out.
- Clearing browser storage / private browsing starts a fresh session.

---

## Architecture Notes

| Concern              | Where to change |
|----------------------|----------------|
| Visual design        | `style.css` only |
| Project data         | `projects.json` only |
| Access codes         | `managers.json` only |
| Business logic / KPIs| `script.js` (well-commented) |
| Page layout / HTML   | `index.html` |

The JS is split into clearly labelled modules:
`AUTH → DATA → FILTERS → CHARTS → TABLES → MAP → NAV → MAIN`
