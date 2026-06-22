# Phase 1 — Validation Strategy

> Purpose: define the verification methods and quality gates required for Phase 1 construction.

## Validation Layers

Phase 1 validation is organized into seven layers:

- Static checks.
- Unit tests.
- Integration tests.
- Coverage gates.
- Docker health checks.
- API smoke tests.
- Frontend E2E smoke tests.

## 1. Static Checks

Backend baseline:

```bash
cd backend
python -m compileall app
```

Frontend baseline:

```bash
cd admin
npm run build
```

Recommended later additions:

```bash
cd backend
ruff check .
mypy app
```

```bash
cd admin
npm run lint
```

Gate:

- Backend imports compile.
- Frontend TypeScript build succeeds.
- No known lint/type errors in changed files once lint/type tooling is introduced.

## 2. Unit Tests

Backend command:

```bash
cd backend
pytest tests/ -v
```

Unit test focus areas:

- Password hashing and JWT claims.
- Access/refresh token expiration and rotation.
- SQLAlchemy models, constraints, and relationships.
- yfinance fetch mocked, data normalization, sync dedupe.
- K-line indicator calculation.
- `generate_signals(df, config)` for every strategy type.
- Script sandbox validation and execution timeout.
- Backtest metrics and curve generation.
- AI prompt construction, validation, fallback, and cost tracking.
- Alert rule matching, email HTML rendering, and log status.
- Scheduler job registration and Redis queue behavior.

Gate:

- All relevant unit tests pass before a task is considered complete.
- External services are mocked in unit tests.

## 3. Integration Tests

SQLite-compatible integration run:

```bash
cd backend
TEST_DATABASE_URL="sqlite+aiosqlite:///./test_trend_scope.db" pytest tests/ -v
```

MySQL integration run:

```bash
cd backend
TEST_DATABASE_URL="mysql+asyncmy://trendscope:trendscope123@localhost:3306/trend_scope_test" pytest tests/ -v
```

Required integration flows:

- Register -> login -> refresh -> protected user endpoint.
- Admin-only API returns 403 for non-admin users.
- Stock CRUD -> data sync -> K-line query.
- Strategy CRUD -> validate -> test-run -> signal persistence.
- Signal scan -> dedupe -> active signal listing.
- Backtest run -> result fetch -> history listing -> cache hit.
- AI analysis success and fallback with mocked LLM.
- Alert rule create -> match -> mocked email send -> alert log.
- Full daily pipeline: price sync -> signal scan -> AI analysis -> alert dispatch.

Gate:

- Integration tests pass against the configured test database.
- Tests are isolated and can run repeatedly.
- Seed and migration behavior is idempotent.

## 4. Coverage Gates

Target command:

```bash
cd backend
pytest tests/ -v \
  --cov=app \
  --cov-report=term-missing \
  --cov-report=html \
  --cov-fail-under=90
```

Coverage target:

- Overall backend application coverage: at least 90%.

Recommended module minimums:

- `app/core/security.py`: at least 95%.
- `app/services/analysis_engine.py`: at least 90%.
- `app/services/script_executor.py`: at least 90%.
- `app/services/backtest_service.py`: at least 90%.
- `app/services/ai_analysis_service.py`: at least 85%.
- `app/services/alert_service.py`: at least 90%.
- `app/services/stock_data.py`: at least 80%.
- API routers: at least 80% where practical.

Gate:

- No task that adds core service logic is complete without targeted tests.
- Final Phase 1 release requires `--cov-fail-under=90` to pass.

## 5. Docker Health Checks

Commands:

```bash
docker compose up -d
docker compose ps
curl http://localhost:8000/health
```

Expected backend health response:

```json
{"status":"ok","version":"0.1.0"}
```

Additional checks:

```bash
docker compose exec redis redis-cli ping
docker compose exec mysql mysql -u trendscope -ptrendscope123 trend_scope -e "SELECT 1"
```

Gate:

- MySQL is healthy.
- Redis is healthy.
- Backend is running and `/health` returns 200.
- Swagger UI is available at `http://localhost:8000/docs`.
- Admin app is available at `http://localhost:3000`.

## 6. API Smoke Tests

Minimum smoke set:

- `GET /health` -> 200.
- `GET /docs` -> 200.
- `POST /api/v1/auth/register` -> 201.
- Duplicate register -> 409.
- `POST /api/v1/auth/login` -> 200.
- `GET /api/v1/users/me` without token -> 401.
- `GET /api/v1/stocks` with token -> 200.
- `GET /api/v1/stocks/{id}/kline?limit=200` -> 200.
- Non-admin access to `/api/v1/admin/*` -> 403.
- `POST /api/v1/backtest/run` -> 200 or 201.
- `GET /api/v1/analysis/{stock_id}/signals` -> 200.
- `GET /api/v1/analysis/{stock_id}/ai/{signal_id}` -> 200 or 404 as appropriate.
- `POST /api/v1/alerts` -> 201.
- Duplicate alert rule -> 409.

Gate:

- Status codes match the API specification.
- Response shapes match documented schemas.
- Auth and role boundaries are enforced.

## 7. Frontend E2E Smoke

Build check:

```bash
cd admin
npm run build
```

Optional Playwright smoke:

```bash
cd admin
npx playwright test
```

Required browser flow:

- `/` redirects to `/login`.
- Admin login succeeds.
- Dashboard loads.
- Sidebar navigation works for stocks, strategies, backtest, signals, and alerts.
- Protected routes redirect unauthenticated users.
- Logout returns to `/login`.

Gate:

- No TypeScript build errors.
- No blocking browser console errors.
- Loading and error states are visible.
- Charts render and resize correctly.

## Performance Gates

Suggested command:

```bash
cd backend
pytest tests/test_performance.py -v -s
```

Targets after one warm-up request:

- K-line query for 200 bars: under 200 ms average target.
- Signal scan for 10 stocks x 3 strategies: under 5 seconds.
- Backtest for 500+ bars: under 5 seconds.
- Backtest cache hit should be materially faster than cold execution.

## Security and Correctness Gates

Mandatory checks:

- No real DeepSeek, Resend, or yfinance calls in automated tests unless explicitly marked external.
- Custom scripts cannot import or access `os`, `sys`, `subprocess`, `socket`, `requests`, or file I/O.
- Email HTML escapes user-controlled content.
- Passwords are never logged or returned.
- JWT secret is configurable and not hardcoded for production.
- Strategy and backtest paths avoid look-ahead bias.
- Backtest uses the same signal-generation logic as live signal scanning.

## Task Completion Gate

Each Phase 1 task is complete only when:

- The implementation matches the task document.
- Relevant unit tests pass.
- Relevant integration tests pass or are explicitly documented as pending due to dependencies.
- Coverage does not regress below the active threshold.
- Docker/local verification relevant to the task passes.
- Public contracts are documented in the handoff.
- `docs/design/phase-1.md` checklist is updated for completed subtasks.

## Final Phase 1 Release Gate

Phase 1 is releasable only when:

- `docker compose up -d` starts all required services.
- Migrations apply cleanly and idempotently.
- Seed data is idempotent.
- Backend tests pass with zero failures.
- Backend coverage is at least 90%.
- Performance gates pass.
- API smoke tests pass.
- Admin `npm run build` passes.
- Admin smoke/E2E navigation passes.
- External integrations are mocked in automated tests.
- Signal generation and backtest generation share the same implementation.
