from fastapi import APIRouter

from app.api.v1 import alerts, analysis, auth, backtest, stocks, users
from app.api.v1.admin import admin_router
from app.api.v1.admin.announcements import announcements_public

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(stocks.router, prefix="/stocks", tags=["stocks"])
api_router.include_router(analysis.router)
api_router.include_router(backtest.router)
api_router.include_router(alerts.router)
api_router.include_router(announcements_public)
api_router.include_router(admin_router)
