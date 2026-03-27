from __future__ import annotations

import json
import math
import os
import subprocess
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from statistics import mean, pstdev
from typing import Any


@dataclass
class Candle:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class SwingPoint:
    type: str
    date: str
    index: int
    price: float
    strength: float


@dataclass
class TrendLine:
    kind: str
    startDate: str
    endDate: str
    startIndex: int
    endIndex: int
    startPrice: float
    endPrice: float
    slope: float


@dataclass
class PriceZone:
    kind: str
    label: str
    low: float
    high: float
    confidence: float


@dataclass
class MarketStructure:
    trendState: str
    swingSequence: str
    higherHighs: bool
    higherLows: bool
    lowerHighs: bool
    lowerLows: bool
    lastSwingHigh: float | None
    lastSwingLow: float | None
    swingHighs: list[SwingPoint]
    swingLows: list[SwingPoint]


@dataclass
class PriceProjection:
    direction: str
    horizon: str
    horizonBars: int
    expectedMovePct: float
    buyZone: PriceZone
    sellZone: PriceZone
    targetZone: PriceZone
    stretchZone: PriceZone
    invalidationLevel: float
    stopLevel: float
    notes: list[str]


@dataclass
class ModelSuggestion:
    modelName: str
    provider: str
    featureVersion: str
    nativeBackendUsed: bool
    candleCount: int
    inferenceLatencyMs: float
    generatedAt: str
    action: str
    confidence: float
    expectedMovePct: float
    regime: str
    horizon: str
    support: float
    resistance: float
    stopLoss: float
    target: float
    reasons: list[str]
    features: dict[str, float]
    structure: MarketStructure
    trendLines: list[TrendLine]
    projection: PriceProjection


def pct_returns(closes: list[float]) -> list[float]:
    returns: list[float] = []
    for prev, cur in zip(closes, closes[1:]):
        if prev:
            returns.append((cur / prev) - 1.0)
    return returns


def rolling_mean(values: list[float], window: int) -> float:
    if not values:
        return 0.0
    return mean(values[-window:]) if len(values) >= window else mean(values)


def round_price(value: float) -> float:
    return round(float(value), 2)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def find_swing_points(candles: list[Candle], kind: str, left: int = 3, right: int = 3) -> list[SwingPoint]:
    points: list[SwingPoint] = []
    if len(candles) < left + right + 2:
        return points
    for idx in range(left, len(candles) - right):
        window = candles[idx - left : idx + right + 1]
        center = candles[idx]
        if kind == "HIGH":
            pivot = center.high
            if all(pivot >= candle.high for candle in window):
                neighborhood_low = min(candle.low for candle in window)
                strength = (pivot - neighborhood_low) / pivot if pivot else 0.0
                points.append(SwingPoint("HIGH", center.date, idx, round_price(pivot), round(strength, 4)))
        else:
            pivot = center.low
            if all(pivot <= candle.low for candle in window):
                neighborhood_high = max(candle.high for candle in window)
                strength = (neighborhood_high - pivot) / pivot if pivot else 0.0
                points.append(SwingPoint("LOW", center.date, idx, round_price(pivot), round(strength, 4)))
    return points[-6:]


def default_swing(candles: list[Candle], kind: str) -> SwingPoint:
    if kind == "HIGH":
        idx = max(range(len(candles)), key=lambda i: candles[i].high)
        return SwingPoint("HIGH", candles[idx].date, idx, round_price(candles[idx].high), 0.0)
    idx = min(range(len(candles)), key=lambda i: candles[i].low)
    return SwingPoint("LOW", candles[idx].date, idx, round_price(candles[idx].low), 0.0)


def classify_structure(swing_highs: list[SwingPoint], swing_lows: list[SwingPoint]) -> tuple[MarketStructure, list[str]]:
    recent_highs = swing_highs[-2:]
    recent_lows = swing_lows[-2:]
    higher_highs = len(recent_highs) == 2 and recent_highs[-1].price > recent_highs[-2].price
    lower_highs = len(recent_highs) == 2 and recent_highs[-1].price < recent_highs[-2].price
    higher_lows = len(recent_lows) == 2 and recent_lows[-1].price > recent_lows[-2].price
    lower_lows = len(recent_lows) == 2 and recent_lows[-1].price < recent_lows[-2].price

    if higher_highs and higher_lows:
        trend_state = "BULLISH_CHANNEL"
        swing_sequence = "HH-HL"
    elif lower_highs and lower_lows:
        trend_state = "BEARISH_CHANNEL"
        swing_sequence = "LH-LL"
    elif higher_lows and not higher_highs:
        trend_state = "ACCUMULATION"
        swing_sequence = "HL"
    elif lower_highs and not lower_lows:
        trend_state = "DISTRIBUTION"
        swing_sequence = "LH"
    else:
        trend_state = "RANGE"
        swing_sequence = "MIXED"

    notes = [
        f"Swing sequence {swing_sequence}",
        f"Higher highs {'confirmed' if higher_highs else 'not confirmed'}",
        f"Higher lows {'confirmed' if higher_lows else 'not confirmed'}",
    ]
    structure = MarketStructure(
        trendState=trend_state,
        swingSequence=swing_sequence,
        higherHighs=higher_highs,
        higherLows=higher_lows,
        lowerHighs=lower_highs,
        lowerLows=lower_lows,
        lastSwingHigh=recent_highs[-1].price if recent_highs else None,
        lastSwingLow=recent_lows[-1].price if recent_lows else None,
        swingHighs=swing_highs[-4:],
        swingLows=swing_lows[-4:],
    )
    return structure, notes


def make_line(kind: str, first: SwingPoint, second: SwingPoint) -> TrendLine:
    span = max(1, second.index - first.index)
    slope = (second.price - first.price) / span
    return TrendLine(
        kind=kind,
        startDate=first.date,
        endDate=second.date,
        startIndex=first.index,
        endIndex=second.index,
        startPrice=first.price,
        endPrice=second.price,
        slope=round(slope, 6),
    )


def line_value(line: TrendLine, index: int) -> float:
    return float(line.startPrice) + float(line.slope) * (index - int(line.startIndex))


def build_trend_lines(
    candles: list[Candle],
    swing_highs: list[SwingPoint],
    swing_lows: list[SwingPoint],
) -> list[TrendLine]:
    support_points = swing_lows[-2:] if len(swing_lows) >= 2 else [default_swing(candles, "LOW"), SwingPoint("LOW", candles[-1].date, len(candles) - 1, round_price(candles[-1].low), 0.0)]
    resistance_points = swing_highs[-2:] if len(swing_highs) >= 2 else [default_swing(candles, "HIGH"), SwingPoint("HIGH", candles[-1].date, len(candles) - 1, round_price(candles[-1].high), 0.0)]

    support_line = make_line("SUPPORT", support_points[0], support_points[1])
    resistance_line = make_line("RESISTANCE", resistance_points[0], resistance_points[1])

    mid_start = (support_line.startPrice + resistance_line.startPrice) / 2.0
    mid_end = (support_line.endPrice + resistance_line.endPrice) / 2.0
    mid_line = TrendLine(
        kind="MID",
        startDate=support_line.startDate,
        endDate=support_line.endDate,
        startIndex=min(support_line.startIndex, resistance_line.startIndex),
        endIndex=max(support_line.endIndex, resistance_line.endIndex),
        startPrice=round_price(mid_start),
        endPrice=round_price(mid_end),
        slope=round((mid_end - mid_start) / max(1, max(support_line.endIndex, resistance_line.endIndex) - min(support_line.startIndex, resistance_line.startIndex)), 6),
    )
    return [support_line, mid_line, resistance_line]


def build_projection(
    candles: list[Candle],
    structure: MarketStructure,
    trend_lines: list[TrendLine],
    expected_move_pct: float,
    confidence: float,
) -> PriceProjection:
    current_index = len(candles) - 1
    last_close = candles[-1].close
    support_line = next(line for line in trend_lines if line.kind == "SUPPORT")
    mid_line = next(line for line in trend_lines if line.kind == "MID")
    resistance_line = next(line for line in trend_lines if line.kind == "RESISTANCE")

    support_now = line_value(support_line, current_index)
    resistance_now = line_value(resistance_line, current_index)
    mid_now = line_value(mid_line, current_index)
    channel_width = max(1.0, resistance_now - support_now)
    horizon_bars = 10

    bullish = structure.trendState in {"BULLISH_CHANNEL", "ACCUMULATION"}
    bearish = structure.trendState in {"BEARISH_CHANNEL", "DISTRIBUTION"}
    direction = "UP" if bullish else "DOWN" if bearish else "NEUTRAL"

    buy_low = max(min(support_now * 0.995, last_close), support_now * 0.99)
    buy_high = support_now + channel_width * 0.22
    sell_low = resistance_now - channel_width * 0.22
    sell_high = resistance_now * 1.005
    invalidation = support_now - channel_width * 0.16 if bullish or not bearish else resistance_now + channel_width * 0.16
    stop_level = invalidation

    if bullish:
        target_center = resistance_now + channel_width * 0.18
        stretch_center = resistance_now + channel_width * 0.42
    elif bearish:
        target_center = support_now - channel_width * 0.18
        stretch_center = support_now - channel_width * 0.42
    else:
        target_center = mid_now
        stretch_center = resistance_now if last_close < mid_now else support_now

    target_half_width = max(channel_width * 0.08, last_close * (expected_move_pct / 250.0))
    stretch_half_width = target_half_width * 1.35

    buy_zone = PriceZone("BUY", "Pullback buy zone", round_price(min(buy_low, buy_high)), round_price(max(buy_low, buy_high)), round(confidence, 4))
    sell_zone = PriceZone("SELL", "Seller pressure zone", round_price(min(sell_low, sell_high)), round_price(max(sell_low, sell_high)), round(confidence * 0.92, 4))
    target_zone = PriceZone("TARGET", "Expected destination", round_price(target_center - target_half_width), round_price(target_center + target_half_width), round(min(0.95, confidence + 0.04), 4))
    stretch_zone = PriceZone("STRETCH", "Stretch target", round_price(stretch_center - stretch_half_width), round_price(stretch_center + stretch_half_width), round(max(0.2, confidence - 0.12), 4))

    notes = [
        f"Channel width {channel_width:.2f}",
        f"Midline sits near {mid_now:.2f}",
        f"Invalidation level {invalidation:.2f}",
    ]
    return PriceProjection(
        direction=direction,
        horizon="5D",
        horizonBars=horizon_bars,
        expectedMovePct=round(expected_move_pct, 2),
        buyZone=buy_zone,
        sellZone=sell_zone,
        targetZone=target_zone,
        stretchZone=stretch_zone,
        invalidationLevel=round_price(invalidation),
        stopLevel=round_price(stop_level),
        notes=notes,
    )


def native_snapshot(closes: list[float]) -> dict[str, Any] | None:
    binary = os.getenv("ALPHATRADE_NATIVE_SIGNAL_BIN", "/usr/local/bin/signal_engine_cli")
    if not os.path.exists(binary):
        return None
    try:
        raw = ",".join(f"{close:.6f}" for close in closes)
        result = subprocess.run(
            [binary, raw],
            capture_output=True,
            text=True,
            check=True,
            timeout=2,
        )
        return json.loads(result.stdout)
    except Exception:
        return None


def score_symbol(symbol: str, candles: list[Candle]) -> ModelSuggestion:
    started = datetime.now(timezone.utc)
    closes = [c.close for c in candles]
    volumes = [c.volume for c in candles]
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]

    last = closes[-1]
    returns = pct_returns(closes)
    momentum_5 = ((last / closes[-6]) - 1.0) if len(closes) >= 6 and closes[-6] else 0.0
    momentum_20 = ((last / closes[-21]) - 1.0) if len(closes) >= 21 and closes[-21] else 0.0
    sma_10 = rolling_mean(closes, 10)
    sma_20 = rolling_mean(closes, 20)
    vol_20 = pstdev(returns[-20:]) if len(returns) >= 2 else 0.0
    avg_volume_20 = rolling_mean(volumes, 20)
    volume_ratio = (volumes[-1] / avg_volume_20) if avg_volume_20 else 1.0
    recent_high = max(highs[-20:]) if highs else last
    recent_low = min(lows[-20:]) if lows else last
    range_position = 0.5 if recent_high == recent_low else (last - recent_low) / (recent_high - recent_low)

    native = native_snapshot(closes)
    swing_highs = find_swing_points(candles, "HIGH")
    swing_lows = find_swing_points(candles, "LOW")
    if not swing_highs:
        swing_highs = [default_swing(candles, "HIGH")]
    if not swing_lows:
        swing_lows = [default_swing(candles, "LOW")]

    structure, structure_notes = classify_structure(swing_highs, swing_lows)
    trend_lines = build_trend_lines(candles, swing_highs, swing_lows)

    raw_score = (
        1.7 * momentum_5
        + 2.4 * momentum_20
        + 0.8 * ((last - sma_10) / sma_10 if sma_10 else 0.0)
        + 1.2 * ((last - sma_20) / sma_20 if sma_20 else 0.0)
        + 0.05 * math.log(max(volume_ratio, 0.2))
        - 1.8 * vol_20
    )
    if structure.higherHighs and structure.higherLows:
        raw_score += 0.035
    elif structure.lowerHighs and structure.lowerLows:
        raw_score -= 0.035
    if native is not None:
        raw_score = (raw_score * 0.62) + (float(native.get("trendScore", 0.0)) * 0.38)

    confidence = max(0.08, min(0.95, 0.5 + raw_score * 8))
    expected_move_pct = max(0.2, min(7.5, abs(raw_score) * 100 + vol_20 * 120))
    projection = build_projection(candles, structure, trend_lines, expected_move_pct, confidence)

    in_buy_zone = projection.buyZone.low <= last <= projection.buyZone.high
    in_sell_zone = projection.sellZone.low <= last <= projection.sellZone.high
    bullish = structure.trendState in {"BULLISH_CHANNEL", "ACCUMULATION"}
    bearish = structure.trendState in {"BEARISH_CHANNEL", "DISTRIBUTION"}

    if bullish and in_buy_zone:
        action = "BUY"
    elif bearish and in_sell_zone:
        action = "SELL"
    elif bullish and raw_score > 0.01:
        action = "BUY"
    elif bearish and raw_score < -0.01:
        action = "SELL"
    else:
        action = "HOLD"

    if native is not None:
        regime = str(native.get("regime", "BALANCED"))
    elif vol_20 < 0.01:
        regime = "TRENDING"
    elif vol_20 < 0.02:
        regime = "BALANCED"
    else:
        regime = "VOLATILE"

    support = projection.buyZone.low
    resistance = projection.sellZone.high
    stop_loss = projection.stopLevel
    target = projection.targetZone.high if action != "SELL" else projection.targetZone.low

    reasons = [
        f"Trend state {structure.trendState}",
        f"5-day momentum {momentum_5 * 100:.2f}%",
        f"20-day momentum {momentum_20 * 100:.2f}%",
        f"Volume ratio {volume_ratio:.2f}x",
        f"Range position {range_position:.2f}",
        f"Buy zone {projection.buyZone.low:.2f} - {projection.buyZone.high:.2f}",
        f"Target zone {projection.targetZone.low:.2f} - {projection.targetZone.high:.2f}",
    ]
    reasons.extend(structure_notes)
    reasons.extend(projection.notes)
    if native is not None:
        reasons.append(f"Native trend score {float(native.get('trendScore', 0.0)):.4f}")

    inference_ms = (datetime.now(timezone.utc) - started).total_seconds() * 1000.0

    return ModelSuggestion(
        modelName="alphatrade-structure-projection-v2",
        provider="python-model-svc",
        featureVersion="2026-03-structure-pack-2",
        nativeBackendUsed=native is not None,
        candleCount=len(candles),
        inferenceLatencyMs=round(inference_ms, 3),
        generatedAt=datetime.now(timezone.utc).isoformat(),
        action=action,
        confidence=round(confidence, 4),
        expectedMovePct=round(expected_move_pct, 2),
        regime=regime,
        horizon="short_swing",
        support=round_price(support),
        resistance=round_price(resistance),
        stopLoss=round_price(stop_loss),
        target=round_price(target),
        reasons=reasons,
        features={
            "last_close": round(last, 4),
            "momentum_5": round(momentum_5, 6),
            "momentum_20": round(momentum_20, 6),
            "sma_10": round(sma_10, 4),
            "sma_20": round(sma_20, 4),
            "volatility_20": round(vol_20, 6),
            "volume_ratio": round(volume_ratio, 4),
            "range_position": round(range_position, 4),
            "swing_high_count": float(len(structure.swingHighs)),
            "swing_low_count": float(len(structure.swingLows)),
            "native_trend_score": round(float(native.get("trendScore", 0.0)), 6) if native is not None else 0.0,
            "native_volatility_20": round(float(native.get("volatility20", 0.0)), 6) if native is not None else 0.0,
        },
        structure=structure,
        trendLines=trend_lines,
        projection=projection,
    )


class ModelHandler(BaseHTTPRequestHandler):
    server_version = "AlphaTradeModel/0.2"

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"status": "UP", "service": "model-svc"})
        else:
            self._send(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/score":
            self._send(404, {"error": "Not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(body)
            symbol = str(payload.get("symbol", "UNKNOWN")).upper()
            candles = [Candle(**item) for item in payload.get("candles", [])]
            if len(candles) < 25:
                self._send(400, {"error": "Need at least 25 candles"})
                return
            suggestion = score_symbol(symbol, candles)
            self._send(200, asdict(suggestion))
        except Exception as exc:
            self._send(500, {"error": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:
        return


def main(host: str = "0.0.0.0", port: int = 8090) -> None:
    server = ThreadingHTTPServer((host, port), ModelHandler)
    print(f"AlphaTrade model service listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
