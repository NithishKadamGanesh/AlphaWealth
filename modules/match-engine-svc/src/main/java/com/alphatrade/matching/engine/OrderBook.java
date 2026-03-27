package com.alphatrade.matching.engine;

import com.alphatrade.common.model.*;
import com.alphatrade.matching.model.RestingOrder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

/**
 * Single-symbol order book implementing price-time priority.
 *
 * FIXES from code review:
 *   1. FOK now checks liquidity BEFORE executing any fills
 *   2. Trade IDs use UUID to prevent collisions
 *   3. Order cancel/amend support added
 *   4. Partial fill tracking on passive orders emits updates correctly
 */
public class OrderBook {

    private static final Logger log = LoggerFactory.getLogger(OrderBook.class);

    private final String symbol;
    private final TreeMap<BigDecimal, LinkedList<RestingOrder>> bids = new TreeMap<>(Comparator.reverseOrder());
    private final TreeMap<BigDecimal, LinkedList<RestingOrder>> asks = new TreeMap<>();
    // Index for fast cancel/amend lookup
    private final Map<String, RestingOrder> orderIndex = new HashMap<>();

    public OrderBook(String symbol) {
        this.symbol = symbol;
    }

    public String getSymbol() { return symbol; }

    public MatchResult processOrder(Order incomingOrder) {
        RestingOrder aggressor = new RestingOrder(incomingOrder);
        List<Trade> trades = new ArrayList<>();
        List<Order> orderUpdates = new ArrayList<>();

        TreeMap<BigDecimal, LinkedList<RestingOrder>> oppositeSide =
            (aggressor.getSide() == OrderSide.BUY) ? asks : bids;

        // ── FOK pre-check: verify sufficient liquidity before any fills ──
        if (aggressor.getTimeInForce() == TimeInForce.FOK) {
            int available = computeAvailableLiquidity(oppositeSide, aggressor);
            if (available < aggressor.getOriginalQty()) {
                log.info("FOK order {} rejected: need {} but only {} available",
                    aggressor.getOrderId(), aggressor.getOriginalQty(), available);
                orderUpdates.add(buildCancelledUpdate(aggressor, "FOK: insufficient liquidity"));
                return new MatchResult(trades, orderUpdates, buildSnapshot());
            }
        }

        // ── Main match loop ─────────────────────────────────────────────
        while (aggressor.getRemainingQty() > 0 && !oppositeSide.isEmpty()) {
            Map.Entry<BigDecimal, LinkedList<RestingOrder>> bestLevel = oppositeSide.firstEntry();
            BigDecimal bestPrice = bestLevel.getKey();

            if (aggressor.getType() == OrderType.LIMIT) {
                if (aggressor.getSide() == OrderSide.BUY && aggressor.getPrice().compareTo(bestPrice) < 0) break;
                if (aggressor.getSide() == OrderSide.SELL && aggressor.getPrice().compareTo(bestPrice) > 0) break;
            }

            LinkedList<RestingOrder> queue = bestLevel.getValue();

            while (aggressor.getRemainingQty() > 0 && !queue.isEmpty()) {
                RestingOrder passive = queue.peek();
                int fillQty = Math.min(aggressor.getRemainingQty(), passive.getRemainingQty());
                BigDecimal fillPrice = passive.getPrice();

                aggressor.applyFill(fillQty, fillPrice);
                passive.applyFill(fillQty, fillPrice);

                // UUID-based trade ID to prevent collisions
                String tradeId = "TRD-" + java.util.UUID.randomUUID().toString().substring(0, 16).toUpperCase();
                String buyOrderId  = (aggressor.getSide() == OrderSide.BUY) ? aggressor.getOrderId() : passive.getOrderId();
                String sellOrderId = (aggressor.getSide() == OrderSide.SELL) ? aggressor.getOrderId() : passive.getOrderId();
                String buyClientId  = (aggressor.getSide() == OrderSide.BUY) ? aggressor.getClientId() : passive.getClientId();
                String sellClientId = (aggressor.getSide() == OrderSide.SELL) ? aggressor.getClientId() : passive.getClientId();

                Trade trade = new Trade(tradeId, buyOrderId, sellOrderId, buyClientId, sellClientId,
                    symbol, aggressor.getSide(), fillPrice, fillQty, Instant.now());
                trades.add(trade);

                log.info("FILL {} {} {} qty={} @ {} | buyer={} seller={}",
                    tradeId, symbol, aggressor.getSide(), fillQty, fillPrice, buyOrderId, sellOrderId);

                if (passive.isFilled()) {
                    queue.poll();
                    orderIndex.remove(passive.getOrderId());
                    orderUpdates.add(buildOrderUpdate(passive));
                } else {
                    // Emit partial fill update for passive order
                    orderUpdates.add(buildOrderUpdate(passive));
                }
            }

            if (queue.isEmpty()) {
                oppositeSide.pollFirstEntry();
            }
        }

        // ── Time-in-Force handling for unfilled remainder ───────────────
        if (aggressor.getRemainingQty() > 0) {
            switch (aggressor.getTimeInForce()) {
                case IOC -> {
                    log.info("IOC order {} cancelled remaining qty={}", aggressor.getOrderId(), aggressor.getRemainingQty());
                    orderUpdates.add(buildCancelledUpdate(aggressor, "IOC: remaining cancelled"));
                }
                case FOK -> {
                    // Should never reach here due to pre-check, but safety net
                    log.warn("FOK order {} had remaining qty after match — this shouldn't happen", aggressor.getOrderId());
                    orderUpdates.add(buildCancelledUpdate(aggressor, "FOK: incomplete fill"));
                }
                case DAY -> {
                    if (aggressor.getType() == OrderType.LIMIT) {
                        addToBook(aggressor);
                        log.info("Order {} resting on {} book @ {}, remaining qty={}",
                            aggressor.getOrderId(), aggressor.getSide(), aggressor.getPrice(), aggressor.getRemainingQty());
                    } else {
                        // MARKET orders that didn't fully fill with DAY TIF get cancelled
                        orderUpdates.add(buildCancelledUpdate(aggressor, "MARKET order: no more liquidity"));
                    }
                }
            }
        }

        orderUpdates.add(buildOrderUpdate(aggressor));
        return new MatchResult(trades, orderUpdates, buildSnapshot());
    }

    // ── Order cancellation ──────────────────────────────────────────────

    public Order cancelOrder(String orderId) {
        RestingOrder order = orderIndex.remove(orderId);
        if (order == null) {
            log.warn("Cancel failed: order {} not found on book", orderId);
            return null;
        }

        TreeMap<BigDecimal, LinkedList<RestingOrder>> side =
            (order.getSide() == OrderSide.BUY) ? bids : asks;
        LinkedList<RestingOrder> queue = side.get(order.getPrice());
        if (queue != null) {
            queue.remove(order);
            if (queue.isEmpty()) side.remove(order.getPrice());
        }

        log.info("Order {} cancelled, was resting at {} with qty={}", orderId, order.getPrice(), order.getRemainingQty());
        return buildCancelledUpdate(order, "User cancelled");
    }

    // ── Order amendment (price or qty change) ───────────────────────────

    public MatchResult amendOrder(String orderId, BigDecimal newPrice, int newQty) {
        RestingOrder existing = orderIndex.get(orderId);
        if (existing == null) {
            log.warn("Amend failed: order {} not found on book", orderId);
            return null;
        }

        // Cancel existing
        cancelOrder(orderId);

        // Resubmit as new order with amended values
        BigDecimal price = (newPrice != null) ? newPrice : existing.getPrice();
        int qty = (newQty > 0) ? newQty : existing.getRemainingQty();

        Order amended = new Order(existing.getOrderId(), existing.getClientId(), existing.getSymbol(),
            existing.getSide(), existing.getType(), qty, price, Instant.now(),
            existing.getTimeInForce(), OrderStatus.ACCEPTED, null, 0, null);

        log.info("Order {} amended: price {} -> {}, qty {} -> {}",
            orderId, existing.getPrice(), price, existing.getRemainingQty(), qty);

        return processOrder(amended);
    }

    // ── FOK liquidity check ─────────────────────────────────────────────

    private int computeAvailableLiquidity(TreeMap<BigDecimal, LinkedList<RestingOrder>> side, RestingOrder aggressor) {
        int available = 0;
        for (var entry : side.entrySet()) {
            BigDecimal levelPrice = entry.getKey();
            // Check price crossing for LIMIT orders
            if (aggressor.getType() == OrderType.LIMIT) {
                if (aggressor.getSide() == OrderSide.BUY && aggressor.getPrice().compareTo(levelPrice) < 0) break;
                if (aggressor.getSide() == OrderSide.SELL && aggressor.getPrice().compareTo(levelPrice) > 0) break;
            }
            for (RestingOrder ro : entry.getValue()) {
                available += ro.getRemainingQty();
            }
            if (available >= aggressor.getOriginalQty()) return available;
        }
        return available;
    }

    private void addToBook(RestingOrder order) {
        TreeMap<BigDecimal, LinkedList<RestingOrder>> side =
            (order.getSide() == OrderSide.BUY) ? bids : asks;
        side.computeIfAbsent(order.getPrice(), k -> new LinkedList<>()).addLast(order);
        orderIndex.put(order.getOrderId(), order);
    }

    private Order buildOrderUpdate(RestingOrder ro) {
        OrderStatus status;
        if (ro.isFilled()) status = OrderStatus.FILLED;
        else if (ro.getFilledQty() > 0) status = OrderStatus.PARTIALLY_FILLED;
        else status = OrderStatus.ACCEPTED;

        return new Order(ro.getOrderId(), ro.getClientId(), ro.getSymbol(), ro.getSide(),
            ro.getType(), ro.getOriginalQty(), ro.getPrice(), ro.getTs(),
            ro.getTimeInForce(), status, null, ro.getFilledQty(), ro.getAvgFillPrice());
    }

    private Order buildCancelledUpdate(RestingOrder ro, String reason) {
        return new Order(ro.getOrderId(), ro.getClientId(), ro.getSymbol(), ro.getSide(),
            ro.getType(), ro.getOriginalQty(), ro.getPrice(), ro.getTs(),
            ro.getTimeInForce(), OrderStatus.CANCELLED, reason, ro.getFilledQty(), ro.getAvgFillPrice());
    }

    public OrderBookSnapshot buildSnapshot() {
        List<OrderBookSnapshot.PriceLevel> bidLevels = new ArrayList<>();
        for (var entry : bids.entrySet()) {
            int totalQty = entry.getValue().stream().mapToInt(RestingOrder::getRemainingQty).sum();
            bidLevels.add(new OrderBookSnapshot.PriceLevel(entry.getKey(), totalQty, entry.getValue().size()));
            if (bidLevels.size() >= 20) break;
        }
        List<OrderBookSnapshot.PriceLevel> askLevels = new ArrayList<>();
        for (var entry : asks.entrySet()) {
            int totalQty = entry.getValue().stream().mapToInt(RestingOrder::getRemainingQty).sum();
            askLevels.add(new OrderBookSnapshot.PriceLevel(entry.getKey(), totalQty, entry.getValue().size()));
            if (askLevels.size() >= 20) break;
        }
        return new OrderBookSnapshot(symbol, bidLevels, askLevels, Instant.now());
    }

    public boolean hasOrder(String orderId) { return orderIndex.containsKey(orderId); }
    public int getBidDepth() { return bids.values().stream().mapToInt(LinkedList::size).sum(); }
    public int getAskDepth() { return asks.values().stream().mapToInt(LinkedList::size).sum(); }
    public int getTotalOrders() { return orderIndex.size(); }
}
