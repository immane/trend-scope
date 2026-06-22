from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pandas as pd

from app.services.analysis_engine import generate_signals
from app.services.backtest_service import BacktestService


def make_price_frame(closes: list[float]) -> pd.DataFrame:
    dates = [date(2024, 1, 1) + timedelta(days=offset) for offset in range(len(closes))]
    return pd.DataFrame(
        {
            "open": closes,
            "high": [price + 1 for price in closes],
            "low": [price - 1 for price in closes],
            "close": closes,
            "volume": [1_000_000] * len(closes),
        },
        index=pd.Index(dates),
    )


def backtest_service() -> BacktestService:
    return BacktestService.__new__(BacktestService)


def test_backtest_simulation_accounts_for_slippage_commission_and_cash():
    df = make_price_frame([100.0, 110.0, 120.0])
    signals = pd.Series([1, 0, -1], index=df.index)

    metrics = backtest_service()._simulate(df, signals, initial_capital=1000.0, slippage_pct=0.01, commission_pct=0.001)

    buy_fill = 101.0
    sell_fill = 118.8
    shares = 1000.0 / (buy_fill * 1.001)
    buy_notional = shares * buy_fill
    buy_commission = buy_notional * 0.001
    sell_notional = shares * sell_fill
    sell_commission = sell_notional * 0.001
    expected_final_value = sell_notional - sell_commission
    expected_pnl = expected_final_value - buy_notional - buy_commission

    assert metrics["total_return"] == Decimal(str(round(expected_final_value / 1000.0 - 1, 6)))
    assert metrics["num_trades"] == 1
    assert metrics["win_rate"] == Decimal("1.000000")
    assert metrics["profit_factor"] > Decimal("1000000")
    assert metrics["trade_log"]["trades"][0] == {"date": "2024-01-01", "side": "buy", "price": 101.0, "commission": round(buy_commission, 2)}
    assert metrics["trade_log"]["trades"][1] == {"date": "2024-01-03", "side": "sell", "price": 118.8, "commission": round(sell_commission, 2), "pnl": round(expected_pnl, 2)}
    assert metrics["equity_curve"]["points"][-1]["value"] == round(expected_final_value, 2)


def test_backtest_open_position_equity_marks_cash_plus_position_value():
    df = make_price_frame([100.0, 110.0])
    signals = pd.Series([1, 0], index=df.index)

    metrics = backtest_service()._simulate(df, signals, initial_capital=1000.0, slippage_pct=0.01, commission_pct=0.001)

    shares = 1000.0 / (101.0 * 1.001)
    expected_equity = shares * 110.0

    assert metrics["num_trades"] == 0
    assert metrics["equity_curve"]["points"][-1]["value"] == round(expected_equity, 2)
    assert metrics["total_return"] == Decimal(str(round(expected_equity / 1000.0 - 1, 6)))


def test_ma_cross_signals_are_delayed_to_next_bar_to_avoid_lookahead():
    df = make_price_frame([3.0, 2.0, 1.0, 2.0, 3.0, 4.0])
    config = SimpleNamespace(strategy_type="ma_cross", params={"ma_short": 2, "ma_long": 3})

    signals = generate_signals(df, config)

    assert signals.tolist() == [0, 0, 0, 0, 0, 1]
