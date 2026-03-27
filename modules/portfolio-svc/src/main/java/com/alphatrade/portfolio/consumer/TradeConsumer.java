package com.alphatrade.portfolio.consumer;

import com.alphatrade.common.kafka.Topics;
import com.alphatrade.common.model.Trade;
import com.alphatrade.common.serde.JsonSerde;
import com.alphatrade.portfolio.service.PortfolioService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class TradeConsumer {

    private static final Logger log = LoggerFactory.getLogger(TradeConsumer.class);
    private final PortfolioService portfolioService;

    public TradeConsumer(PortfolioService portfolioService) {
        this.portfolioService = portfolioService;
    }

    @KafkaListener(topics = Topics.TRADES_FILLS, groupId = "portfolio-svc")
    public void onTrade(String message) {
        try {
            Trade trade = JsonSerde.deserialize(message, Trade.class);
            log.info("Portfolio consuming trade {} for {}", trade.tradeId(), trade.symbol());
            portfolioService.processTrade(trade);
        } catch (Exception e) {
            log.error("Failed to process trade: {}", e.getMessage(), e);
        }
    }
}
