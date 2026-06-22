import os


os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_trend_scope.db")

import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import hash_password
from app.models.base import Base
from app.models.stock import Stock
from app.models.user import User


@pytest_asyncio.fixture(autouse=True, scope="function")
async def reset_test_database():
    from app.core import deps

    engine = create_async_engine(os.environ["DATABASE_URL"], echo=False)
    deps.engine = engine
    deps.AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with deps.AsyncSessionLocal() as db:
        db.add(User(id=1, email="admin@trend-scope.com", password_hash=hash_password("Admin123!"), nickname="Admin", role="admin", status="active"))
        for idx, symbol in enumerate(["SPY", "QQQ", "DIA", "IWM", "VTI", "VOO", "ARKK", "GLD", "TLT", "XLF"], start=1):
            db.add(Stock(id=idx, symbol=symbol, name=f"{symbol} ETF", type="ETF", market="US", is_active=True))
        await db.commit()
    yield
    await engine.dispose()
