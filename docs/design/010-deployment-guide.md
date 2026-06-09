# 010 — Deployment Guide

> **Status**: Draft v1
> **Date**: 2026-06-09
> **Purpose**: Complete production deployment guide for Trend-Scope. Covers local development, Docker Compose, environment variables, database initialization, Stripe setup, production deployment, CI/CD, security, and troubleshooting.
>
> **References**:
> - [001-preliminary-design.md](./001-preliminary-design.md) — architecture & tech stack
> - [002-database-schema.md](./002-database-schema.md) — full DDL & seed data
> - [003-api-specification.md](./003-api-specification.md) — API endpoints

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Docker Compose Setup](#2-docker-compose-setup)
3. [Environment Variables](#3-environment-variables)
4. [Local Development Setup](#4-local-development-setup)
5. [Database Initialization](#5-database-initialization)
6. [Stripe Setup](#6-stripe-setup)
7. [Production Deployment](#7-production-deployment)
8. [CI/CD Pipeline](#8-cicd-pipeline)
9. [Security Checklist](#9-security-checklist)
10. [Troubleshooting](#10-troubleshooting)
11. [Appendix: API Keys & Where to Obtain Them](#11-appendix-api-keys--where-to-obtain-them)

---

## 1. Prerequisites

### 1.1 Software Versions

| Software | Minimum Version | Check Command |
|---|---|---|
| Python | 3.12+ | `python --version` |
| Node.js | 20+ (LTS) | `node --version` |
| npm | 10+ | `npm --version` |
| Docker | 24+ | `docker --version` |
| Docker Compose | v2 (plugin) | `docker compose version` |
| Git | 2.40+ | `git --version` |
| MySQL Client | 8.0+ (optional, for direct DB access) | `mysql --version` |
| Stripe CLI | 1.19+ (for local webhook testing) | `stripe version` |

### 1.2 System Requirements

| Resource | Development | Production |
|---|---|---|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| Disk | 20 GB | 100+ GB SSD |
| OS | macOS / Linux / WSL2 | Ubuntu 22.04 LTS (recommended) |

### 1.3 Install Docker Compose Plugin (if using legacy docker-compose)

```bash
# Docker Desktop already includes Compose v2.
# On Linux, if you see "docker: 'compose' is not a docker command":
sudo apt-get update && sudo apt-get install docker-compose-plugin
docker compose version  # verify
```

---

## 2. Docker Compose Setup

### 2.1 Complete `docker-compose.yml`

Create this file at the repository root (`trend-scope/docker-compose.yml`):

```yaml
version: "3.8"

services:
  # --------------------------------------------------------------------------
  # MySQL 8.0 — primary database
  # --------------------------------------------------------------------------
  mysql:
    image: mysql:8.0
    container_name: trendscope-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-rootpassword}
      MYSQL_DATABASE: ${MYSQL_DATABASE:-trendscope}
      MYSQL_USER: ${MYSQL_USER:-trendscope}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:-trendscope}
    ports:
      - "${MYSQL_PORT:-3306}:3306"
    volumes:
      - mysql_data:/var/lib/mysql
      - ./docker/mysql/init:/docker-entrypoint-initdb.d:ro
      - ./docker/mysql/my.cnf:/etc/mysql/conf.d/my.cnf:ro
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p${MYSQL_ROOT_PASSWORD:-rootpassword}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - trendscope-net

  # --------------------------------------------------------------------------
  # Redis 7.x — cache, sessions, rate limiting, pub/sub
  # --------------------------------------------------------------------------
  redis:
    image: redis:7-alpine
    container_name: trendscope-redis
    restart: unless-stopped
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
      - ./docker/redis/redis.conf:/usr/local/etc/redis/redis.conf:ro
    command: redis-server /usr/local/etc/redis/redis.conf
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - trendscope-net

  # --------------------------------------------------------------------------
  # Backend — FastAPI + Uvicorn
  # --------------------------------------------------------------------------
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: ${BUILD_TARGET:-development}
    container_name: trendscope-backend
    restart: unless-stopped
    ports:
      - "${BACKEND_PORT:-8000}:8000"
    env_file:
      - .env
    environment:
      - APP_ENV=${APP_ENV:-development}
      - DEBUG=${DEBUG:-true}
    volumes:
      # Hot-reload: mount source code
      - ./backend/app:/app/app:delegated
      - ./backend/alembic:/app/alembic:delegated
      - ./backend/tests:/app/tests:delegated
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: >
      sh -c "alembic upgrade head &&
             uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --log-level ${LOG_LEVEL:-info}"
    networks:
      - trendscope-net

  # --------------------------------------------------------------------------
  # Admin — Next.js 14 management frontend
  # --------------------------------------------------------------------------
  admin:
    build:
      context: ./admin
      dockerfile: Dockerfile
      target: ${BUILD_TARGET:-development}
    container_name: trendscope-admin
    restart: unless-stopped
    ports:
      - "${ADMIN_PORT:-3000}:3000"
    env_file:
      - .env
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:8000/api/v1
      - NODE_ENV=${APP_ENV:-development}
    volumes:
      # Hot-reload: mount source code
      - ./admin/src:/app/src:delegated
      - ./admin/public:/app/public:delegated
      - ./admin/next.config.js:/app/next.config.js:delegated
      - ./admin/package.json:/app/package.json:delegated
      - ./admin/tsconfig.json:/app/tsconfig.json:delegated
    depends_on:
      - backend
    command: npm run dev
    networks:
      - trendscope-net

  # --------------------------------------------------------------------------
  # Stripe CLI — local webhook forwarding (development only)
  # --------------------------------------------------------------------------
  stripe-cli:
    image: stripe/stripe-cli:latest
    container_name: trendscope-stripe-cli
    profiles:
      - stripe
    environment:
      - STRIPE_API_KEY=${STRIPE_SECRET_KEY}
    command: >
      listen
      --forward-to http://backend:8000/api/v1/webhooks/stripe
      --skip-verify
      --events checkout.session.completed,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed
    depends_on:
      - backend
    networks:
      - trendscope-net

# --------------------------------------------------------------------------
# Volumes
# --------------------------------------------------------------------------
volumes:
  mysql_data:
    driver: local
  redis_data:
    driver: local

# --------------------------------------------------------------------------
# Networks
# --------------------------------------------------------------------------
networks:
  trendscope-net:
    driver: bridge
```

### 2.2 MySQL Configuration (`docker/mysql/my.cnf`)

```ini
[mysqld]
# Character set — utf8mb4 for full Unicode (emoji, CJK)
character-set-server  = utf8mb4
collation-server      = utf8mb4_unicode_ci

# Default timezone (all app datetimes are UTC)
default-time-zone     = '+00:00'

# Connection limits
max_connections       = 200
max_connect_errors    = 100
connect_timeout       = 10

# InnoDB buffer pool — 70-80% of available RAM
# For dev: 256M. For production: adjust based on instance size.
innodb_buffer_pool_size       = 256M
innodb_buffer_pool_instances  = 4
innodb_log_file_size          = 256M
innodb_flush_log_at_trx_commit = 2  # 2 for performance; 1 for production durability
innodb_flush_method           = O_DIRECT
innodb_file_per_table         = ON
innodb_io_capacity            = 200
innodb_io_capacity_max        = 2000

# Slow query logging
slow_query_log       = ON
slow_query_log_file  = /var/log/mysql/slow.log
long_query_time      = 2

# Binary logging (required for point-in-time recovery)
log_bin          = mysql-bin
binlog_format    = ROW
expire_logs_days = 7
max_binlog_size  = 256M

# Table settings
sql_mode = STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION

[client]
default-character-set = utf8mb4
```

### 2.3 Redis Configuration (`docker/redis/redis.conf`)

```conf
# Persistence — RDB snapshots
save 900 1
save 300 10
save 60 10000
dbfilename dump.rdb
dir /data

# Persistence — AOF (append-only file)
appendonly yes
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# Memory
maxmemory 256mb
maxmemory-policy allkeys-lru

# Connections
timeout 300
tcp-keepalive 60

# Logging
loglevel notice
logfile ""
```

### 2.4 MySQL Init Script (`docker/mysql/init/01-create-database.sql`)

```sql
-- Validate character set
SELECT @@character_set_database, @@collation_database;
SELECT @@innodb_buffer_pool_size / 1024 / 1024 AS buffer_pool_mb;
```

Place this at `docker/mysql/init/01-create-database.sql`. The database and user are already created by the `MYSQL_DATABASE` / `MYSQL_USER` environment variables; this file serves as a verification check and a place to add custom init SQL if needed.

---

## 3. Environment Variables

### 3.1 Complete `.env.example`

Create this file at the repository root (`trend-scope/.env.example`):

```bash
# =============================================================================
# Trend-Scope Environment Variables
# =============================================================================
# Copy to .env:  cp .env.example .env
# NEVER commit .env to version control!
# =============================================================================

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
APP_ENV=development                       # development | staging | production
APP_NAME=Trend-Scope
DEBUG=true                                # false in production
CORS_ORIGINS=http://localhost:3000,http://localhost:8000
LOG_LEVEL=info                            # debug | info | warning | error
BACKEND_PORT=8000
ADMIN_PORT=3000

# ---------------------------------------------------------------------------
# MySQL Database
# ---------------------------------------------------------------------------
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_USER=trendscope
MYSQL_PASSWORD=change-me-in-production
MYSQL_ROOT_PASSWORD=change-me-root-password
MYSQL_DATABASE=trendscope

# SQLAlchemy connection string (composed from above)
DATABASE_URL=mysql+asyncmy://${MYSQL_USER}:${MYSQL_PASSWORD}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}?charset=utf8mb4

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------
REDIS_URL=redis://redis:6379/0
REDIS_PORT=6379

# ---------------------------------------------------------------------------
# JWT Authentication
# ---------------------------------------------------------------------------
JWT_SECRET_KEY=generate-a-random-64-char-string-here-change-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30

# ---------------------------------------------------------------------------
# Stripe — Payment Processing
# ---------------------------------------------------------------------------
# Obtain from: https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx

# Price IDs — obtain from Stripe Dashboard after creating products/prices
# Go to: Stripe Dashboard > Products > select product > Pricing section
STRIPE_BASIC_MONTHLY_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxx
STRIPE_BASIC_YEARLY_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxx
STRIPE_PRO_MONTHLY_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxx
STRIPE_PRO_YEARLY_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxx

# ---------------------------------------------------------------------------
# Email — Resend
# ---------------------------------------------------------------------------
# Obtain from: https://resend.com/api-keys
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@trend-scope.com
RESEND_FROM_NAME=Trend-Scope

# ---------------------------------------------------------------------------
# Push Notifications — OneSignal
# ---------------------------------------------------------------------------
# Obtain from: https://app.onesignal.com/apps > App Settings > Keys & IDs
ONESIGNAL_APP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ONESIGNAL_API_KEY=os_xxxxxxxxxxxxxxxxxxxx

# ---------------------------------------------------------------------------
# AI / LLM Providers
# ---------------------------------------------------------------------------
# DeepSeek API — https://platform.deepseek.com/api_keys
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# OpenAI API — https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Anthropic API — https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ---------------------------------------------------------------------------
# Market Data — Finnhub
# ---------------------------------------------------------------------------
# Obtain from: https://finnhub.io/register
FINNHUB_API_KEY=xxxxxxxxxxxxxxxxxxxx
FINNHUB_WEBHOOK_SECRET=change-me-webhook-secret

# ---------------------------------------------------------------------------
# Macro Data — FRED
# ---------------------------------------------------------------------------
# Obtain from: https://fred.stlouisfed.org/docs/api/api_key.html
FRED_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ---------------------------------------------------------------------------
# Docker Build
# ---------------------------------------------------------------------------
BUILD_TARGET=development                   # development | production
```

### 3.2 Generate a Secure JWT Secret

```bash
# Generate a cryptographically secure random secret
python -c "import secrets; print(secrets.token_urlsafe(48))"

# Or with openssl:
openssl rand -base64 48
```

---

## 4. Local Development Setup

### 4.1 Step-by-Step

```bash
# 1. Clone the repository
git clone https://github.com/your-org/trend-scope.git
cd trend-scope

# 2. Copy environment file and edit secrets
cp .env.example .env
# Edit .env with your actual API keys (see Appendix for where to obtain each)

# 3. Start infrastructure (MySQL + Redis)
docker compose up -d mysql redis

# 4. Wait for MySQL to be healthy, then verify
docker compose ps
docker compose logs mysql | grep -i "ready for connections"

# 5. Set up Python backend
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate   # Windows

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# 6. Run database migrations
alembic upgrade head

# 7. Start the backend (with hot-reload)
uvicorn app.main:app --reload --port 8000

# In a new terminal:

# 8. Set up the admin frontend
cd admin
npm install
npm run dev
```

### 4.2 Verify Everything Works

| Service | URL | Expected |
|---|---|---|
| Backend API Docs | http://localhost:8000/docs | Swagger UI with all endpoints |
| Backend Health | http://localhost:8000/health | `{"status": "ok"}` |
| Admin Frontend | http://localhost:3000 | Login page loads |
| MySQL | `docker compose exec mysql mysql -u trendscope -p` | Connected to `trendscope` db |
| Redis | `docker compose exec redis redis-cli PING` | `PONG` |

### 4.3 Docker Compose Development (Full Stack)

```bash
# Alternatively, run everything in Docker with hot-reload:
docker compose up -d

# View logs
docker compose logs -f backend
docker compose logs -f admin

# Rebuild after dependency changes
docker compose build backend
docker compose build admin

# Stop everything
docker compose down

# Stop and remove volumes (reset database)
docker compose down -v
```

### 4.4 Stripe Webhook Testing (Local)

```bash
# Start the stripe-cli service to forward events to your local backend
docker compose --profile stripe up -d stripe-cli

# Or use the Stripe CLI directly:
stripe listen --forward-to localhost:8000/api/v1/webhooks/stripe \
  --events checkout.session.completed,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed

# In a new terminal, trigger test events:
stripe trigger checkout.session.completed
stripe trigger invoice.payment_succeeded
stripe trigger customer.subscription.updated
```

---

## 5. Database Initialization

### 5.1 Alembic Migration Workflow

```bash
cd backend
source venv/bin/activate

# After creating/modifying SQLAlchemy models, generate a migration:
alembic revision --autogenerate -m "description_of_changes"

# Review the generated migration in alembic/versions/
# Edit if necessary (auto-generation doesn't catch everything)

# Apply all pending migrations:
alembic upgrade head

# Roll back one migration:
alembic downgrade -1

# Show current migration status:
alembic current

# Show migration history:
alembic history

# Generate SQL for a migration (without applying):
alembic upgrade head --sql
```

### 5.2 Seed Data

Create `backend/alembic/versions/seed/manual_seed.py` or run these as a one-off script:

```python
# backend/scripts/seed_data.py
"""Seed initial data: subscription tiers, admin user, sample stocks."""

import asyncio
from datetime import datetime, timedelta

from app.core.config import settings
from app.core.security import get_password_hash
from app.models.base import async_session_factory
from app.models.user import User
from app.models.subscription import SubscriptionTier
from app.models.stock import Stock


async def seed():
    async with async_session_factory() as db:
        # --- Subscription Tiers ---
        tiers = [
            SubscriptionTier(
                name="Free",
                slug="free",
                price_monthly=0.00,
                price_yearly=0.00,
                features={
                    "kline_periods": ["day"],
                    "kline_history_months": 3,
                    "watchlist_limit": 5,
                    "alert_limit": 0,
                    "ai_analysis_limit": 0,
                    "backtest_limit": 0,
                    "daily_api_limit": 100,
                    "data_export": False,
                    "indicators": ["sma", "ema"],
                    "signals": [],
                },
                daily_api_limit=100,
                watchlist_limit=5,
                alert_limit=0,
                ai_analysis_limit=0,
                sort_order=1,
            ),
            SubscriptionTier(
                name="Basic",
                slug="basic",
                stripe_price_id_monthly=settings.STRIPE_BASIC_MONTHLY_PRICE_ID,
                stripe_price_id_yearly=settings.STRIPE_BASIC_YEARLY_PRICE_ID,
                price_monthly=9.99,
                price_yearly=99.00,
                features={
                    "kline_periods": ["day", "week"],
                    "kline_history_months": 24,
                    "watchlist_limit": 30,
                    "alert_limit": 10,
                    "ai_analysis_limit": 10,
                    "backtest_limit": 0,
                    "daily_api_limit": 1000,
                    "data_export": False,
                    "indicators": ["sma", "ema", "rsi", "macd"],
                    "signals": ["golden_cross", "death_cross"],
                },
                daily_api_limit=1000,
                watchlist_limit=30,
                alert_limit=10,
                ai_analysis_limit=10,
                sort_order=2,
            ),
            SubscriptionTier(
                name="Pro",
                slug="pro",
                stripe_price_id_monthly=settings.STRIPE_PRO_MONTHLY_PRICE_ID,
                stripe_price_id_yearly=settings.STRIPE_PRO_YEARLY_PRICE_ID,
                price_monthly=29.99,
                price_yearly=299.00,
                features={
                    "kline_periods": ["day", "week", "month", "quarter", "year"],
                    "kline_history_months": 0,  # 0 = unlimited
                    "watchlist_limit": 0,        # 0 = unlimited
                    "alert_limit": 30,
                    "ai_analysis_limit": 50,
                    "backtest_limit": 10,
                    "daily_api_limit": 10000,
                    "data_export": True,
                    "indicators": [],  # empty = all 252+
                    "signals": ["golden_cross", "death_cross", "bullish_alignment", "bearish_alignment", "composite_buy", "composite_sell"],
                },
                daily_api_limit=10000,
                watchlist_limit=0,
                alert_limit=30,
                ai_analysis_limit=50,
                sort_order=3,
            ),
        ]
        for tier in tiers:
            db.add(tier)
        await db.flush()

        # --- Admin User ---
        admin = User(
            email="admin@trend-scope.com",
            password_hash=get_password_hash("admin123"),  # Change immediately!
            nickname="Admin",
            role="admin",
            status="active",
            locale="en",
        )
        db.add(admin)
        await db.flush()

        # --- Sample Stocks ---
        sample_stocks = [
            Stock(symbol="SPY", name="SPDR S&P 500 ETF Trust", type="ETF", subtype="broad_market", market="US", sector="Broad Market"),
            Stock(symbol="QQQ", name="Invesco QQQ Trust", type="ETF", subtype="broad_market", market="US", sector="Technology"),
            Stock(symbol="IWM", name="iShares Russell 2000 ETF", type="ETF", subtype="broad_market", market="US", sector="Small Cap"),
            Stock(symbol="DIA", name="SPDR Dow Jones Industrial Average ETF Trust", type="ETF", subtype="broad_market", market="US", sector="Broad Market"),
            Stock(symbol="TLT", name="iShares 20+ Year Treasury Bond ETF", type="ETF", subtype="broad_market", market="US", sector="Bond"),
            Stock(symbol="GLD", name="SPDR Gold Shares", type="ETF", subtype="broad_market", market="US", sector="Commodity"),
            Stock(symbol="VOO", name="Vanguard S&P 500 ETF", type="ETF", subtype="broad_market", market="US", sector="Broad Market"),
            Stock(symbol="VTI", name="Vanguard Total Stock Market ETF", type="ETF", subtype="broad_market", market="US", sector="Broad Market"),
            Stock(symbol="AAPL", name="Apple Inc.", type="Stock", subtype=None, market="US", sector="Technology"),
            Stock(symbol="MSFT", name="Microsoft Corporation", type="Stock", subtype=None, market="US", sector="Technology"),
        ]
        for stock in sample_stocks:
            db.add(stock)
        await db.flush()

        await db.commit()
        print("Seed data inserted successfully.")


if __name__ == "__main__":
    asyncio.run(seed())
```

Run it:
```bash
cd backend
source venv/bin/activate
python scripts/seed_data.py
```

### 5.3 MySQL Configuration Summary

| Setting | Dev Value | Production Value | Purpose |
|---|---|---|---|
| `character-set-server` | `utf8mb4` | `utf8mb4` | Full Unicode support |
| `collation-server` | `utf8mb4_unicode_ci` | `utf8mb4_unicode_ci` | Case-insensitive collation |
| `max_connections` | 200 | 500+ | Concurrent connections |
| `innodb_buffer_pool_size` | 256M | 70-80% of RAM | Cache for data/indexes |
| `innodb_flush_log_at_trx_commit` | 2 | 1 | Durability (1 = full ACID) |
| `innodb_io_capacity` | 200 | 1000-2000 | SSD I/O throughput |
| `slow_query_log` | ON | ON | Identify slow queries |
| `long_query_time` | 2 | 1 | Threshold in seconds |
| `expire_logs_days` | 7 | 7-14 | Binary log retention |

### 5.4 MySQL Backup (mysqldump)

```bash
# Daily backup script (add to cron)
# Save as: scripts/backup-db.sh
#!/bin/bash
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/trendscope"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

docker compose exec -T mysql mysqldump \
  --user=root \
  --password="${MYSQL_ROOT_PASSWORD}" \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  "${MYSQL_DATABASE}" \
  | gzip > "${BACKUP_DIR}/trendscope_${TIMESTAMP}.sql.gz"

# Remove backups older than retention period
find "$BACKUP_DIR" -name "trendscope_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "Backup completed: trendscope_${TIMESTAMP}.sql.gz"
```

Cron entry (daily at 2 AM UTC):
```
0 2 * * * /opt/trend-scope/scripts/backup-db.sh >> /var/log/trendscope-backup.log 2>&1
```

---

## 6. Stripe Setup

### 6.1 Stripe Dashboard Configuration

#### Step 1: Create Products & Prices

1. Go to [Stripe Dashboard > Products](https://dashboard.stripe.com/products)
2. Click **+ Add Product**
3. Create three products in this order:

| Product Name | Description |
|---|---|
| Trend-Scope Free | Free tier (no price — used for tracking only) |
| Trend-Scope Basic | Basic membership with technical analysis & AI signals |
| Trend-Scope Pro | Professional membership with full feature access |

4. For **Basic** product, add pricing:
   - **Monthly**: $9.99 USD, recurring
   - **Yearly**: $99.00 USD, recurring (save 17%)
   - Note the Price IDs (e.g., `price_xxxxx`) for `.env`

5. For **Pro** product, add pricing:
   - **Monthly**: $29.99 USD, recurring
   - **Yearly**: $299.00 USD, recurring (save 17%)
   - Note the Price IDs for `.env`

6. Copy the four Price IDs into your `.env`:
   ```
   STRIPE_BASIC_MONTHLY_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxx
   STRIPE_BASIC_YEARLY_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxx
   STRIPE_PRO_MONTHLY_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxx
   STRIPE_PRO_YEARLY_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxx
   ```

#### Step 2: Configure Webhook Endpoint

1. Go to [Stripe Dashboard > Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. **Endpoint URL**: `https://api.trend-scope.com/api/v1/webhooks/stripe`
4. **Events to send** (select these specific events):
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. Reveal and copy the **Signing secret** (`whsec_...`) → paste into `.env` as `STRIPE_WEBHOOK_SECRET`

#### Step 3: Configure Customer Portal

1. Go to [Stripe Dashboard > Settings > Customer Portal](https://dashboard.stripe.com/settings/billing/portal)
2. Activate the portal
3. Configure:
   - Allow customers to: update payment methods, view invoices, cancel subscriptions, switch plans
   - Add both Basic and Pro products as available plans
   - Set a return URL: `https://trend-scope.com/account`

### 6.2 Stripe CLI for Local Webhook Testing

```bash
# Install Stripe CLI (macOS)
brew install stripe/stripe-cli/stripe

# Login (one-time)
stripe login

# Forward events to local backend
stripe listen \
  --forward-to localhost:8000/api/v1/webhooks/stripe \
  --events checkout.session.completed,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed

# In another terminal, trigger test events:
stripe trigger checkout.session.completed
stripe trigger invoice.payment_succeeded
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
stripe trigger invoice.payment_failed

# The CLI will print the webhook signing secret for local use:
# > Ready! Your webhook signing secret is whsec_xxxxx
# Copy this to .env as STRIPE_WEBHOOK_SECRET for local testing.
```

### 6.3 Test Mode → Live Mode Checklist

- [ ] Create products and prices in **Live** mode (separate from Test)
- [ ] Update `.env` with live `STRIPE_SECRET_KEY` (starts with `sk_live_`)
- [ ] Update `.env` with live Price IDs
- [ ] Create live webhook endpoint with live signing secret
- [ ] Set `APP_ENV=production` and `DEBUG=false`
- [ ] Verify payment flow with a real test card (`4242 4242 4242 4242`)
- [ ] Issue a refund through Stripe Dashboard and verify webhook handling
- [ ] Test subscription cancellation and automatic downgrade
- [ ] Verify Customer Portal functionality

---

## 7. Production Deployment

### 7.1 Architecture Overview

```
                         ┌──────────────┐
                         │   Internet   │
                         └──────┬───────┘
                                │ :443
                         ┌──────▼───────┐
                         │    Nginx     │  ← SSL termination (Let's Encrypt)
                         │  reverse     │  ← Static files (Next.js export)
                         │  proxy       │  ← Rate limiting
                         └──┬──────┬────┘
                            │      │
              :8000 ┌───────▼┐  ┌─▼───────┐ :3000
                    │Backend │  │ Admin   │
                    │Gunicorn│  │Next.js  │
                    │Uvicorn │  │standalone│
                    └───┬──┬─┘  └─────────┘
                        │  │
              :3306 ┌───▼┐ ┌▼────┐ :6379
                    │MySQL│ │Redis│
                    └─────┘ └─────┘
```

### 7.2 Nginx Reverse Proxy Configuration (`nginx.conf`)

```nginx
# /etc/nginx/sites-available/trend-scope
upstream backend {
    server 127.0.0.1:8000;
    keepalive 32;
}

upstream admin {
    server 127.0.0.1:3000;
    keepalive 32;
}

# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name api.trend-scope.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.trend-scope.com;

    # SSL — Let's Encrypt
    ssl_certificate     /etc/letsencrypt/live/api.trend-scope.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.trend-scope.com/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/api.trend-scope.com/chain.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Rate limiting — 100 req/s per IP with burst of 50
    limit_req_zone $binary_remote_addr zone=api:10m rate=100r/s;
    limit_req zone=api burst=50 nodelay;

    # Logging
    access_log /var/log/nginx/trend-scope-access.log;
    error_log  /var/log/nginx/trend-scope-error.log;

    # Client max body size (for file uploads)
    client_max_body_size 10M;

    # Backend API
    location /api/ {
        limit_req zone=api burst=50 nodelay;
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # WebSocket (for in-app notifications)
    location /ws/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Admin frontend
    location / {
        proxy_pass http://admin;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 7.3 SSL/TLS with Let's Encrypt

```bash
# Install Certbot
sudo apt-get update && sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate (HTTP challenge)
sudo certbot --nginx -d api.trend-scope.com -d trend-scope.com

# Auto-renewal (typically configured automatically)
sudo certbot renew --dry-run

# Manual renewal if needed:
sudo certbot renew --quiet
```

### 7.4 Backend: Gunicorn + Uvicorn Workers

```bash
# Install gunicorn in production
cd backend
pip install gunicorn

# Start with optimal worker count: (2 * CPU cores) + 1
# gunicorn.conf.py
import multiprocessing

bind = "127.0.0.1:8000"
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
timeout = 120
keepalive = 5
max_requests = 10000
max_requests_jitter = 500
preload_app = True
accesslog = "/var/log/trendscope/gunicorn-access.log"
errorlog = "/var/log/trendscope/gunicorn-error.log"
loglevel = "warning"
capture_output = True

# Start:
# gunicorn app.main:app --config gunicorn.conf.py
```

Create a systemd service file `/etc/systemd/system/trendscope-backend.service`:

```ini
[Unit]
Description=Trend-Scope Backend API (Gunicorn)
After=network.target mysql.service redis.service
Requires=mysql.service redis.service

[Service]
Type=notify
User=www-data
Group=www-data
WorkingDirectory=/opt/trend-scope/backend
EnvironmentFile=/opt/trend-scope/.env
ExecStart=/opt/trend-scope/backend/venv/bin/gunicorn app.main:app --config gunicorn.conf.py
ExecReload=/bin/kill -s HUP $MAINPID
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now trendscope-backend
sudo systemctl status trendscope-backend
```

### 7.5 Admin: Next.js Standalone Build

```bash
cd admin
npm install
npm run build

# The output is in admin/.next/standalone/
# Start directly:
node admin/.next/standalone/server.js

# Or with PM2 process manager:
npm install -g pm2
pm2 start admin/.next/standalone/server.js --name trendscope-admin
pm2 save
pm2 startup
```

```javascript
// admin/next.config.js — production configuration
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
};
module.exports = nextConfig;
```

### 7.6 Database Backup Strategy

Add this to crontab (`crontab -e`):

```
# Daily MySQL dump at 2:00 AM UTC
0 2 * * * /opt/trend-scope/scripts/backup-db.sh >> /var/log/trendscope-backup.log 2>&1

# Weekly full backup check (verify backup integrity)
0 3 * * 0 /opt/trend-scope/scripts/verify-backup.sh >> /var/log/trendscope-verify.log 2>&1
```

### 7.7 Redis Persistence

The Redis configuration (`redis.conf`) already enables both:

- **RDB**: Point-in-time snapshots every 900s (1 change), 300s (10 changes), or 60s (10000 changes)
- **AOF**: Every write appended to append-only file, fsync every second

```bash
# Manual backup of Redis data:
docker compose exec redis redis-cli BGSAVE
# File is at: /data/dump.rdb (mounted to redis_data volume)

# Restore RDB:
# 1. Stop Redis
# 2. Copy dump.rdb to /data/
# 3. Start Redis
```

### 7.8 Monitoring: Prometheus + Grafana

```yaml
# docker-compose.monitoring.yml — optional monitoring stack
version: "3.8"

services:
  prometheus:
    image: prom/prometheus:latest
    container_name: trendscope-prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./docker/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
    networks:
      - trendscope-net

  grafana:
    image: grafana/grafana:latest
    container_name: trendscope-grafana
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-admin}
      - GF_INSTALL_PLUGINS=grafana-clock-panel,grafana-simple-json-datasource
    volumes:
      - grafana_data:/var/lib/grafana
      - ./docker/grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
    networks:
      - trendscope-net

volumes:
  prometheus_data:
  grafana_data:
```

```yaml
# docker/prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'backend'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['backend:8000']

  - job_name: 'mysql'
    static_configs:
      - targets: ['mysql-exporter:9104']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']
```

### 7.9 Logging: Structured Logging with structlog

```python
# backend/app/core/logging.py
import structlog
import logging

def setup_logging(log_level: str = "INFO"):
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer() if log_level == "DEBUG"
            else structlog.processors.JSONRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    logging.basicConfig(level=getattr(logging, log_level.upper()))
```

For production, ship JSON logs to ELK or CloudWatch:

```bash
# ELK stack via Docker
docker compose -f docker-compose.yml -f docker-compose.elk.yml up -d

# Or with AWS CloudWatch agent
sudo apt-get install amazon-cloudwatch-agent
# Configure to tail /var/log/trendscope/*.log
```

---

## 8. CI/CD Pipeline

### 8.1 GitHub Actions Workflow (`.github/workflows/ci-cd.yml`)

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  BACKEND_IMAGE: ghcr.io/${{ github.repository_owner }}/trend-scope-backend
  ADMIN_IMAGE: ghcr.io/${{ github.repository_owner }}/trend-scope-admin

jobs:
  # ---------------------------------------------------------------------------
  # Lint — code quality checks
  # ---------------------------------------------------------------------------
  lint:
    name: Lint
    runs-on: ubuntu-latest
    strategy:
      matrix:
        path: [backend, admin]
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        if: matrix.path == 'backend'
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Set up Node.js
        if: matrix.path == 'admin'
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: admin/package-lock.json

      - name: Install Python deps
        if: matrix.path == 'backend'
        run: |
          pip install ruff mypy

      - name: Install Node deps
        if: matrix.path == 'admin'
        run: |
          cd admin && npm ci

      - name: Ruff lint
        if: matrix.path == 'backend'
        run: ruff check backend/

      - name: Mypy type check
        if: matrix.path == 'backend'
        run: mypy backend/app/ --ignore-missing-imports

      - name: ESLint
        if: matrix.path == 'admin'
        run: cd admin && npm run lint

  # ---------------------------------------------------------------------------
  # Test
  # ---------------------------------------------------------------------------
  test:
    name: Test
    runs-on: ubuntu-latest
    needs: lint
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: testpassword
          MYSQL_DATABASE: trendscope_test
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping -h localhost"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd="redis-cli ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

    strategy:
      matrix:
        path: [backend, admin]

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        if: matrix.path == 'backend'
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Set up Node.js
        if: matrix.path == 'admin'
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: admin/package-lock.json

      - name: Install Python deps
        if: matrix.path == 'backend'
        run: |
          cd backend
          pip install -r requirements.txt
          pip install pytest pytest-asyncio pytest-cov httpx

      - name: Run pytest
        if: matrix.path == 'backend'
        env:
          DATABASE_URL: mysql+asyncmy://root:testpassword@127.0.0.1:3306/trendscope_test?charset=utf8mb4
          REDIS_URL: redis://127.0.0.1:6379/0
          JWT_SECRET_KEY: test-secret-key
          APP_ENV: testing
          DEBUG: "true"
        run: |
          cd backend
          pytest --cov=app --cov-report=xml --cov-report=term -v

      - name: Install Node deps
        if: matrix.path == 'admin'
        run: cd admin && npm ci

      - name: Run Jest
        if: matrix.path == 'admin'
        run: cd admin && npm test -- --coverage

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-${{ matrix.path }}
          path: ${{ matrix.path }}/coverage/

  # ---------------------------------------------------------------------------
  # Build & Push Docker Images
  # ---------------------------------------------------------------------------
  build:
    name: Build & Push
    runs-on: ubuntu-latest
    needs: test
    if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging')

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: |
            ${{ env.BACKEND_IMAGE }}
            ${{ env.ADMIN_IMAGE }}
          tags: |
            type=sha,prefix={{branch}}-
            type=ref,event=branch
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      - name: Build & push backend
        uses: docker/build-push-action@v5
        with:
          context: ./backend
          file: ./backend/Dockerfile
          target: production
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build & push admin
        uses: docker/build-push-action@v5
        with:
          context: ./admin
          file: ./admin/Dockerfile
          target: production
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ---------------------------------------------------------------------------
  # Deploy to Staging
  # ---------------------------------------------------------------------------
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/staging'
    environment:
      name: staging
      url: https://staging.trend-scope.com

    steps:
      - uses: actions/checkout@v4

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.STAGING_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/trend-scope
            docker compose pull backend admin
            docker compose up -d --no-deps backend admin
            docker image prune -f

  # ---------------------------------------------------------------------------
  # Smoke Tests (Staging)
  # ---------------------------------------------------------------------------
  smoke-test:
    name: Smoke Tests
    runs-on: ubuntu-latest
    needs: deploy-staging

    steps:
      - name: Health check backend
        run: |
          for i in $(seq 1 30); do
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://staging.trend-scope.com/api/v1/health || echo "000")
            if [ "$STATUS" = "200" ]; then
              echo "Backend healthy"
              exit 0
            fi
            echo "Attempt $i: Backend returned $STATUS, retrying in 5s..."
            sleep 5
          done
          echo "Backend failed to become healthy"
          exit 1

      - name: Admin frontend accessible
        run: |
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://staging.trend-scope.com || echo "000")
          if [ "$STATUS" != "200" ] && [ "$STATUS" != "302" ]; then
            echo "Admin returned $STATUS"
            exit 1
          fi
          echo "Admin frontend OK"

      - name: API auth endpoint
        run: |
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://staging.trend-scope.com/api/v1/auth/login -X POST -H "Content-Type: application/json" -d '{"email":"test@test.com","password":"wrong"}' || echo "000")
          # Expect 401 or 422 (invalid credentials / validation error) — means auth is working
          if [ "$STATUS" = "200" ]; then
            echo "Unexpected 200 — auth may allow bad credentials"
            exit 1
          fi
          echo "Auth endpoint OK (returned $STATUS)"

  # ---------------------------------------------------------------------------
  # Deploy to Production (manual approval required)
  # ---------------------------------------------------------------------------
  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: smoke-test
    if: github.ref == 'refs/heads/main'
    environment:
      name: production
      url: https://trend-scope.com

    steps:
      - uses: actions/checkout@v4

      # This environment requires approval in GitHub Settings
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.PROD_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/trend-scope
            docker compose pull backend admin
            docker compose up -d --no-deps backend admin
            docker image prune -f

      - name: Post-deploy health check
        run: |
          sleep 10
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://api.trend-scope.com/api/v1/health)
          if [ "$STATUS" != "200" ]; then
            echo "PRODUCTION HEALTH CHECK FAILED: $STATUS"
            exit 1
          fi
          echo "Production deploy verified — health check OK"
```

### 8.2 GitHub Environments Setup

1. Go to **GitHub Repo > Settings > Environments**
2. Create two environments: `staging` and `production`
3. For `staging`: add secrets `STAGING_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`
4. For `production`:
   - Add secrets `PROD_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`
   - Add **Required reviewers** (1-2 people) → manual approval gate before deploy
   - Optionally add **Deployment branches**: restrict to `main`

### 8.3 Dockerfiles

**Backend** (`backend/Dockerfile`):

```dockerfile
# Development stage — hot-reload
FROM python:3.12-slim AS development

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]


# Production stage — optimized
FROM python:3.12-slim AS production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir gunicorn

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["gunicorn", "app.main:app", \
     "--config", "gunicorn.conf.py", \
     "--bind", "0.0.0.0:8000"]
```

**Admin** (`admin/Dockerfile`):

```dockerfile
# Development stage — hot-reload
FROM node:20-slim AS development

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]


# Production build stage
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# Production runtime stage
FROM node:20-slim AS production

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:3000 || exit 1

CMD ["node", "server.js"]
```

---

## 9. Security Checklist

### 9.1 Essential (Must Do Before Production)

- [ ] **All secrets in `.env`, never committed**: Confirm `.env` is in `.gitignore`. Use `.env.example` as a template with placeholder values.
  ```bash
  # .gitignore
  .env
  .env.local
  .env.*.local
  *.pem
  *.key
  ```
- [ ] **Database password rotation**: Use strong, unique passwords. Rotate quarterly.
  ```bash
  # Generate strong password
  openssl rand -base64 32
  ```
- [ ] **JWT secret rotation**: Rotate the `JWT_SECRET_KEY` if compromised. Note: rotation invalidates all existing tokens.
  ```bash
  python -c "import secrets; print(secrets.token_urlsafe(48))"
  ```
- [ ] **CORS whitelist**: Set `CORS_ORIGINS` to explicit production domains only.
  ```bash
  # Production .env
  CORS_ORIGINS=https://trend-scope.com,https://admin.trend-scope.com
  ```
- [ ] **Rate limiting enabled**: Configure Redis-backed token bucket rate limiter per user tier.
- [ ] **HTTPS only in production**: Nginx redirects all HTTP to HTTPS. HSTS header active.
- [ ] **Stripe webhook signature verification**: Always call `stripe.Webhook.construct_event()` with the raw body and signature header.
  ```python
  # backend/app/api/v1/webhooks.py
  import stripe
  from app.core.config import settings

  @router.post("/stripe")
  async def stripe_webhook(request: Request):
      payload = await request.body()
      sig_header = request.headers.get("stripe-signature")
      event = stripe.Webhook.construct_event(
          payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
      )
      # ... handle event
  ```
- [ ] **Resend webhook signature verification** (if using Resend webhooks for email events).

### 9.2 Recommended

- [ ] **Dependency vulnerability scanning**:
  ```bash
  # Backend
  pip install pip-audit
  pip-audit

  # Frontend
  cd admin && npm audit

  # In CI: add these as steps
  ```
- [ ] **Database encryption at rest**: Enable if hosting on cloud (AWS RDS encryption, GCP CMEK).
- [ ] **IP whitelist for admin panel** (optional): Restrict `/admin/` routes to VPN/office IP ranges.
- [ ] **Failed login rate limiting**: Redis-based, 5 attempts per email per 15 minutes.
- [ ] **Audit logging**: Log all admin actions (user create/delete, tier changes, signal overrides).
- [ ] **Regular security patches**: Subscribe to security advisories for Python, Node.js, MySQL, Redis.
  ```bash
  # Automated updates on Ubuntu
  sudo apt-get install unattended-upgrades
  sudo dpkg-reconfigure unattended-upgrades
  ```
- [ ] **Database backups encrypted**: GPG-encrypt backups before offsite transfer.
  ```bash
  gpg --encrypt --recipient security@trend-scope.com trendscope_backup.sql.gz
  ```

### 9.3 Secrets Rotation Process

```bash
# 1. Generate new secret
JWT_SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(48))")

# 2. Update .env on all servers
# 3. Restart backend service (invalidates all sessions)
systemctl restart trendscope-backend

# 4. For zero-downtime rotation (advanced):
#    - Add new secret as JWT_SECRET_KEY_2
#    - Update code to try both keys for verification
#    - After token lifetimes expire, remove old key
```

### 9.4 Database Password Rotation

```sql
-- On MySQL
ALTER USER 'trendscope'@'%' IDENTIFIED BY 'new-strong-password';
FLUSH PRIVILEGES;
```

```bash
# Update .env and restart:
sed -i 's/MYSQL_PASSWORD=.*/MYSQL_PASSWORD=new-strong-password/' /opt/trend-scope/.env
systemctl restart trendscope-backend
```

---

## 10. Troubleshooting

### 10.1 Docker & Infrastructure

| Symptom | Likely Cause | Solution |
|---|---|---|
| `docker compose up` fails with "port already in use" | Another service using port 3306/6379/8000 | `lsof -i :3306` — kill or change port in `.env` |
| MySQL container keeps restarting | Corrupted volume or wrong config | `docker compose down -v && docker compose up -d mysql` (resets data) |
| `mysqladmin ping` healthcheck fails | MySQL not fully initialized | Wait 30s; check `docker compose logs mysql` |
| `alembic upgrade head` fails | MySQL connection refused | Ensure `MYSQL_HOST=mysql` (not `localhost`) when running in Docker |
| Redis "NOAUTH Authentication required" | Redis has password but client doesn't send it | Set `requirepass` in redis.conf or add password to `REDIS_URL` |

### 10.2 Backend

| Symptom | Likely Cause | Solution |
|---|---|---|
| `ModuleNotFoundError: No module named 'app'` | Running from wrong directory | Run `uvicorn` from `backend/` directory: `uvicorn app.main:app` |
| `ImportError: ... asyncmy` | Missing system deps for asyncmy | `apt-get install libmysqlclient-dev` or use `mysqlclient` fallback |
| 500 on `/health` | Database or Redis unreachable | Check `DATABASE_URL` and `REDIS_URL` values match running containers |
| 401 on all endpoints | JWT configuration mismatch | Verify `JWT_SECRET_KEY` and `JWT_ALGORITHM` match between deployments |
| `pydantic.errors.PydanticUserError` | Environment variable not parsed correctly | Check `APP_ENV`, `DEBUG` (must be `true`/`false` string) |
| Stripe webhook returns 400 | Signature verification failed | Verify `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard value |
| CORS errors in browser | `CORS_ORIGINS` incorrect | Set to exact origin: `http://localhost:3000` (no trailing slash) |

### 10.3 Admin Frontend

| Symptom | Likely Cause | Solution |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:8000` (server-side fetch) | Next.js server can't reach backend | Use Docker service name `backend:8000` for internal calls, not `localhost` |
| `NEXT_PUBLIC_API_URL` not working | Next.js build-time env | For runtime env, use `getServerSideProps` or API route proxy |
| Blank page after login | Token not stored | Check `localStorage` / cookie configuration; verify CORS allows credentials |
| TradingView chart not loading | SSR issue | Ensure `dynamic(() => import(...), { ssr: false })` wrapper is used |
| `npm run dev` port conflict | Port 3000 already in use | `npx kill-port 3000` or set `PORT=3001 npm run dev` |

### 10.4 Stripe

| Symptom | Likely Cause | Solution |
|---|---|---|
| Checkout session creation fails | Invalid Price ID | Verify Price IDs match Stripe Dashboard (Test/Live mode) |
| Webhook not received locally | Stripe CLI not running | Start with `stripe listen --forward-to localhost:8000/api/v1/webhooks/stripe` |
| `checkout.session.completed` event missed | Webhook listener not started before payment | Always start listener first, then trigger test payment |
| Subscription not created after payment | Webhook handler error | Check backend logs for errors during `construct_event()` or DB write |

### 10.5 Production

| Symptom | Likely Cause | Solution |
|---|---|---|
| 502 Bad Gateway | Backend/Gunicorn crashed | Check `systemctl status trendscope-backend` and app logs |
| 504 Gateway Timeout | Long-running request | Increase `proxy_read_timeout` in nginx; check backend for slow queries |
| MySQL "Too many connections" | Connection pool exhausted | Increase `max_connections`; check for connection leaks in code |
| Redis OOM | `maxmemory` exceeded | Increase `maxmemory` or tune `maxmemory-policy` |
| SSL certificate expired | Certbot auto-renewal failed | `sudo certbot renew --force-renewal` |

---

## 11. Appendix: API Keys & Where to Obtain Them

| Variable | Service | Registration URL | Free Tier? | Notes |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe | https://dashboard.stripe.com/apikeys | Yes (Test mode) | Test keys start with `sk_test_`, live with `sk_live_` |
| `STRIPE_WEBHOOK_SECRET` | Stripe | https://dashboard.stripe.com/webhooks | — | Generated after creating webhook endpoint |
| `STRIPE_*_PRICE_ID` | Stripe | https://dashboard.stripe.com/products | — | Create products first, then copy Price IDs |
| `RESEND_API_KEY` | Resend | https://resend.com/api-keys | Yes (100 emails/day) | Free tier sufficient for dev; upgrade for production |
| `RESEND_WEBHOOK_SECRET` | Resend | https://resend.com/webhooks | — | Optional; for email event tracking (bounces, opens) |
| `ONESIGNAL_APP_ID` | OneSignal | https://app.onesignal.com/apps | Yes (10k subscribers) | Create app → Keys & IDs |
| `ONESIGNAL_API_KEY` | OneSignal | https://app.onesignal.com/apps | Yes | Same page as App ID |
| `DEEPSEEK_API_KEY` | DeepSeek | https://platform.deepseek.com/api_keys | No (pay-as-you-go) | $0.14/1M input tokens |
| `OPENAI_API_KEY` | OpenAI | https://platform.openai.com/api-keys | No (pay-as-you-go) | $0.75/1M input tokens for GPT-5.4-mini |
| `ANTHROPIC_API_KEY` | Anthropic | https://console.anthropic.com/settings/keys | No (pay-as-you-go) | $1.00/1M input tokens for Claude Haiku 4.5 |
| `FINNHUB_API_KEY` | Finnhub | https://finnhub.io/register | Yes (60 req/min) | Instant after email verification |
| `FINNHUB_WEBHOOK_SECRET` | Finnhub | https://finnhub.io/dashboard | — | Any string you define; shared secret for Finnhub webhook callback |
| `FRED_API_KEY` | FRED | https://fred.stlouisfed.org/docs/api/api_key.html | Yes (120 req/min) | Instant after registration |

### Quick Setup Order

1. **Finnhub** (instant, needed for market data)
2. **FRED** (instant, macro data)
3. **Stripe** (create products/prices in Test mode)
4. **Resend** (email delivery)
5. **OneSignal** (push notifications)
6. **DeepSeek / OpenAI / Anthropic** (AI analysis — add billing to unlock APIs)
