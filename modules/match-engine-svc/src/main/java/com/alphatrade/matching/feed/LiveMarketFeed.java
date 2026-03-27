package com.alphatrade.matching.feed;

import com.alphatrade.common.kafka.Topics;
import com.alphatrade.common.model.Order;
import com.alphatrade.common.model.OrderSide;
import com.alphatrade.common.model.OrderStatus;
import com.alphatrade.common.model.OrderType;
import com.alphatrade.common.model.TimeInForce;
import com.alphatrade.common.model.Trade;
import com.alphatrade.common.serde.JsonSerde;
import com.alphatrade.matching.engine.MatchResult;
import com.alphatrade.matching.engine.MatchingEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * Generates a moving synthetic market so the matching engine always has
 * realistic depth without depending on any external broker bridge.
 */
@Component
public class LiveMarketFeed {

    private static final Logger log = LoggerFactory.getLogger(LiveMarketFeed.class);

    private static final Map<String, Double> SEED_PRICES = Map.of(
        "AAPL", 198.50,
        "MSFT", 425.80,
        "GOOGL", 176.30,
        "AMZN", 192.40,
        "TSLA", 255.70,
        "NVDA", 885.20
    );

    private final MatchingEngine engine;
    private final KafkaTemplate<String, String> kafka;
    private final boolean enabled;
    private final Set<String> activeSymbols = new LinkedHashSet<>(SEED_PRICES.keySet());
    private final Map<String, BigDecimal> lastPrices = new HashMap<>();
    private final Map<String, List<String>> syntheticOrderIdsBySymbol = new HashMap<>();
    private final Random rng = new Random();

    public LiveMarketFeed(
            MatchingEngine engine,
            KafkaTemplate<String, String> kafka,
            @Value("${livefeed.enabled:true}") boolean enabled) {
        this.engine = engine;
        this.kafka = kafka;
        this.enabled = enabled;
    }

    @Scheduled(fixedDelay = 5000, initialDelay = 10000)
    public void pollAndSeed() {
        if (!enabled) {
            return;
        }

        try {
            for (String symbol : activeSymbols) {
                double refPrice = nextReferencePrice(symbol);
                lastPrices.put(symbol, BigDecimal.valueOf(refPrice));

                double spread = Math.max(refPrice * 0.0006, 0.02);
                double bid = refPrice - (spread / 2.0);
                double ask = refPrice + (spread / 2.0);
                seedOrderBook(symbol, refPrice, bid, ask);
            }
        } catch (Exception e) {
            log.trace("Synthetic live feed update failed: {}", e.getMessage());
        }
    }

    private void seedOrderBook(String symbol, double refPrice, double bid, double ask) {
        double safeBid = bid > 0 ? bid : refPrice - 0.01;
        double safeAsk = ask > 0 ? ask : refPrice + 0.01;
        double spread = safeAsk - safeBid;
        double tickSize = Math.max(spread / 5.0, 0.01);

        clearSyntheticOrders(symbol);
        List<String> syntheticIds = new ArrayList<>(10);

        for (int i = 0; i < 5; i++) {
            double price = safeBid - (i * tickSize);
            int qty = 50 + rng.nextInt(300);
            String orderId = "SYN-B-" + symbol + "-" + i + "-" + System.currentTimeMillis();

            Order syntheticBid = new Order(
                orderId,
                "MARKET_MAKER",
                symbol,
                OrderSide.BUY,
                OrderType.LIMIT,
                qty,
                BigDecimal.valueOf(price).setScale(2, RoundingMode.HALF_UP),
                Instant.now(),
                TimeInForce.DAY,
                OrderStatus.ACCEPTED,
                null,
                0,
                null
            );

            publishSyntheticResult(engine.match(syntheticBid));
            syntheticIds.add(orderId);
        }

        for (int i = 0; i < 5; i++) {
            double price = safeAsk + (i * tickSize);
            int qty = 50 + rng.nextInt(300);
            String orderId = "SYN-A-" + symbol + "-" + i + "-" + System.currentTimeMillis();

            Order syntheticAsk = new Order(
                orderId,
                "MARKET_MAKER",
                symbol,
                OrderSide.SELL,
                OrderType.LIMIT,
                qty,
                BigDecimal.valueOf(price).setScale(2, RoundingMode.HALF_UP),
                Instant.now(),
                TimeInForce.DAY,
                OrderStatus.ACCEPTED,
                null,
                0,
                null
            );

            publishSyntheticResult(engine.match(syntheticAsk));
            syntheticIds.add(orderId);
        }

        syntheticOrderIdsBySymbol.put(symbol, syntheticIds);

        var book = engine.getBook(symbol);
        synchronized (book) {
            var snapshot = book.buildSnapshot();
            kafka.send(Topics.BOOK_SNAPSHOTS, symbol, JsonSerde.serialize(snapshot));
        }

        log.debug("Seeded {} synthetic book: bid={} ask={} ref={}", symbol, safeBid, safeAsk, refPrice);
    }

    private void publishSyntheticResult(MatchResult result) {
        if (result == null) {
            return;
        }
        for (Trade trade : result.trades()) {
            kafka.send(Topics.TRADES_FILLS, trade.symbol(), JsonSerde.serialize(trade));
        }
        for (Order update : result.orderUpdates()) {
            if (!"MARKET_MAKER".equals(update.clientId())) {
                kafka.send(Topics.ORDERS_UPDATES, update.orderId(), JsonSerde.serialize(update));
            }
        }
    }

    private void clearSyntheticOrders(String symbol) {
        List<String> existing = syntheticOrderIdsBySymbol.remove(symbol);
        if (existing == null) {
            return;
        }
        for (String orderId : existing) {
            try {
                engine.cancelOrder(symbol, orderId);
            } catch (Exception e) {
                log.trace("Synthetic order cleanup failed for {} {}: {}", symbol, orderId, e.getMessage());
            }
        }
    }

    private double nextReferencePrice(String symbol) {
        double last = lastPrices
            .getOrDefault(symbol, BigDecimal.valueOf(SEED_PRICES.getOrDefault(symbol, 100.0)))
            .doubleValue();
        double volatility = Math.max(last * 0.003, 0.05);
        double drift = (rng.nextDouble() - 0.497) * volatility;
        return Math.max(last + drift, 1.0);
    }

    public BigDecimal getLastPrice(String symbol) {
        return lastPrices.get(symbol);
    }

    public void addSymbol(String symbol) {
        activeSymbols.add(symbol.toUpperCase());
    }

    public void removeSymbol(String symbol) {
        activeSymbols.remove(symbol.toUpperCase());
    }

    public Set<String> getActiveSymbols() {
        return Collections.unmodifiableSet(activeSymbols);
    }
}
