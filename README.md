# Exam Duty Allocator

A minimalist exam-duty scheduler with two workflows:

- **One-time schedule:** create, review, and export without an account.
- **School workspace:** verified email accounts, admin invitations, school-private duty history, and history-aware fair allocation.

Schedules are not automatically marked complete. A school member explicitly saves an exam’s duty counts to the school history after review. Future allocation favors the available teachers with the lowest saved total; ties are randomized. Users can exchange assignments and standby staff only when the exchange does not worsen the overall cumulative duty spread.

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

Open `http://localhost:5173`. Local development uses SQLite for convenience. School account email actions require SMTP settings. Run backend tests from `backend` with `python -m unittest discover -s tests`.

## Public deployment / self-hosting

The recommended self-hosted deployment is one HTTPS web service plus persistent PostgreSQL. The root Dockerfile serves both frontend and API from one origin. Compose also provisions a PostgreSQL volume.

1. Push the project to a private or public Git hosting repository. Never commit private teacher spreadsheets, SMTP credentials, or a real `.env`.
2. In Render, create a **Blueprint** from that repository. Render reads [`render.yaml`](./render.yaml) to build the root Dockerfile, provision PostgreSQL, generate the signing secret, and configure `/health`.
3. Enter the requested `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` values in Render. Account verification, school invitations, and password recovery need a working SMTP provider.
4. Wait for the web service and database to become healthy, then share its `https://...onrender.com` URL.

The public Render URL is automatically used to create verification, invitation, and password-reset links. Keep PostgreSQL on a persistent plan with backups.

Production startup refuses to run with the development signing key, SQLite, or missing SMTP host/sender. Teacher totals and exam logs are scoped to the authenticated school. One-time visitors do not store data. Local `.env` configuration is for self-hosting and must stay private.

Account and workbook-import routes have per-IP limits. The default in-memory limiter is suitable for a single app process; configure `RATE_LIMIT_STORAGE_URI` to a shared Redis store before running multiple replicas.

### Excel history workbook

The workspace history page accepts `.xlsx`/`.xlsm` files whose first sheet has **Teacher Name** and **Total Duties** columns. Imports add to the saved totals; importing identical workbook bytes twice is rejected. Downloaded workbooks include a totals sheet and an exam log.
