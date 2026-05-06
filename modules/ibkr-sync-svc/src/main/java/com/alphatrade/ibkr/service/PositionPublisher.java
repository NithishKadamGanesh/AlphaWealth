package com.alphatrade.ibkr.service;

import com.alphatrade.ibkr.model.AccountSummary;
import com.alphatrade.ibkr.model.IbkrPosition;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class PositionPublisher {
    private static final String TOPIC_POSITIONS = "ibkr.positions";
    private static final String TOPIC_ACCOUNT = "ibkr.account";

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    public void publishPosition(IbkrPosition position) {
        try {
            String json = objectMapper.writeValueAsString(position);
            kafkaTemplate.send(TOPIC_POSITIONS, position.getSymbol(), json);
        } catch (Exception e) {
            log.error("Failed to publish position", e);
        }
    }

    public void publishAccountSummary(AccountSummary summary) {
        try {
            String json = objectMapper.writeValueAsString(summary);
            kafkaTemplate.send(TOPIC_ACCOUNT, summary.getAccount(), json);
            log.info("Published account summary: NAV={} cash={}",
                    summary.getNetLiquidation(), summary.getTotalCash());
        } catch (Exception e) {
            log.error("Failed to publish account summary", e);
        }
    }
}
