from fastapi import APIRouter

from app.api.v1 import auth, stocks, users
from app.api.v1.admin import admin_router

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(stocks.router, prefix="/stocks", tags=["stocks"])
api_router.include_router(admin_router)
