import asyncio

from passlib.context import CryptContext
from sqlalchemy import select

from app.core.deps import AsyncSessionLocal
from app.models import Stock, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ADMIN_EMAIL = "admin@trend-scope.com"
ADMIN_PASSWORD = "Admin123!"

ETF_SEEDS = [
    {"symbol": "SPY", "name": "SPDR S&P 500 ETF Trust", "type": "ETF", "sector": "Large Cap"},
    {"symbol": "QQQ", "name": "Invesco QQQ Trust", "type": "ETF", "sector": "Technology"},
    {"symbol": "IWM", "name": "iShares Russell 2000 ETF", "type": "ETF", "sector": "Small Cap"},
    {"symbol": "DIA", "name": "SPDR Dow Jones Industrial Average ETF", "type": "ETF", "sector": "Large Cap"},
    {"symbol": "VTI", "name": "Vanguard Total Stock Market ETF", "type": "ETF", "sector": "Broad Market"},
    {"symbol": "TQQQ", "name": "ProShares UltraPro QQQ", "type": "ETF", "sector": "Leveraged"},
    {"symbol": "SOXL", "name": "Direxion Daily Semiconductor Bull 3X Shares", "type": "ETF", "sector": "Leveraged"},
    {"symbol": "TLT", "name": "iShares 20+ Year Treasury Bond ETF", "type": "ETF", "sector": "Bond"},
    {"symbol": "GLD", "name": "SPDR Gold Shares", "type": "ETF", "sector": "Commodity"},
    {"symbol": "XLE", "name": "Energy Select Sector SPDR Fund", "type": "ETF", "sector": "Energy"},
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == ADMIN_EMAIL))
        if result.scalar_one_or_none() is None:
            db.add(
                User(
                    email=ADMIN_EMAIL,
                    password_hash=pwd_context.hash(ADMIN_PASSWORD),
                    nickname="Admin",
                    role="admin",
                    status="active",
                )
            )
            print(f"[OK] Admin user created: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
        else:
            print(f"[SKIP] Admin user already exists: {ADMIN_EMAIL}")

        for etf in ETF_SEEDS:
            result = await db.execute(select(Stock).where(Stock.symbol == etf["symbol"]))
            if result.scalar_one_or_none() is None:
                db.add(
                    Stock(
                        symbol=etf["symbol"],
                        name=etf["name"],
                        type=etf["type"],
                        market="US",
                        sector=etf["sector"],
                        is_active=True,
                    )
                )
                print(f"[OK] Stock added: {etf['symbol']} - {etf['name']}")
            else:
                print(f"[SKIP] Stock already exists: {etf['symbol']}")

        await db.commit()
        print("[DONE] Seed data complete.")


if __name__ == "__main__":
    asyncio.run(seed())
