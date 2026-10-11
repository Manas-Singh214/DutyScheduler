# Exam Duty Allocator

A minimalist exam-duty scheduler with username/password access:

- **Simple sign-in:** create one username and password; no email, verification, invitations, or reset links.
- **Duty history:** each username has a private history used to balance future exam assignments.

Schedules are not automatically marked complete. A signed-in user explicitly saves an exam’s duty counts to their history after review. Future allocation favors the available teachers with the lowest saved total; ties are randomized. Users can exchange assignments and standby staff only when the exchange does not worsen the overall cumulative duty spread.

If you forget your username or password, create a new account with a different username. There is no recovery flow, and the old account’s history cannot be recovered or transferred automatically. To let multiple people use the same history, they must use the same username and password.

## Compact project structure

```text
.
├── backend/app/       # API, allocation, authentication, database, DOCX
├── backend/tests/     # Focused regression tests
├── frontend/src/      # React UI, screens, and browser export/import
├── Dockerfile         # Builds the UI and API as one service
├── docker-compose.yml # App + persistent PostgreSQL for self-hosting
└── README.md
```

Virtual environments, `node_modules`, build output, local databases, and private `.env` files are ignored and excluded from the Docker image.

## Run locally

Start the backend from `backend`:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Start the frontend from `frontend`:

```powershell
npm ci
npm run dev
```

Open `http://localhost:5173`. Local development uses SQLite for convenience. Run backend tests from `backend` with `python -m unittest discover -s tests`.

## Free pilot deployment (Render + Supabase)

The default [`render.yaml`](./render.yaml) configures a **free pilot**: one Render Free FastAPI+frontend service and Supabase Free PostgreSQL. The root Dockerfile serves the UI and API from the same HTTPS origin.

1. Create a Supabase Free project and copy its **Session pooler** PostgreSQL connection string from **Connect** (Render uses IPv4). Keep the password private and preserve any SSL query parameters.
2. In Render, create a **Blueprint** from this GitHub repository. Choose the root `render.yaml`; it builds the app and generates `APP_SECRET_KEY`.
3. When prompted, enter the Supabase `DATABASE_URL` in Render’s private environment-variable form. Never put secrets in Git or chat.
4. Wait for `/health` to pass, then share the generated `https://...onrender.com` URL.

Render’s free web service sleeps after 15 minutes without traffic, so the first visit after idle may take about a minute. Supabase Free includes a 500 MB database and can pause projects after a week of inactivity; resume it in Supabase if needed. These free tiers are useful for a pilot, not an uptime or backup guarantee. Monitor each provider’s quotas and terms.

Teacher totals and exam logs are scoped to each username. Accounts and passwords are stored in the persistent database; passwords are hashed. Username and password recovery are intentionally not available.

Account and workbook-import routes have per-IP limits. The default in-memory limiter is suitable for a single app process; configure `RATE_LIMIT_STORAGE_URI` to a shared Redis store before running multiple replicas.

### Persistent paid Render option

[`render-paid.yaml`](./render-paid.yaml) keeps the app and PostgreSQL on paid Render plans with a persistent database. Use a Blueprint file path of `render-paid.yaml` when creating that paid configuration. Review Render's current service and database prices in your account before confirming.

### Local Docker Compose

For local self-hosting, copy `.env.example` to `.env` and configure `APP_SECRET_KEY` and `POSTGRES_PASSWORD`, then run:

```powershell
docker compose up --build
```

### Excel history workbook

The workspace history page accepts `.xlsx`/`.xlsm` files whose first sheet has **Teacher Name** and **Total Duties** columns. Imports add to the saved totals; importing identical workbook bytes twice is rejected. Downloaded workbooks include a totals sheet and an exam log.
