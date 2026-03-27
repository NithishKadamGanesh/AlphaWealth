package com.alphatrade.apigw.websocket;

import com.alphatrade.common.kafka.Topics;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Bridges Kafka topics → WebSocket clients.
 * The UI connects to ws://host:8085/ws/trades and receives a real-time
 * JSON stream of trades, order updates, and book snapshots.
 */
@Component
public class TradeFeedHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(TradeFeedHandler.class);
    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
        log.info("WebSocket client connected: {} (total={})", session.getId(), sessions.size());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
        log.info("WebSocket client disconnected: {} (total={})", session.getId(), sessions.size());
    }

    @KafkaListener(topics = Topics.TRADES_FILLS, groupId = "api-gw-trades-ws")
    public void onTrade(String message) {
        broadcast("{\"type\":\"TRADE\"," + "\"data\":" + message + "}");
    }

    @KafkaListener(topics = Topics.ORDERS_UPDATES, groupId = "api-gw-orders-ws")
    public void onOrderUpdate(String message) {
        broadcast("{\"type\":\"ORDER_UPDATE\"," + "\"data\":" + message + "}");
    }

    @KafkaListener(topics = Topics.BOOK_SNAPSHOTS, groupId = "api-gw-book-ws")
    public void onBookSnapshot(String message) {
        broadcast("{\"type\":\"BOOK_SNAPSHOT\"," + "\"data\":" + message + "}");
    }

    private void broadcast(String json) {
        TextMessage msg = new TextMessage(json);
        for (WebSocketSession session : sessions) {
            if (session.isOpen()) {
                try {
                    synchronized (session) {
                        session.sendMessage(msg);
                    }
                } catch (IOException e) {
                    log.warn("Failed to send to session {}: {}", session.getId(), e.getMessage());
                    sessions.remove(session);
                }
            }
        }
    }
}
