# Phase 1 — Multi-Agent Build Workflow

> Purpose: define the multi-subagent workflow for building Phase 1 MVP in a controlled, testable sequence.

## Guiding Principles

- One main coordinating agent owns task sequencing, interface contracts, verification gates, and documentation updates.
- Specialized subagents own implementation within a bounded task area.
- Subagents should not expand scope beyond their assigned task.
- Shared contracts must be stabilized before dependent agents start: database models, API paths, schemas, and service function signatures.
- Every completed task must include implementation, relevant tests, verification results, and `docs/design/phase-1.md` checkbox updates.

## Main Coordinator Agent

Responsibilities:

- Maintain the Phase 1 task order: T1 -> T2 -> T3 -> T4 -> T5 -> T6/T7 -> T8 -> T9 -> T10 -> T11.
- Decide which work can safely run in parallel.
- Enforce API/schema/model consistency across agents.
- Track blockers and integration risks.
- Run or delegate final verification after each task.
- Preserve the Phase 1 scope and avoid Phase 2 features unless explicitly required.

## Subagent Roles

### Agent A: Infrastructure

Scope: T1 Project Initialization.

Deliverables:

- FastAPI backend skeleton.
- Next.js 14 admin skeleton.
- Docker Compose for MySQL, Redis, backend, and admin.
- Backend/Admin Dockerfiles.
- `.env.example`.
- Backend `/health` endpoint.

Verification:

- `docker compose up -d`
- `docker compose ps`
- `curl http://localhost:8000/health`
- Swagger UI available at `http://localhost:8000/docs`.
- Admin available at `http://localhost:3000`.

### Agent B: Database

Scope: T2 Database Layer.

Deliverables:

- SQLAlchemy async base and session setup.
- Phase 1 ORM models.
- Alembic setup and initial migration.
- Seed admin user and core ETF symbols.
- Idempotent seed behavior.

Verification:

- `alembic upgrade head`
- ORM relationship tests.
- Table/schema spot checks in MySQL.
- Seed script can run repeatedly without duplicates.

### Agent C: Auth/RBAC

Scope: T3 Authentication System.

Deliverables:

- Password hashing.
- JWT access and refresh tokens.
- Refresh-token persistence.
- `get_current_user` and admin guard dependencies.
- Auth and user APIs.

Verification:

- Register/login/refresh tests.
- Protected route tests.
- Non-admin access to admin endpoints returns 403.
- Invalid/expired token behavior is covered.

### Agent D: Stock Data

Scope: T4 Stock Data and K-line APIs.

Deliverables:

- yfinance-backed data service.
- Incremental OHLCV sync.
- Stock user/admin APIs.
- K-line response with precomputed indicators.

Verification:

- yfinance mocked in tests.
- Incremental sync and dedupe tests.
- K-line endpoint returns documented response shape.
- K-line query for 200 bars targets under 200 ms after warm-up.

### Agent E: Strategy Engine

Scope: T5 Strategy System.

Deliverables:

- Shared `generate_signals(df, config)` function as the single source of signal generation.
- MA cross strategy.
- Multi-indicator strategy.
- Custom Python script sandbox.
- Strategy CRUD, validation, test-run, and signal APIs.
- 20-trading-day signal dedupe and confirmation logic.

Verification:

- Unit tests for all strategy types.
- Sandbox tests for allowed and forbidden imports.
- No-look-ahead tests: executable signals must be shifted before trading/backtest use.
- Signal dedupe tests.

### Agent F: Scheduler

Scope: T6 Scheduled Jobs.

Deliverables:

- APScheduler lifecycle integration.
- Daily price sync job.
- Signal scan job.
- Redis `new_signals` queue.
- Manual trigger/status endpoints where required by task docs.

Verification:

- Job registration tests.
- Mocked job execution tests.
- Redis queue behavior tests.
- Repeated job execution remains idempotent.

### Agent G: Backtest

Scope: T7 Backtest System.

Deliverables:

- vectorbt backtest service.
- Reuse of `generate_signals`.
- Metrics, equity curve, drawdown curve, monthly returns, and trade log.
- Benchmark return calculation.
- Redis backtest cache.
- Backtest user/admin APIs.

Verification:

- Metric correctness tests.
- Cache hit tests.
- Signal consistency tests between live engine and backtest service.
- 500+ bar backtest target under 5 seconds.
- No-look-ahead tests.

### Agent H: AI Analysis

Scope: T8 AI Analysis.

Deliverables:

- DeepSeek OpenAI-compatible client.
- Prompt builder.
- JSON response validation.
- Safety checks.
- Rule-template fallback.
- AI analysis APIs and scheduler integration.

Verification:

- Mocked LLM success tests.
- Mocked LLM failure fallback tests.
- Prompt and JSON validation tests.
- Cost/token tracking tests.
- Missing API key behavior is explicit and safe.

### Agent I: Alerts/Email

Scope: T9 Alert Email System.

Deliverables:

- Resend email wrapper.
- Alert rule CRUD.
- Rule matching.
- HTML email rendering.
- Alert logs.
- Dispatch scheduler integration.

Verification:

- Resend mocked in tests.
- Rule matching tests.
- Duplicate-send prevention tests.
- HTML escaping tests.
- Alert log sent/failed status tests.

### Agent J: Admin Frontend

Scope: T10 Admin Frontend.

Subagents:

- J1 Foundation/Auth/Layout.
- J2 Dashboard.
- J3 Stocks and K-line chart.
- J4 Strategy management.
- J5 Backtest UI.
- J6 Signals and AI modal.
- J7 Alert logs.

Verification:

- `npm run build`
- Protected route redirect works.
- Admin login works against backend auth API.
- Core pages navigate without console errors.
- Charts render and resize correctly.
- API loading and error states are visible.

### Agent K: QA/Integration

Scope: T11 Integration Tests and Release Validation.

Deliverables:

- Backend unit and integration tests.
- API smoke tests.
- Performance tests.
- Frontend smoke/E2E tests.
- Coverage reporting.
- Final release checklist.

Verification:

- Backend tests pass with zero failures.
- Coverage gate passes.
- Docker health passes.
- API smoke passes.
- Admin build and smoke navigation pass.

## Execution Phases

### Phase A: Infrastructure

Run Agent A only. Do not start feature work until the local stack and skeleton boot.

### Phase B: Database and Auth

Run Agent B, then Agent C. Auth depends on stable user/session models.

### Phase C: Market Data

Run Agent D after Auth and Database are stable.

### Phase D: Strategies, Scheduler, Backtest

Run Agent E first until `generate_signals` is stable. Then Agent F and Agent G may proceed in parallel.

### Phase E: AI and Alerts

Run Agent H before Agent I. Alerts should support missing AI analysis through fallback content.

### Phase F: Admin Frontend

Start J1 after Auth APIs are stable. Other frontend subagents can start as their backend APIs become available.

### Phase G: Final QA

Agent K runs throughout the project, but final release validation happens after T10.

## Handoff Contract

Each subagent handoff must include:

- Files changed.
- Public API/schema/service contracts added or changed.
- Tests added.
- Verification commands run and result.
- Known gaps or follow-ups.
- Relevant `phase-1.md` checkbox updates.
