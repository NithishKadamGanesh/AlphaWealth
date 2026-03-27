package com.alphatrade.matching.engine;

import com.alphatrade.common.model.Order;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Manages per-symbol OrderBooks. Serializes access per symbol via synchronized blocks.
 * Designed so the Kafka consume/produce contract stays identical if replaced by C++ engine.
 *
 * ADDED: cancel, amend, and book query operations.
 */
@Service
public class MatchingEngine {

    private static final Logger log = LoggerFactory.getLogger(MatchingEngine.class);
    private final ConcurrentHashMap<String, OrderBook> books = new ConcurrentHashMap<>();

    public MatchResult match(Order order) {
        OrderBook book = books.computeIfAbsent(order.symbol(), OrderBook::new);
        synchronized (book) {
            log.info("Matching order {} on book {} (bids={}, asks={})",
                order.orderId(), order.symbol(), book.getBidDepth(), book.getAskDepth());
            return book.processOrder(order);
        }
    }

    public Order cancelOrder(String symbol, String orderId) {
        OrderBook book = books.get(symbol);
        if (book == null) {
            log.warn("Cancel failed: no book for symbol {}", symbol);
            return null;
        }
        synchronized (book) {
            return book.cancelOrder(orderId);
        }
    }

    public MatchResult amendOrder(String symbol, String orderId, BigDecimal newPrice, int newQty) {
        OrderBook book = books.get(symbol);
        if (book == null) {
            log.warn("Amend failed: no book for symbol {}", symbol);
            return null;
        }
        synchronized (book) {
            return book.amendOrder(orderId, newPrice, newQty);
        }
    }

    public OrderBook getBook(String symbol) {
        return books.computeIfAbsent(symbol, OrderBook::new);
    }
}
