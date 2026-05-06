package com.alphatrade.ibkr.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class IbkrSyncScheduler {
    private final IbkrConnectionService ibkr;

    @Scheduled(fixedRateString = "${ibkr.sync-interval-seconds:30}000")
    public void syncPositions() {
        if (!ibkr.isConnected()) {
            log.debug("Skipping sync — TWS not connected");
            return;
        }
        log.info("→ Polling IBKR positions and account summary");
        ibkr.requestPositions();
        ibkr.requestAccountSummary();
    }
}
