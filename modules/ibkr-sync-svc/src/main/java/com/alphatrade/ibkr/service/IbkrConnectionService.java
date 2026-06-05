package com.alphatrade.ibkr.service;

import com.alphatrade.ibkr.config.IbkrConfig;
import com.alphatrade.ibkr.model.AccountSummary;
import com.alphatrade.ibkr.model.ConnectionState;
import com.alphatrade.ibkr.model.IbkrPosition;
import com.alphatrade.ibkr.model.Snapshot;
import com.fasterxml.jackson.databind.JsonNode;
import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;
import io.netty.handler.ssl.util.InsecureTrustManagerFactory;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.netty.http.client.HttpClient;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

@Slf4j
@Service
@RequiredArgsConstructor
public class IbkrConnectionService {

    private final IbkrConfig config;
    private final PositionPublisher positionPublisher;
    private final SnapshotStore snapshotStore;

    private WebClient client;
    private final AtomicReference<ConnectionState> state = new AtomicReference<>(ConnectionState.DISCONNECTED);
    private final Map<String, IbkrPosition> positions = new ConcurrentHashMap<>();
    private final Map<String, AccountSummary> accountSummaries = new ConcurrentHashMap<>();
    private final Object syncMonitor = new Object();
    private volatile String primaryAccountId = null;
    private volatile Instant lastSyncAt = null;
    private volatile Instant lastStatusCheckAt = null;
    private volatile String lastError = null;
    private volatile boolean gatewayReachable = false;
    private volatile boolean syncInProgress = false;

    @PostConstruct
    public void init() {
        log.info("IBKR Client Portal mode — gateway: {}", config.getCpGatewayUrl());
        buildClient();
        restoreSnapshot();
    }

    private void buildClient() {
        try {
            SslContext sslContext = SslContextBuilder.forClient()
                    .trustManager(InsecureTrustManagerFactory.INSTANCE)
                    .build();
            HttpClient httpClient = HttpClient.create()
                    .followRedirect(true)
                    .responseTimeout(Duration.ofSeconds(config.getRequestTimeoutSeconds()))
                    .secure(t -> t.sslContext(sslContext));
            client = WebClient.builder()
                    .baseUrl(config.getCpGatewayUrl())
                    .clientConnector(new ReactorClientHttpConnector(httpClient))
                    .build();
        } catch (Exception e) {
            log.error("Failed to create WebClient", e);
        }
    }

    private void restoreSnapshot() {
        Snapshot snap = snapshotStore.load();
        if (snap == null) return;
        primaryAccountId = snap.getPrimaryAccountId();
        lastSyncAt = snap.getLastSyncAt();
        if (snap.getPositions() != null) {
            for (IbkrPosition p : snap.getPositions()) positions.put(p.getSymbol(), p);
        }
        if (snap.getAccountSummaries() != null) accountSummaries.putAll(snap.getAccountSummaries());
        log.info("Restored snapshot: {} positions, lastSyncAt={}", positions.size(), lastSyncAt);
    }

    private void persistSnapshot() {
        Snapshot snap = Snapshot.builder()
                .primaryAccountId(primaryAccountId)
                .lastSyncAt(lastSyncAt)
                .positions(new ArrayList<>(positions.values()))
                .accountSummaries(new java.util.HashMap<>(accountSummaries))
                .build();
        snapshotStore.save(snap);
    }

    // Called by scheduler every 60s to keep the CP session alive
    public void tickle() {
        synchronized (syncMonitor) {
            if (client == null || !gatewayReachable || syncInProgress) return;
            try {
                postJson("/v1/api/tickle");
                log.debug("Tickle ok");
            } catch (Exception e) {
                log.debug("Tickle failed: {}", rootCauseMessage(e));
            }
        }
    }

    public void checkAuthAndSync() {
        syncNow();
    }

    public void refreshStatusIfStale() {
        Instant checkedAt = lastStatusCheckAt;
        if (syncInProgress) return;
        if (checkedAt == null || Duration.between(checkedAt, Instant.now()).getSeconds() >= Math.max(3, config.getStatusRefreshSeconds())) {
            refreshConnectionState();
        }
    }

    public void refreshConnectionState() {
        synchronized (syncMonitor) {
            if (client == null || syncInProgress) return;
            lastStatusCheckAt = Instant.now();
            try {
                SessionProbe session = probeSession();
                if (session.authorized()) {
                    gatewayReachable = true;
                    lastError = null;
                    state.set(ConnectionState.CONNECTED);
                    if (session.primaryAccountId() != null) {
                        primaryAccountId = session.primaryAccountId();
                    }
                } else {
                    gatewayReachable = true;
                    state.set(ConnectionState.AUTH_REQUIRED);
                    lastError = "Login required in IBKR Client Portal gateway";
                }
            } catch (WebClientResponseException e) {
                handleGatewayResponseError(e, false);
            } catch (Exception e) {
                transitionToGatewayFailure("Gateway unreachable: " + rootCauseMessage(e));
            }
        }
    }

    public void syncNow() {
        synchronized (syncMonitor) {
            if (client == null || syncInProgress) return;
            syncInProgress = true;
            state.set(ConnectionState.SYNCING);
            lastStatusCheckAt = Instant.now();
            try {
                SessionProbe session = probeSession();
                if (!session.authorized()) {
                    gatewayReachable = true;
                    state.set(ConnectionState.AUTH_REQUIRED);
                    lastError = "Login required in IBKR Client Portal gateway";
                    return;
                }

                String accountId = session.primaryAccountId();
                if (accountId == null || accountId.isBlank()) {
                    accountId = fetchPrimaryAccountId();
                }
                if (accountId == null || accountId.isBlank()) {
                    gatewayReachable = true;
                    state.set(ConnectionState.LAST_SYNC_FAILED);
                    lastError = "No accounts returned from IBKR";
                    return;
                }

                List<IbkrPosition> latestPositions = fetchPositionsForAccount(accountId);
                AccountSummary summary = fetchAccountSummaryForAccount(accountId);

                positions.clear();
                for (IbkrPosition position : latestPositions) {
                    positions.put(position.getSymbol(), position);
                    positionPublisher.publishPosition(position);
                }

                accountSummaries.clear();
                if (summary != null) {
                    accountSummaries.put(accountId, summary);
                    positionPublisher.publishAccountSummary(summary);
                }

                primaryAccountId = accountId;
                lastSyncAt = Instant.now();
                gatewayReachable = true;
                lastError = null;
                state.set(ConnectionState.CONNECTED);
                persistSnapshot();
                log.info("Synced {} positions from IBKR (account={})", positions.size(), accountId);
            } catch (WebClientResponseException e) {
                handleGatewayResponseError(e, true);
            } catch (Exception e) {
                transitionToGatewayFailure("Gateway unreachable: " + rootCauseMessage(e));
            } finally {
                syncInProgress = false;
                lastStatusCheckAt = Instant.now();
            }
        }
    }

    private BigDecimal decimal(JsonNode root, String key) {
        try {
            String val = root.path(key).path("amount").asText("0");
            return new BigDecimal(val);
        } catch (Exception e) {
            return BigDecimal.ZERO;
        }
    }

    public void disconnect() {
        synchronized (syncMonitor) {
            state.set(ConnectionState.DISCONNECTED);
            positions.clear();
            accountSummaries.clear();
            primaryAccountId = null;
            lastSyncAt = null;
            lastStatusCheckAt = Instant.now();
            lastError = null;
            gatewayReachable = false;
            syncInProgress = false;
            persistSnapshot();
            log.info("IBKR connection cleared");
        }
    }

    public ConnectionState getState() { return state.get(); }
    public boolean isConnected() {
        ConnectionState s = state.get();
        return s == ConnectionState.CONNECTED || s == ConnectionState.SYNCING;
    }
    public Map<String, IbkrPosition> getPositions() { return positions; }
    public Map<String, AccountSummary> getAccountSummaries() { return accountSummaries; }
    public String getPrimaryAccountId() { return primaryAccountId; }
    public Instant getLastSyncAt() { return lastSyncAt; }
    public Instant getLastStatusCheckAt() { return lastStatusCheckAt; }
    public String getLastError() { return lastError; }
    public boolean isGatewayReachable() { return gatewayReachable; }
    public boolean isSyncInProgress() { return syncInProgress; }
    public boolean hasSnapshot() { return !positions.isEmpty() || lastSyncAt != null || !accountSummaries.isEmpty(); }

    private SessionProbe probeSession() {
        JsonNode status = postJson("/v1/api/iserver/auth/status");
        gatewayReachable = true;
        boolean authorized = status.path("authenticated").asBoolean(false)
                || status.path("connected").asBoolean(false)
                || status.path("established").asBoolean(false);
        if (authorized) {
            return new SessionProbe(true, null);
        }

        try {
            String accountId = fetchPrimaryAccountId();
            if (accountId != null && !accountId.isBlank()) {
                log.info("IBKR auth status reported unauthenticated, but account access succeeded; treating session as authorized (account={})", accountId);
                return new SessionProbe(true, accountId);
            }
        } catch (WebClientResponseException e) {
            log.debug("IBKR account probe failed with HTTP {} while auth status was unauthenticated", e.getStatusCode().value());
        } catch (Exception e) {
            log.debug("IBKR account probe failed while auth status was unauthenticated: {}", rootCauseMessage(e));
        }

        return new SessionProbe(false, null);
    }

    private String fetchPrimaryAccountId() {
        JsonNode accounts = getJson("/v1/api/portfolio/accounts");
        if (!accounts.isArray() || accounts.isEmpty()) return null;
        JsonNode first = accounts.get(0);
        String id = first.path("id").asText(first.path("accountId").asText(first.path("acctId").asText("")));
        return id.isBlank() ? null : id;
    }

    private List<IbkrPosition> fetchPositionsForAccount(String accountId) {
        JsonNode data = getJson("/v1/api/portfolio/{id}/positions/0", accountId);
        List<IbkrPosition> latest = new ArrayList<>();
        if (!data.isArray()) return latest;

        Instant now = Instant.now();
        for (JsonNode p : data) {
            String symbol = p.path("contractDesc").asText(
                    p.path("ticker").asText("UNKNOWN"));
            latest.add(IbkrPosition.builder()
                    .account(accountId)
                    .symbol(symbol)
                    .secType(p.path("assetClass").asText("STK"))
                    .currency(p.path("currency").asText("USD"))
                    .exchange("")
                    .position(BigDecimal.valueOf(p.path("position").asDouble()))
                    .avgCost(BigDecimal.valueOf(p.path("avgCost").asDouble()))
                    .marketPrice(BigDecimal.valueOf(p.path("mktPrice").asDouble()))
                    .marketValue(BigDecimal.valueOf(p.path("mktValue").asDouble()))
                    .unrealizedPnl(BigDecimal.valueOf(p.path("unrealizedPnl").asDouble()))
                    .realizedPnl(BigDecimal.valueOf(p.path("realizedPnl").asDouble()))
                    .timestamp(now)
                    .build());
        }
        return latest;
    }

    private AccountSummary fetchAccountSummaryForAccount(String accountId) {
        try {
            JsonNode data = getJson("/v1/api/portfolio/{id}/summary", accountId);
            AccountSummary summary = AccountSummary.builder()
                    .account(accountId)
                    .currency("USD")
                    .timestamp(Instant.now())
                    .build();
            summary.setNetLiquidation(decimal(data, "netliquidation"));
            summary.setTotalCash(decimal(data, "totalcashvalue"));
            summary.setBuyingPower(decimal(data, "buyingpower"));
            summary.setGrossPositionValue(decimal(data, "grosspositionvalue"));
            summary.setInitMarginReq(decimal(data, "initmarginreq"));
            summary.setMaintMarginReq(decimal(data, "maintmarginreq"));
            summary.setAvailableFunds(decimal(data, "availablefunds"));
            summary.setExcessLiquidity(decimal(data, "excessliquidity"));
            return summary;
        } catch (Exception e) {
            log.warn("Account summary fetch failed for {}: {}", accountId, rootCauseMessage(e));
            return null;
        }
    }

    private JsonNode getJson(String uri, Object... uriVars) {
        return client.get()
                .uri(uri, uriVars)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .block(Duration.ofSeconds(config.getRequestTimeoutSeconds()));
    }

    private JsonNode postJson(String uri) {
        return client.post()
                .uri(uri)
                .header("Content-Length", "0")
                .retrieve()
                .bodyToMono(JsonNode.class)
                .block(Duration.ofSeconds(config.getRequestTimeoutSeconds()));
    }

    private record SessionProbe(boolean authorized, String primaryAccountId) {}

    private void handleGatewayResponseError(WebClientResponseException e, boolean duringSync) {
        gatewayReachable = true;
        if (e.getStatusCode().value() == 401) {
            state.set(ConnectionState.AUTH_REQUIRED);
            lastError = "Login required in IBKR Client Portal gateway";
            return;
        }

        lastError = "IBKR gateway error: HTTP " + e.getStatusCode().value();
        state.set(duringSync ? ConnectionState.LAST_SYNC_FAILED : ConnectionState.DEGRADED);
    }

    private void transitionToGatewayFailure(String message) {
        gatewayReachable = false;
        lastError = message;
        state.set(hasSnapshot() ? ConnectionState.DEGRADED : ConnectionState.DISCONNECTED);
    }

    private String rootCauseMessage(Throwable error) {
        Throwable current = error;
        while (current.getCause() != null) current = current.getCause();
        String message = current.getMessage();
        return (message == null || message.isBlank()) ? current.getClass().getSimpleName() : message;
    }
}
