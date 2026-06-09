# Task 01: Phase 1 Project Initialization & Infrastructure

> **Status**: Ready for Implementation
> **Estimated Time**: 2-3 days
> **Dependencies**: None (this is the first task)
> **Depends On**: -
> **Required By**: Task 02, Task 03, Task 04

---

## 1. Objective

Create the complete project skeleton: directory structure, Docker Compose with all services, environment configuration, FastAPI app entry point, and a scaffolded Next.js admin panel.

---

## 2. Directory Structure to Create

```
/Volumes/Nayuki/Development/Python/trend-scope/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── backend/
│   ├── requirements.txt
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   └── config.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── v1/
│   │   │       ├── __init__.py
│   │   │       └── router.py
│   │   ├── models/
│   │   │   └── __init__.py
│   │   ├── schemas/
│   │   │   └── __init__.py
│   │   ├── services/
│   │   │   └── __init__.py
│   │   ├── middleware/
│   │   │   └── __init__.py
│   │   ├── scheduler/
│   │   │   └── __init__.py
│   │   └── tests/
│   │       └── __init__.py
│   └── alembic/                     (created by `alembic init alembic` in Task 02)
│       └── ...
└── admin/                           (created by `npx create-next-app@14 admin`)
    └── ...
```

---

## 3. Files to Create

### 3.1 `backend/requirements.txt`

Create the file with **pinned versions** for reproducibility. Use the latest stable releases as of June 2026.

```text
# --- Web Framework ---
fastapi==0.115.6
uvicorn[standard]==0.34.0
python-multipart==0.0.19
starlette==0.41.3

# --- Database ---
sqlalchemy[asyncio]==2.0.36
asyncmy==0.2.10
alembic==1.14.1
aiomysql==0.2.0

# --- Auth ---
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
bcrypt==4.2.1

# --- Validation & Settings ---
pydantic==2.10.4
pydantic-settings==2.7.1

# --- Data & Indicators ---
yfinance==0.2.51
pandas==2.2.3
numpy==2.2.2
pandas-ta-classic==0.0.2

# --- Backtesting ---
vectorbt==0.7.7
matplotlib==3.10.0

# --- AI ---
openai==1.59.3

# --- Email ---
resend==2.7.0

# --- Scheduling & Cache ---
apscheduler==4.0.1
redis==5.2.1
httpx==0.28.1

# --- Sandbox (custom script execution) ---
RestrictedPython==8.0

# --- Testing ---
pytest==8.3.4
pytest-asyncio==0.25.0
httpx==0.28.1
```

### 3.2 `docker-compose.yml`

```yaml
version: "3.9"

services:
  mysql:
    image: mysql:8.0
    container_name: trend-scope-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-rootpassword}
      MYSQL_DATABASE: ${MYSQL_DATABASE:-trend_scope}
      MYSQL_USER: ${MYSQL_USER:-trendscope}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:-trendscope123}
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --default-authentication-plugin=mysql_native_password
      - --max_allowed_packet=256M
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p$$MYSQL_ROOT_PASSWORD"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    networks:
      - trend-scope-network

  redis:
    image: redis:7-alpine
    container_name: trend-scope-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 10
    networks:
      - trend-scope-network

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: trend-scope-backend
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app
    environment:
      APP_ENV: ${APP_ENV:-development}
      DATABASE_URL: mysql+asyncmy://${MYSQL_USER:-trendscope}:${MYSQL_PASSWORD:-trendscope123}@mysql:3306/${MYSQL_DATABASE:-trend_scope}
      REDIS_URL: redis://redis:6379/0
      JWT_SECRET_KEY: ${JWT_SECRET_KEY:-dev-jwt-secret-change-in-production}
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY:-}
      RESEND_API_KEY: ${RESEND_API_KEY:-}
      CORS_ORIGINS: ${CORS_ORIGINS:-http://localhost:3000}
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app
    networks:
      - trend-scope-network

  admin:
    build:
      context: ./admin
      dockerfile: Dockerfile
    container_name: trend-scope-admin
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./admin:/app
      - /app/node_modules
      - /app/.next
    environment:
      NEXT_PUBLIC_API_BASE_URL: http://localhost:8000/api/v1
    depends_on:
      - backend
    command: npm run dev
    networks:
      - trend-scope-network

volumes:
  mysql_data:
    driver: local
  redis_data:
    driver: local

networks:
  trend-scope-network:
    driver: bridge
```

### 3.3 `backend/Dockerfile`

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    default-libmysqlclient-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 3.4 `admin/Dockerfile`

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
```

### 3.5 `.env.example`

```bash
# --------------------------------------------------
# Trend-Scope Environment Configuration
# Copy this file to .env and fill in values.
# --------------------------------------------------

# Application
APP_ENV=development

# MySQL 8.0
MYSQL_ROOT_PASSWORD=rootpassword
MYSQL_DATABASE=trend_scope
MYSQL_USER=trendscope
MYSQL_PASSWORD=trendscope123

# Redis
REDIS_URL=redis://redis:6379/0

# JWT Authentication
JWT_SECRET_KEY=dev-jwt-secret-change-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30

# DeepSeek AI (OpenAI-compatible endpoint)
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# Resend Email
RESEND_API_KEY=re_your-resend-api-key
EMAIL_FROM=Trend-Scope <alerts@trend-scope.com>

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:8000
```

### 3.6 `.gitignore`

```gitignore
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
*.egg-info/
dist/
build/
.eggs/
*.egg
.env
.venv/
venv/
env/
env.bak/
venv.bak/
pythonenv*

# Node
node_modules/
.next/
out/
.nuxt/

# IDE
.idea/
.vscode/
*.swp
*.swo
*~
.DS_Store

# Docker
mysql_data/
redis_data/

# Alembic
backend/alembic/versions/*.pyc

# Obsidian
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.trash/

# Testing
.coverage
htmlcov/
.pytest_cache/
.tox/

# Logs
*.log
logs/
```

### 3.7 `backend/app/__init__.py`

Create as empty file.

### 3.8 `backend/app/main.py`

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.router import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize APScheduler, Redis connection pool, etc.
    # Will be populated in later tasks.
    yield
    # Shutdown: close connections, stop scheduler, etc.
    # Will be populated in later tasks.


app = FastAPI(
    title="Trend-Scope API",
    description="Phase 1 MVP — Trend analysis and signal generation platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}
```

### 3.9 `backend/app/core/__init__.py`

Create as empty file.

### 3.10 `backend/app/core/config.py`

```python
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    APP_ENV: str = "development"

    # MySQL
    MYSQL_ROOT_PASSWORD: str = "rootpassword"
    MYSQL_DATABASE: str = "trend_scope"
    MYSQL_USER: str = "trendscope"
    MYSQL_PASSWORD: str = "trendscope123"
    DATABASE_URL: str = (
        f"mysql+asyncmy://{MYSQL_USER}:{MYSQL_PASSWORD}@localhost:3306/{MYSQL_DATABASE}"
    )

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT
    JWT_SECRET_KEY: str = "dev-jwt-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # DeepSeek AI
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_MODEL: str = "deepseek-chat"

    # Resend
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "Trend-Scope <alerts@trend-scope.com>"

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:8000"]

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


settings = Settings()
```

### 3.11 `backend/app/api/__init__.py`

Create as empty file.

### 3.12 `backend/app/api/v1/__init__.py`

Create as empty file.

### 3.13 `backend/app/api/v1/router.py`

```python
from fastapi import APIRouter

api_router = APIRouter()

# Auth and user routes will be registered here in later tasks:
# api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
# api_router.include_router(users_router, prefix="/users", tags=["users"])
# api_router.include_router(stocks_router, prefix="/stocks", tags=["stocks"])
# ... etc.
```

### 3.14 `backend/app/models/__init__.py`

Create as empty file.

### 3.15 `backend/app/schemas/__init__.py`

Create as empty file.

### 3.16 `backend/app/services/__init__.py`

Create as empty file.

### 3.17 `backend/app/middleware/__init__.py`

Create as empty file.

### 3.18 `backend/app/scheduler/__init__.py`

Create as empty file.

### 3.19 `backend/app/tests/__init__.py`

Create as empty file.

### 3.20 Admin Panel (Next.js 14)

The admin panel will be created via `npx create-next-app@14 admin` and then configured with Ant Design 5 and Tailwind CSS.

**Steps** (to be run in the project root):

```bash
# 1. Create Next.js 14 app with TypeScript
npx create-next-app@14 admin --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbo

# 2. Install additional dependencies
cd admin
npm install antd @ant-design/icons @ant-design/nextjs-registry @tanstack/react-query axios dayjs
npm install --save-dev @types/node

# 3. Install TradingView charting
npm install lightweight-charts
```

**Key configuration files**:

#### `admin/next.config.mjs`

```mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    'antd',
    '@ant-design/nextjs-registry',
    '@ant-design/icons',
    '@ant-design/icons-svg',
    'rc-util',
    'rc-pagination',
    'rc-picker',
    'rc-tree',
    'rc-table',
  ],
};

export default nextConfig;
```

#### `admin/src/app/layout.tsx`

```tsx
import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { QueryClientProvider } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trend-Scope Admin",
  description: "Trend-Scope Management Panel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <ConfigProvider
            locale={zhCN}
            theme={{
              token: {
                colorPrimary: "#1677ff",
              },
            }}
          >
            <QueryClientProvider>{children}</QueryClientProvider>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
```

#### `admin/src/app/providers.tsx`

```tsx
"use client";

import { QueryClient, QueryClientProvider as TanStackProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryClientProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <TanStackProvider client={queryClient}>{children}</TanStackProvider>
  );
}
```

#### `admin/src/app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  padding: 0;
}
```

#### `admin/tailwind.config.ts`

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
};
export default config;
```

#### `admin/src/lib/api.ts`

```ts
import axios from "axios";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api/v1",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

#### `admin/src/app/page.tsx`

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/login");
}
```

---

## 4. Verification Steps

After completing this task, verify the following:

```bash
# 1. Start all services
docker compose up -d

# 2. Check all services are healthy
docker compose ps
# All four services should show "healthy" or "running"

# 3. Verify backend health endpoint
curl http://localhost:8000/health
# Expected: {"status":"ok","version":"0.1.0"}

# 4. Verify FastAPI docs are accessible
# Open http://localhost:8000/docs in browser — Swagger UI should load

# 5. Verify admin panel is accessible
# Open http://localhost:3000 in browser — should redirect to /login

# 6. Verify Redis connectivity
docker compose exec redis redis-cli ping
# Expected: PONG

# 7. Verify MySQL connectivity
docker compose exec mysql mysql -u trendscope -ptrendscope123 trend_scope -e "SELECT 1"
# Expected: 1

# 8. Shut down
docker compose down
```

---

## 5. Acceptance Criteria

- [ ] `docker compose up -d` starts all 4 services without errors
- [ ] MySQL 8.0 is running with utf8mb4 charset and is health-checked
- [ ] Redis 7 is running with AOF persistence and is health-checked
- [ ] Backend FastAPI app responds to `GET /health` with `{"status":"ok","version":"0.1.0"}`
- [ ] Swagger docs available at `http://localhost:8000/docs`
- [ ] CORS middleware allows requests from the admin origin (`http://localhost:3000`)
- [ ] Admin Next.js app serves at port 3000
- [ ] Admin app includes Ant Design 5, Tailwind CSS, React Query, axios, and the AntdRegistry
- [ ] `.env.example` contains all required environment variables with documented defaults
- [ ] `.gitignore` excludes `.env`, `node_modules/`, `__pycache__/`, `*.pyc`, `.next/`
- [ ] All `__init__.py` files exist in the correct directories
- [ ] `backend/app/core/config.py` loads settings from `.env` via pydantic-settings
- [ ] Backend Dockerfile uses Python 3.12-slim with gcc for mysqlclient compilation
- [ ] Admin Dockerfile uses Node 20-alpine with npm ci for reproducible builds
- [ ] Backend volume mounts enable hot-reload (`--reload`)
- [ ] Admin volume mounts enable hot-reload (`npm run dev`)
- [ ] Admin `tailwind.config.ts` has `preflight: false` to avoid conflicts with Ant Design
- [ ] Admin `next.config.mjs` transpiles required Ant Design packages

---

## 6. Estimated Time Breakdown

| Subtask | Est. Time |
|---|---|
| Create directory structure + `__init__.py` files | 0.5h |
| `requirements.txt` with pinned versions | 0.5h |
| `docker-compose.yml` with all services | 1.5h |
| `backend/Dockerfile` and `admin/Dockerfile` | 0.5h |
| `.env.example` | 0.5h |
| `.gitignore` | 0.25h |
| `backend/app/main.py` FastAPI app entry | 0.5h |
| `backend/app/core/config.py` settings | 0.5h |
| `backend/app/api/v1/router.py` placeholder | 0.25h |
| Admin panel: `create-next-app` + dependencies | 0.5h |
| Admin panel: configuration files | 1h |
| Docker verification + debugging | 2h |
| **Total** | **~8.5h (1-1.5 days)** |
