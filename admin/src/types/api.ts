export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface Stock {
  id: number;
  symbol: string;
  name: string;
  type: string;
  market: string;
  sector?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Strategy {
  id: number;
  stock_id?: number | null;
  name: string;
  description?: string | null;
  strategy_type: string;
  params: Record<string, unknown>;
  script_content?: string | null;
  script_params?: Record<string, unknown> | null;
  confirm_bars?: number;
  volume_confirm?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Signal {
  id: number;
  stock_id: number;
  config_id: number;
  signal_type: string;
  signal_subtype?: string | null;
  strength: string;
  trigger_price: string;
  triggered_date: string;
}

export interface BacktestItem {
  id: number;
  user_id?: number;
  stock_id: number;
  config_id: number;
  status: string;
  start_date?: string;
  end_date?: string;
  initial_capital?: string;
  slippage_pct?: string;
  commission_pct?: string;
  total_return?: string | null;
  cagr?: string | null;
  max_drawdown?: string | null;
  sharpe_ratio?: string | null;
  sortino_ratio?: string | null;
  calmar_ratio?: string | null;
  win_rate?: string | null;
  profit_factor?: string | null;
  num_trades?: number | null;
  benchmark_return?: string | null;
  equity_curve?: { points?: CurvePoint[] } | null;
  drawdown_curve?: { points?: CurvePoint[] } | null;
  monthly_returns?: Record<string, number> | null;
  trade_log?: { trades?: TradeRecord[] } | null;
  execution_time_ms?: number | null;
  error_message?: string | null;
  created_at: string;
}

export interface CurvePoint {
  date: string;
  value: number;
}

export interface TradeRecord {
  date: string;
  side: "buy" | "sell" | string;
  price: number;
  pnl?: number;
}

export interface AlertLog {
  id: number;
  user_id: number;
  stock_id: number;
  signal_id?: number | null;
  title: string;
  status: string;
  sent_at: string;
}
