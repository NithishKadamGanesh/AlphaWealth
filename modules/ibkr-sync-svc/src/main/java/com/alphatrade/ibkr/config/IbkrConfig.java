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

    /**
     * Whether to skip TLS certificate validation when talking to the IBKR Client Portal
     * gateway. The gateway ships with a self-signed certificate that cannot be verified
     * against the system trust store, so by default we accept it. Set to {@code false} in
     * production deployments where you have installed the gateway certificate into a
     * truststore (see {@link #trustStorePath}).
     */
    /**
     * When the brokerage session drops (5-min inactivity, a competing TWS/IBKR Mobile
     * login, etc.) but the gateway SSO session is still alive, automatically call
     * {@code /v1/api/iserver/reauthenticate} to silently reclaim it — so the user
     * rarely has to log in through the gateway again. Set false to disable.
     */
    private boolean autoReauthenticate = true;

    private boolean trustSelfSigned = true;

    /**
     * Optional path to a Java truststore (JKS/PKCS12) containing the IBKR gateway
     * certificate. When provided, this takes precedence over {@link #trustSelfSigned}.
     */
    private String trustStorePath = "";
    private String trustStorePassword = "";
    private String trustStoreType = "PKCS12";
}
