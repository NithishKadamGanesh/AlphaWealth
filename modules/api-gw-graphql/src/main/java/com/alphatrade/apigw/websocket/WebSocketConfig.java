package com.alphatrade.apigw.websocket;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final TradeFeedHandler tradeFeedHandler;

    public WebSocketConfig(TradeFeedHandler tradeFeedHandler) {
        this.tradeFeedHandler = tradeFeedHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(tradeFeedHandler, "/ws/trades")
                .setAllowedOrigins("*");
    }
}
