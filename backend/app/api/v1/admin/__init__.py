from fastapi import APIRouter

from app.api.v1.admin.stocks import router as stocks_router

admin_router = APIRouter()
admin_router.include_router(stocks_router)
