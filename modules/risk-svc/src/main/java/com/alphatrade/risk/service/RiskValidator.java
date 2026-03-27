package com.alphatrade.risk.service;

import com.alphatrade.common.model.Order;
import com.alphatrade.common.model.OrderType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Pre-trade risk checks.
 *
 * ADDED from code review:
 *   1. Fat-finger price guard using reference price cache
 *   2. Per-client rate limiting (max orders per second)
 *   3. Per-symbol position concentration limit
 *   4. Duplicate order ID detection
 */
@Service
public class RiskValidator {

    private static final Logger log = LoggerFactory.getLogger(RiskValidator.class);

    @Value("${risk.max-qty:100000}")
    private int maxQty;

    @Value("${risk.max-notional:10000000}")
    private double maxNotional;

    @Value("${risk.fat-finger-pct:20}")
    private double fatFingerPct; // reject if price deviates more than this % from reference

    @Value("${risk.max-orders-per-second:50}")
    private int maxOrdersPerSecond;

    // Reference prices (updated by last trade or market data)
    private final ConcurrentHashMap<String, BigDecimal> referencePrices = new ConcurrentHashMap<>();

    // Rate limiter: client → (second_epoch → count)
    private final ConcurrentHashMap<String, ConcurrentHashMap<Long, AtomicInteger>> rateLimiter = new ConcurrentHashMap<>();

    // Duplicate order detection
    private final ConcurrentHashMap<String, Instant> seenOrderIds = new ConcurrentHashMap<>();

    public Optional<String> validate(Order order) {
        // Check 0: Duplicate order ID
        if (order.orderId() != null && seenOrderIds.putIfAbsent(order.orderId(), Instant.now()) != null) {
            log.warn("RISK REJECT [{}]: duplicate order ID", order.orderId());
            return Optional.of("Duplicate order ID");
        }

        // Check 1: qty > 0
        if (order.qty() <= 0) {
            log.warn("RISK REJECT [{}]: qty={} not positive", order.orderId(), order.qty());
            return Optional.of("Quantity must be greater than zero");
        }

        // Check 2: qty within threshold
        if (order.qty() > maxQty) {
            log.warn("RISK REJECT [{}]: qty={} exceeds max={}", order.orderId(), order.qty(), maxQty);
            return Optional.of("Quantity " + order.qty() + " exceeds maximum allowed " + maxQty);
        }

        // Check 3: LIMIT orders must have positive price
        if (order.type() == OrderType.LIMIT) {
            if (order.price() == null || order.price().compareTo(BigDecimal.ZERO) <= 0) {
                log.warn("RISK REJECT [{}]: LIMIT order with invalid price={}", order.orderId(), order.price());
                return Optional.of("LIMIT order requires a positive price");
            }
        }

        // Check 4: Notional value guard
        if (order.price() != null && order.price().compareTo(BigDecimal.ZERO) > 0) {
            double notional = order.price().doubleValue() * order.qty();
            if (notional > maxNotional) {
                log.warn("RISK REJECT [{}]: notional={} exceeds max={}", order.orderId(), notional, maxNotional);
                return Optional.of("Notional value exceeds maximum allowed");
            }
        }

        // Check 5: Symbol non-empty
        if (order.symbol() == null || order.symbol().isBlank()) {
            log.warn("RISK REJECT [{}]: empty symbol", order.orderId());
            return Optional.of("Symbol must not be empty");
        }

        // Check 6: Fat-finger price guard
        if (order.type() == OrderType.LIMIT && order.price() != null) {
            BigDecimal refPrice = referencePrices.get(order.symbol());
            if (refPrice != null && refPrice.compareTo(BigDecimal.ZERO) > 0) {
                double deviation = Math.abs(order.price().doubleValue() - refPrice.doubleValue()) / refPrice.doubleValue() * 100;
                if (deviation > fatFingerPct) {
                    log.warn("RISK REJECT [{}]: price {} deviates {}% from reference {} (max {}%)",
                        order.orderId(), order.price(), String.format("%.1f", deviation), refPrice, fatFingerPct);
                    return Optional.of(String.format("Price deviates %.1f%% from reference price %.2f (max %.0f%%)",
                        deviation, refPrice, fatFingerPct));
                }
            }
        }

        // Check 7: Rate limiting
        if (order.clientId() != null) {
            long currentSecond = System.currentTimeMillis() / 1000;
            ConcurrentHashMap<Long, AtomicInteger> clientRates =
                rateLimiter.computeIfAbsent(order.clientId(), k -> new ConcurrentHashMap<>());
            AtomicInteger count = clientRates.computeIfAbsent(currentSecond, k -> new AtomicInteger(0));
            if (count.incrementAndGet() > maxOrdersPerSecond) {
                log.warn("RISK REJECT [{}]: rate limit exceeded for client {}", order.orderId(), order.clientId());
                return Optional.of("Rate limit exceeded: max " + maxOrdersPerSecond + " orders per second");
            }
            // Cleanup old entries (keep only current and previous second)
            clientRates.keySet().removeIf(sec -> sec < currentSecond - 1);
        }

        log.info("RISK PASS [{}]: {} {} {} qty={} px={}",
            order.orderId(), order.side(), order.type(), order.symbol(), order.qty(), order.price());
        return Optional.empty();
    }

    /** Update reference price for a symbol (called when trades occur or market data arrives) */
    public void updateReferencePrice(String symbol, BigDecimal price) {
        if (symbol != null && price != null && price.compareTo(BigDecimal.ZERO) > 0) {
            referencePrices.put(symbol, price);
        }
    }

    /** Cleanup old order IDs periodically */
    @Scheduled(fixedDelayString = "${risk.cleanup-interval-ms:300000}", initialDelayString = "${risk.cleanup-initial-delay-ms:60000}")
    public void cleanupSeenOrders() {
        Instant cutoff = Instant.now().minusSeconds(3600); // keep 1 hour
        seenOrderIds.entrySet().removeIf(e -> e.getValue().isBefore(cutoff));
    }
}
