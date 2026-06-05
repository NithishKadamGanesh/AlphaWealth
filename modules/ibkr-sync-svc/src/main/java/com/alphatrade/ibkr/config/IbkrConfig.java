package com.alphatrade.ibkr.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Data
@Configuration
@ConfigurationProperties(prefix = "ibkr")
public class IbkrConfig {
    private String cpGatewayUrl = "https://host.docker.internal:5001";
    private String publicLoginUrl = "https://localhost:5001";
    private int syncIntervalSeconds = 30;
    private int requestTimeoutSeconds = 10;
    private int statusRefreshSeconds = 8;
}
