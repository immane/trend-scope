"use client";

import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export interface StrategyTemplate {
  key: string;
  label: string;
  description: string;
  params: Record<string, number>;
  script: string;
}

const maCrossScript = `def analyze(df, params):
    """
    MA Cross 均线交叉策略
    short 上穿 long 买入；short 下穿 long 卖出。
    """
    short = int(params.get("short", 20))
    long = int(params.get("long", 60))

    fast = df["close"].rolling(short).mean()
    slow = df["close"].rolling(long).mean()

    signal = pd.Series(0, index=df.index)
    signal[(fast.shift(1) <= slow.shift(1)) & (fast > slow)] = 1
    signal[(fast.shift(1) >= slow.shift(1)) & (fast < slow)] = -1
    return signal.shift(1).fillna(0)
`;

const emaCrossScript = `def analyze(df, params):
    """EMA Cross 指数均线交叉策略。"""
    short = int(params.get("short", 12))
    long = int(params.get("long", 26))
    fast = df["close"].ewm(span=short, adjust=False).mean()
    slow = df["close"].ewm(span=long, adjust=False).mean()
    signal = pd.Series(0, index=df.index)
    signal[(fast.shift(1) <= slow.shift(1)) & (fast > slow)] = 1
    signal[(fast.shift(1) >= slow.shift(1)) & (fast < slow)] = -1
    return signal.shift(1).fillna(0)
`;

const rsiReversionScript = `def analyze(df, params):
    """RSI 均值回归：超卖买入，超买卖出。"""
    period = int(params.get("period", 14))
    oversold = float(params.get("oversold", 30))
    overbought = float(params.get("overbought", 70))
    delta = df["close"].diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rsi = 100 - (100 / (1 + gain / loss.replace(0, pd.NA)))
    signal = pd.Series(0, index=df.index)
    signal[(rsi.shift(1) >= oversold) & (rsi < oversold)] = 1
    signal[(rsi.shift(1) <= overbought) & (rsi > overbought)] = -1
    return signal.shift(1).fillna(0)
`;

const macdCrossScript = `def analyze(df, params):
    """MACD 金叉/死叉策略。"""
    fast_period = int(params.get("fast", 12))
    slow_period = int(params.get("slow", 26))
    signal_period = int(params.get("signal", 9))
    close = df["close"]
    macd = close.ewm(span=fast_period, adjust=False).mean() - close.ewm(span=slow_period, adjust=False).mean()
    macd_signal = macd.ewm(span=signal_period, adjust=False).mean()
    output = pd.Series(0, index=df.index)
    output[(macd.shift(1) <= macd_signal.shift(1)) & (macd > macd_signal)] = 1
    output[(macd.shift(1) >= macd_signal.shift(1)) & (macd < macd_signal)] = -1
    return output.shift(1).fillna(0)
`;

const bollingerScript = `def analyze(df, params):
    """布林带均值回归：跌破下轨买入，回到中轨/上轨卖出。"""
    period = int(params.get("period", 20))
    width = float(params.get("width", 2.0))
    close = df["close"]
    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    lower = mid - width * std
    upper = mid + width * std
    output = pd.Series(0, index=df.index)
    output[(close.shift(1) >= lower.shift(1)) & (close < lower)] = 1
    output[(close.shift(1) <= mid.shift(1)) & (close > mid)] = -1
    output[(close.shift(1) <= upper.shift(1)) & (close > upper)] = -1
    return output.shift(1).fillna(0)
`;

const donchianScript = `def analyze(df, params):
    """Donchian 通道突破：突破 N 日高点买入，跌破 N 日低点卖出。"""
    period = int(params.get("period", 20))
    high_band = df["high"].rolling(period).max()
    low_band = df["low"].rolling(period).min()
    output = pd.Series(0, index=df.index)
    output[df["close"] > high_band.shift(1)] = 1
    output[df["close"] < low_band.shift(1)] = -1
    return output.shift(1).fillna(0)
`;

const momentumScript = `def analyze(df, params):
    """动量策略：过去 lookback 日涨幅超过阈值买入，跌破负阈值卖出。"""
    lookback = int(params.get("lookback", 63))
    threshold = float(params.get("threshold", 0.08))
    momentum = df["close"].pct_change(lookback)
    output = pd.Series(0, index=df.index)
    output[momentum > threshold] = 1
    output[momentum < -threshold] = -1
    return output.shift(1).fillna(0)
`;

const meanReversionScript = `def analyze(df, params):
    """Z-Score 均值回归：价格偏离均线过大时反向交易。"""
    period = int(params.get("period", 20))
    entry_z = float(params.get("entry_z", 2.0))
    exit_z = float(params.get("exit_z", 0.3))
    close = df["close"]
    mean = close.rolling(period).mean()
    std = close.rolling(period).std()
    z = (close - mean) / std.replace(0, pd.NA)
    output = pd.Series(0, index=df.index)
    output[z < -entry_z] = 1
    output[z > entry_z] = -1
    output[(z > -exit_z) & (z < exit_z)] = -1
    return output.shift(1).fillna(0)
`;

const volumeBreakoutScript = `def analyze(df, params):
    """价量突破：价格突破近期高点且成交量放大时买入，跌破均线卖出。"""
    price_period = int(params.get("price_period", 20))
    volume_period = int(params.get("volume_period", 20))
    volume_mult = float(params.get("volume_mult", 1.5))
    exit_ma = int(params.get("exit_ma", 20))
    breakout = df["close"] > df["high"].rolling(price_period).max().shift(1)
    volume_ok = df["volume"] > df["volume"].rolling(volume_period).mean() * volume_mult
    ma = df["close"].rolling(exit_ma).mean()
    output = pd.Series(0, index=df.index)
    output[breakout & volume_ok] = 1
    output[df["close"] < ma] = -1
    return output.shift(1).fillna(0)
`;

const trendRsiFilterScript = `def analyze(df, params):
    """趋势 + RSI 过滤：均线多头且 RSI 不过热时买入，均线空头或 RSI 过热卖出。"""
    short = int(params.get("short", 20))
    long = int(params.get("long", 100))
    rsi_period = int(params.get("rsi_period", 14))
    max_rsi = float(params.get("max_rsi", 75))
    close = df["close"]
    fast = close.rolling(short).mean()
    slow = close.rolling(long).mean()
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(rsi_period).mean()
    loss = (-delta.clip(upper=0)).rolling(rsi_period).mean()
    rsi = 100 - (100 / (1 + gain / loss.replace(0, pd.NA)))
    output = pd.Series(0, index=df.index)
    output[(fast > slow) & (fast.shift(1) <= slow.shift(1)) & (rsi < max_rsi)] = 1
    output[(fast < slow) | (rsi > max_rsi)] = -1
    return output.shift(1).fillna(0)
`;

const buyHoldScript = `def analyze(df, params):
    """买入持有基线：第一根可交易 K 线买入，之后不主动卖出。"""
    output = pd.Series(0, index=df.index)
    if len(output) > 1:
        output.iloc[1] = 1
    return output
`;

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  { key: "ma_cross", label: "MA Cross 均线交叉", description: "经典趋势跟踪，适合捕捉中期趋势。", params: { short: 20, long: 60 }, script: maCrossScript },
  { key: "ema_cross", label: "EMA Cross 指数均线交叉", description: "比 SMA 更快响应价格变化。", params: { short: 12, long: 26 }, script: emaCrossScript },
  { key: "rsi_reversion", label: "RSI 超买超卖", description: "常见均值回归策略。", params: { period: 14, oversold: 30, overbought: 70 }, script: rsiReversionScript },
  { key: "macd_cross", label: "MACD 金叉死叉", description: "趋势动能类常用策略。", params: { fast: 12, slow: 26, signal: 9 }, script: macdCrossScript },
  { key: "bollinger_reversion", label: "布林带均值回归", description: "利用价格偏离上下轨后的回归。", params: { period: 20, width: 2 }, script: bollingerScript },
  { key: "donchian_breakout", label: "Donchian 通道突破", description: "海龟交易常用突破框架。", params: { period: 20 }, script: donchianScript },
  { key: "momentum", label: "动量策略", description: "买强卖弱，适合趋势资产。", params: { lookback: 63, threshold: 0.08 }, script: momentumScript },
  { key: "zscore_reversion", label: "Z-Score 均值回归", description: "按标准差偏离程度交易。", params: { period: 20, entry_z: 2, exit_z: 0.3 }, script: meanReversionScript },
  { key: "volume_breakout", label: "价量突破", description: "价格突破叠加成交量确认。", params: { price_period: 20, volume_period: 20, volume_mult: 1.5, exit_ma: 20 }, script: volumeBreakoutScript },
  { key: "trend_rsi_filter", label: "趋势 + RSI 过滤", description: "趋势跟踪叠加过热过滤。", params: { short: 20, long: 100, rsi_period: 14, max_rsi: 75 }, script: trendRsiFilterScript },
  { key: "buy_hold", label: "买入持有基线", description: "用于对比策略是否跑赢单纯持有。", params: {}, script: buyHoldScript },
];

export const DEFAULT_STRATEGY_SCRIPT = maCrossScript;

export function getStrategyTemplate(key?: string) {
  return STRATEGY_TEMPLATES.find((template) => template.key === key) ?? STRATEGY_TEMPLATES[0];
}

export default function StrategyCodeEditor({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <MonacoEditor
        height="420px"
        defaultLanguage="python"
        theme="vs-dark"
        value={value || DEFAULT_STRATEGY_SCRIPT}
        onChange={(nextValue) => onChange?.(nextValue || "")}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          tabSize: 4,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
      />
    </div>
  );
}
