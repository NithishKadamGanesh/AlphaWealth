package com.alphatrade.matching.consumer;

import com.alphatrade.common.kafka.Topics;
import com.alphatrade.common.model.Order;
import com.alphatrade.common.model.Trade;
import com.alphatrade.common.serde.JsonSerde;
import com.alphatrade.matching.engine.MatchResult;
import com.alphatrade.matching.engine.MatchingEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class MatchEngineConsumer {

    private static final Logger log = LoggerFactory.getLogger(MatchEngineConsumer.class);

    private final MatchingEngine engine;
    private final KafkaTemplate<String, String> kafka;

    public MatchEngineConsumer(MatchingEngine engine, KafkaTemplate<String, String> kafka) {
        this.engine = engine;
        this.kafka = kafka;
    }

    @KafkaListener(topics = Topics.ORDERS_VALID, groupId = "match-engine-svc")
    public void onValidOrder(String message) {
        Order order = JsonSerde.deserialize(message, Order.class);
        log.info("Matching engine received order {}", order.orderId());

        MatchResult result = engine.match(order);

        // Publish all trades
        for (Trade trade : result.trades()) {
            String tradeJson = JsonSerde.serialize(trade);
            kafka.send(Topics.TRADES_FILLS, trade.symbol(), tradeJson);
            log.info("Published trade {} for {} qty={} @ {}",
                trade.tradeId(), trade.symbol(), trade.qty(), trade.price());
        }

        // Publish order updates (status changes)
        for (Order update : result.orderUpdates()) {
            kafka.send(Topics.ORDERS_UPDATES, update.orderId(), JsonSerde.serialize(update));
        }

        // Publish book snapshot for the UI
        if (result.snapshot() != null) {
            kafka.send(Topics.BOOK_SNAPSHOTS, result.snapshot().symbol(), JsonSerde.serialize(result.snapshot()));
        }
    }
}
