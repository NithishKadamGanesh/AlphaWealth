package com.alphatrade.gateway.service;

import com.alphatrade.common.kafka.Topics;
import com.alphatrade.common.model.*;
import com.alphatrade.common.serde.JsonSerde;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.UUID;

@Service
public class OrderPublisher {

    private static final Logger log = LoggerFactory.getLogger(OrderPublisher.class);
    private final KafkaTemplate<String, String> kafka;

    public OrderPublisher(KafkaTemplate<String, String> kafka) {
        this.kafka = kafka;
    }

    /**
     * Stamps the incoming request with an orderId and timestamp,
     * then fires it onto orders.raw keyed by orderId for partition affinity.
     */
    public OrderResponse submit(OrderRequest req) {
        String orderId = "ORD-" + UUID.randomUUID().toString().substring(0, 12).toUpperCase();
        Instant now = Instant.now();

        Order order = new Order(
            orderId,
            req.clientId(),
            req.symbol(),
            req.side(),
            req.type(),
            req.qty(),
            req.price(),
            now,
            req.timeInForce() != null ? req.timeInForce() : TimeInForce.DAY,
            OrderStatus.NEW,
            null,
            0,
            null
        );

        String json = JsonSerde.serialize(order);
        kafka.send(Topics.ORDERS_RAW, orderId, json)
             .whenComplete((result, ex) -> {
                 if (ex != null) {
                     log.error("Failed to publish order {}: {}", orderId, ex.getMessage());
                 } else {
                     log.info("Published order {} to {} partition {}",
                         orderId, Topics.ORDERS_RAW,
                         result.getRecordMetadata().partition());
                 }
             });

        return new OrderResponse(orderId, OrderStatus.NEW, now, "Order accepted for processing");
    }
}
