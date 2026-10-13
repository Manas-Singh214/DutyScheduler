# Exam Duty Allocator

A minimalist exam-duty scheduler with username/password access:

- **Simple sign-in:** create one username and password; no email, verification, invitations, or reset links.
- **Duty history:** each username has a private history used to balance future exam assignments.

Schedules are not automatically marked complete. A signed-in user explicitly saves an exam’s duty counts to their history after review. Future allocation favors the available teachers with the lowest saved total; ties are randomized. Users can exchange assignments and standby staff only when the exchange does not worsen the overall cumulative duty spread.

If you forget your username or password, create a new account with a different username. There is no recovery flow, and the old account’s history cannot be recovered or transferred automatically. To let multiple people use the same history, they must use the same username and password.

## Compact project structure

```text
.
├── backend/app/       # API, scheduler logic, auth, database, DOCX export
├── backend/tests/     # Focused regression tests
├── frontend/src/      # React UI and import/export flows
├── EXAMSCHEDULER.bat  # One-click local launcher for backend and frontend
├── Dockerfile         # Local app image for self-hosted deployment
├── docker-compose.yml # App + PostgreSQL for local hosting
├── .env.example       # Copy to .env for local deployment
├── README.md
└── .gitignore
```

Virtual environments, `node_modules`, build output, local databases, and private `.env` files are ignored and excluded from the Docker image.

## Run locally

On Windows, double-click [`EXAMSCHEDULER.bat`](./EXAMSCHEDULER.bat). It creates the backend virtual environment if needed, installs project dependencies, starts the FastAPI backend and Vite frontend in separate windows, and opens `http://localhost:5173`. Python 3 and Node.js must be installed and available on `PATH`. Local development uses SQLite for convenience.

## Local Docker deployment

This project is designed for local or private self-hosting only. There is no public URL, no external deployment service, and no public access layer.

Copy `.env.example` to `.env` and set `APP_SECRET_KEY` and `POSTGRES_PASSWORD`, then run:

```powershell
docker compose up --build
```

Then open:

```text
http://localhost:8000
```

The app serves the frontend and API from the same local service, with PostgreSQL running in the Docker stack. Teacher totals and exam logs are scoped to each username. Accounts and passwords are stored in the persistent database; passwords are hashed. Username and password recovery are intentionally not available.

Account and workbook-import routes have per-IP limits. The default in-memory limiter is suitable for a single app process; configure `RATE_LIMIT_STORAGE_URI` to a shared Redis store before running multiple replicas.

### Excel history workbook

The workspace history page accepts `.xlsx`/`.xlsm` files whose first sheet has **Teacher Name** and **Total Duties** columns. Imports add to the saved totals; importing identical workbook bytes twice is rejected. Downloaded workbooks include a totals sheet and an exam log.
