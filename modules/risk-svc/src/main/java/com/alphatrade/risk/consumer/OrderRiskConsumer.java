package com.alphatrade.risk.consumer;

import com.alphatrade.common.kafka.Topics;
import com.alphatrade.common.model.Order;
import com.alphatrade.common.serde.JsonSerde;
import com.alphatrade.risk.service.RiskValidator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class OrderRiskConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderRiskConsumer.class);

    private final RiskValidator validator;
    private final KafkaTemplate<String, String> kafka;

    public OrderRiskConsumer(RiskValidator validator, KafkaTemplate<String, String> kafka) {
        this.validator = validator;
        this.kafka = kafka;
    }

    @KafkaListener(topics = Topics.ORDERS_RAW, groupId = "risk-svc")
    public void onOrder(String message) {
        Order order = JsonSerde.deserialize(message, Order.class);
        log.info("Risk checking order {}", order.orderId());

        Optional<String> rejection = validator.validate(order);

        if (rejection.isPresent()) {
            Order rejected = order.withReject(rejection.get());
            kafka.send(Topics.ORDERS_REJECT, order.orderId(), JsonSerde.serialize(rejected));
            kafka.send(Topics.ORDERS_UPDATES, order.orderId(), JsonSerde.serialize(rejected));
            log.info("Order {} REJECTED: {}", order.orderId(), rejection.get());
        } else {
            Order accepted = order.withStatus(com.alphatrade.common.model.OrderStatus.ACCEPTED);
            if (accepted.price() != null && accepted.price().signum() > 0) {
                validator.updateReferencePrice(accepted.symbol(), accepted.price());
            }
            kafka.send(Topics.ORDERS_VALID, order.orderId(), JsonSerde.serialize(accepted));
            kafka.send(Topics.ORDERS_UPDATES, order.orderId(), JsonSerde.serialize(accepted));
            log.info("Order {} ACCEPTED, forwarded to matching engine", order.orderId());
        }
    }
}
