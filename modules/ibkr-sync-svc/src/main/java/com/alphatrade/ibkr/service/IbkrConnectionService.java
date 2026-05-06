package com.alphatrade.ibkr.service;

import com.alphatrade.ibkr.config.IbkrConfig;
import com.alphatrade.ibkr.model.AccountSummary;
import com.alphatrade.ibkr.model.IbkrPosition;
import com.ib.client.*;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Manages the TWS / IB Gateway connection.
 * Implements EWrapper to receive callbacks from IBKR.
 *
 * From inside Docker, use host.docker.internal:7497 (paper) or :7496 (live).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class IbkrConnectionService implements EWrapper {

    private final IbkrConfig config;
    private final PositionPublisher positionPublisher;

    private EClientSocket client;
    private EJavaSignal signal;
    private EReader reader;

    private final AtomicBoolean connected = new AtomicBoolean(false);
    private final Map<String, IbkrPosition> positions = new ConcurrentHashMap<>();
    private final Map<String, AccountSummary> accountSummaries = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() {
        log.info("Initializing IBKR connection: host={} port={} clientId={} readonly={}",
                config.getHost(), config.getPort(), config.getClientId(), config.isReadonly());

        if (!config.isReadonly()) {
            log.error("FATAL: IBKR service must run in READONLY mode. Set ibkr.readonly=true");
            throw new IllegalStateException("ibkr.readonly must be true");
        }

        signal = new EJavaSignal();
        client = new EClientSocket(this, signal);
        connectToTws();
    }

    private void connectToTws() {
        try {
            client.eConnect(config.getHost(), config.getPort(), config.getClientId());
            Thread.sleep(1000);

            if (client.isConnected()) {
                log.info("✓ Connected to TWS at {}:{}", config.getHost(), config.getPort());
                reader = new EReader(client, signal);
                reader.start();

                new Thread(() -> {
                    while (client.isConnected()) {
                        signal.waitForSignal();
                        try {
                            reader.processMsgs();
                        } catch (Exception e) {
                            log.error("Error processing TWS msg", e);
                        }
                    }
                }, "ibkr-reader").start();

                connected.set(true);
            } else {
                log.warn("✗ TWS connection failed — make sure IB Gateway/TWS is running with API enabled.");
            }
        } catch (Exception e) {
            log.error("Failed to connect to TWS", e);
        }
    }

    @PreDestroy
    public void shutdown() {
        if (client != null && client.isConnected()) {
            client.eDisconnect();
            log.info("Disconnected from TWS");
        }
    }

    public void requestPositions() {
        if (!connected.get()) {
            log.warn("Cannot request positions — not connected to TWS");
            return;
        }
        client.reqPositions();
    }

    public void requestAccountSummary() {
        if (!connected.get()) return;
        String tags = "NetLiquidation,TotalCashValue,BuyingPower,GrossPositionValue," +
                      "InitMarginReq,MaintMarginReq,AvailableFunds,ExcessLiquidity";
        client.reqAccountSummary(9001, "All", tags);
    }

    public boolean isConnected() { return connected.get(); }
    public Map<String, IbkrPosition> getPositions() { return positions; }
    public Map<String, AccountSummary> getAccountSummaries() { return accountSummaries; }

    // ─── EWrapper callbacks ─────────────────────────────────

    @Override
    public void position(String account, Contract contract, com.ib.client.Decimal pos, double avgCost) {
        IbkrPosition position = IbkrPosition.builder()
                .account(account)
                .symbol(contract.symbol())
                .secType(contract.getSecType())
                .currency(contract.currency())
                .exchange(contract.exchange())
                .position(BigDecimal.valueOf(pos.value().doubleValue()))
                .avgCost(BigDecimal.valueOf(avgCost))
                .timestamp(Instant.now())
                .build();
        positions.put(contract.symbol(), position);
    }

    @Override
    public void positionEnd() {
        log.info("Received {} positions from IBKR", positions.size());
        positions.values().forEach(positionPublisher::publishPosition);
    }

    @Override
    public void accountSummary(int reqId, String account, String tag, String value, String currency) {
        AccountSummary summary = accountSummaries.computeIfAbsent(account, a ->
                AccountSummary.builder().account(a).currency(currency).timestamp(Instant.now()).build());

        try {
            BigDecimal v = new BigDecimal(value);
            switch (tag) {
                case "NetLiquidation"      -> summary.setNetLiquidation(v);
                case "TotalCashValue"      -> summary.setTotalCash(v);
                case "BuyingPower"         -> summary.setBuyingPower(v);
                case "GrossPositionValue"  -> summary.setGrossPositionValue(v);
                case "InitMarginReq"       -> summary.setInitMarginReq(v);
                case "MaintMarginReq"      -> summary.setMaintMarginReq(v);
                case "AvailableFunds"      -> summary.setAvailableFunds(v);
                case "ExcessLiquidity"     -> summary.setExcessLiquidity(v);
            }
        } catch (NumberFormatException ignored) {}
    }

    @Override
    public void accountSummaryEnd(int reqId) {
        log.info("Received account summary for {} accounts", accountSummaries.size());
        accountSummaries.values().forEach(positionPublisher::publishAccountSummary);
    }

    @Override
    public void error(int id, int errorCode, String errorMsg, String advancedOrderRejectJson) {
        if (errorCode >= 2100 && errorCode < 2200) return;  // Informational
        if (errorCode == 502) {
            log.error("TWS connection refused — is TWS/Gateway running with API enabled?");
            connected.set(false);
        } else {
            log.warn("[TWS error {} req={}] {}", errorCode, id, errorMsg);
        }
    }

    @Override public void error(Exception e)        { log.error("TWS exception", e); }
    @Override public void error(String str)         { log.warn("TWS message: {}", str); }
    @Override public void connectionClosed()        { log.warn("TWS connection closed"); connected.set(false); }
    @Override public void connectAck()              { if (client.isAsyncEConnect()) client.startAPI(); }
    @Override public void nextValidId(int orderId)  { log.debug("Next valid order ID: {}", orderId); }

    // Stub remaining EWrapper methods
    @Override public void tickPrice(int a, int b, double c, TickAttrib d) {}
    @Override public void tickSize(int a, int b, com.ib.client.Decimal c) {}
    @Override public void tickOptionComputation(int a, int b, int c, double d, double e, double f, double g, double h, double i, double j, double k) {}
    @Override public void tickGeneric(int a, int b, double c) {}
    @Override public void tickString(int a, int b, String c) {}
    @Override public void tickEFP(int a, int b, double c, String d, double e, int f, String g, double h, double i) {}
    @Override public void orderStatus(int a, String b, com.ib.client.Decimal c, com.ib.client.Decimal d, double e, int f, int g, double h, int i, String j, double k) {}
    @Override public void openOrder(int a, Contract b, Order c, OrderState d) {}
    @Override public void openOrderEnd() {}
    @Override public void updateAccountValue(String a, String b, String c, String d) {}
    @Override public void updatePortfolio(Contract a, com.ib.client.Decimal b, double c, double d, double e, double f, double g, String h) {}
    @Override public void updateAccountTime(String a) {}
    @Override public void accountDownloadEnd(String a) {}
    @Override public void contractDetails(int a, ContractDetails b) {}
    @Override public void bondContractDetails(int a, ContractDetails b) {}
    @Override public void contractDetailsEnd(int a) {}
    @Override public void execDetails(int a, Contract b, Execution c) {}
    @Override public void execDetailsEnd(int a) {}
    @Override public void updateMktDepth(int a, int b, int c, int d, double e, com.ib.client.Decimal f) {}
    @Override public void updateMktDepthL2(int a, int b, String c, int d, int e, double f, com.ib.client.Decimal g, boolean h) {}
    @Override public void updateNewsBulletin(int a, int b, String c, String d) {}
    @Override public void managedAccounts(String a) {}
    @Override public void receiveFA(int a, String b) {}
    @Override public void historicalData(int a, Bar b) {}
    @Override public void scannerParameters(String a) {}
    @Override public void scannerData(int a, int b, ContractDetails c, String d, String e, String f, String g) {}
    @Override public void scannerDataEnd(int a) {}
    @Override public void realtimeBar(int a, long b, double c, double d, double e, double f, com.ib.client.Decimal g, com.ib.client.Decimal h, int i) {}
    @Override public void currentTime(long a) {}
    @Override public void fundamentalData(int a, String b) {}
    @Override public void deltaNeutralValidation(int a, DeltaNeutralContract b) {}
    @Override public void tickSnapshotEnd(int a) {}
    @Override public void marketDataType(int a, int b) {}
    @Override public void commissionReport(CommissionReport a) {}
    @Override public void positionMulti(int a, String b, String c, Contract d, com.ib.client.Decimal e, double f) {}
    @Override public void positionMultiEnd(int a) {}
    @Override public void accountUpdateMulti(int a, String b, String c, String d, String e, String f) {}
    @Override public void accountUpdateMultiEnd(int a) {}
    @Override public void securityDefinitionOptionalParameter(int a, String b, int c, String d, String e, java.util.Set<String> f, java.util.Set<Double> g) {}
    @Override public void securityDefinitionOptionalParameterEnd(int a) {}
    @Override public void softDollarTiers(int a, SoftDollarTier[] b) {}
    @Override public void familyCodes(FamilyCode[] a) {}
    @Override public void symbolSamples(int a, ContractDescription[] b) {}
    @Override public void historicalDataEnd(int a, String b, String c) {}
    @Override public void mktDepthExchanges(DepthMktDataDescription[] a) {}
    @Override public void tickNews(int a, long b, String c, String d, String e, String f) {}
    @Override public void smartComponents(int a, Map<Integer, java.util.Map.Entry<String, Character>> b) {}
    @Override public void tickReqParams(int a, double b, String c, int d) {}
    @Override public void newsProviders(NewsProvider[] a) {}
    @Override public void newsArticle(int a, int b, String c) {}
    @Override public void historicalNews(int a, String b, String c, String d, String e) {}
    @Override public void historicalNewsEnd(int a, boolean b) {}
    @Override public void headTimestamp(int a, String b) {}
    @Override public void histogramData(int a, java.util.List<HistogramEntry> b) {}
    @Override public void historicalDataUpdate(int a, Bar b) {}
    @Override public void rerouteMktDataReq(int a, int b, String c) {}
    @Override public void rerouteMktDepthReq(int a, int b, String c) {}
    @Override public void marketRule(int a, PriceIncrement[] b) {}
    @Override public void pnl(int a, double b, double c, double d) {}
    @Override public void pnlSingle(int a, com.ib.client.Decimal b, double c, double d, double e, double f) {}
    @Override public void historicalTicks(int a, java.util.List<HistoricalTick> b, boolean c) {}
    @Override public void historicalTicksBidAsk(int a, java.util.List<HistoricalTickBidAsk> b, boolean c) {}
    @Override public void historicalTicksLast(int a, java.util.List<HistoricalTickLast> b, boolean c) {}
    @Override public void tickByTickAllLast(int a, int b, long c, double d, com.ib.client.Decimal e, TickAttribLast f, String g, String h) {}
    @Override public void tickByTickBidAsk(int a, long b, double c, double d, com.ib.client.Decimal e, com.ib.client.Decimal f, TickAttribBidAsk g) {}
    @Override public void tickByTickMidPoint(int a, long b, double c) {}
    @Override public void orderBound(long a, int b, int c) {}
    @Override public void completedOrder(Contract a, Order b, OrderState c) {}
    @Override public void completedOrdersEnd() {}
    @Override public void replaceFAEnd(int a, String b) {}
    @Override public void wshMetaData(int a, String b) {}
    @Override public void wshEventData(int a, String b) {}
    @Override public void historicalSchedule(int a, String b, String c, String d, java.util.List<HistoricalSession> e) {}
    @Override public void userInfo(int a, String b) {}
    @Override public void verifyMessageAPI(String a) {}
    @Override public void verifyCompleted(boolean a, String b) {}
    @Override public void verifyAndAuthMessageAPI(String a, String b) {}
    @Override public void verifyAndAuthCompleted(boolean a, String b) {}
    @Override public void displayGroupList(int a, String b) {}
    @Override public void displayGroupUpdated(int a, String b) {}
}
