package com.alphatrade.ibkr.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Data
@Configuration
@ConfigurationProperties(prefix = "ibkr")
public class IbkrConfig {
    private String host = "host.docker.internal";
    private int port = 7497;       // 7497 = paper, 7496 = live
    private int clientId = 100;
    private String account;
    private boolean readonly = true;  // ALWAYS true
    private int syncIntervalSeconds = 30;
}
