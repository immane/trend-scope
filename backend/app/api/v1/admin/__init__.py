from fastapi import APIRouter

from app.api.v1.admin.alerts import router as alerts_router
from app.api.v1.admin.backtest import router as backtest_router
from app.api.v1.admin.dashboard import router as dashboard_router
from app.api.v1.admin.price_data import router as price_data_router
from app.api.v1.admin.rules import router as rules_router
from app.api.v1.admin.signals import router as signals_router
from app.api.v1.admin.stocks import router as stocks_router
from app.api.v1.admin.strategies import router as strategies_router
from app.api.v1.admin.users import router as users_router

admin_router = APIRouter()
admin_router.include_router(alerts_router)
admin_router.include_router(backtest_router)
admin_router.include_router(dashboard_router)
admin_router.include_router(price_data_router)
admin_router.include_router(rules_router)
admin_router.include_router(signals_router)
admin_router.include_router(stocks_router)
admin_router.include_router(strategies_router)
admin_router.include_router(users_router)
