package com.alphatrade.ibkr.api;

import com.alphatrade.ibkr.config.IbkrConfig;
import com.alphatrade.ibkr.model.AccountSummary;
import com.alphatrade.ibkr.model.IbkrPosition;
import com.alphatrade.ibkr.service.IbkrConnectionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/ibkr")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
public class IbkrController {

    private final IbkrConnectionService ibkr;
    private final IbkrConfig config;

    @GetMapping("/status")
    public IbkrStatusResponse getStatus() {
        ibkr.refreshStatusIfStale();
        return new IbkrStatusResponse(
                ibkr.getState().name(),
                ibkr.isConnected(),
                ibkr.isGatewayReachable(),
                ibkr.hasSnapshot(),
                ibkr.isSyncInProgress(),
                ibkr.getPrimaryAccountId(),
                ibkr.getPositions().size(),
                ibkr.getAccountSummaries().size(),
                ibkr.getLastSyncAt(),
                ibkr.getLastStatusCheckAt(),
                ibkr.getLastError(),
                config.getPublicLoginUrl()
        );
    }

    @GetMapping("/positions")
    public Collection<IbkrPosition> getPositions() {
        return ibkr.getPositions().values();
    }

    @GetMapping("/positions/{symbol}")
    public ResponseEntity<IbkrPosition> getPosition(@PathVariable String symbol) {
        IbkrPosition pos = ibkr.getPositions().get(symbol.toUpperCase());
        return pos != null ? ResponseEntity.ok(pos) : ResponseEntity.notFound().build();
    }

    @GetMapping("/accounts")
    public Collection<AccountSummary> getAccounts() {
        return ibkr.getAccountSummaries().values();
    }

    @PostMapping("/sync")
    public IbkrStatusResponse forceSync() {
        ibkr.syncNow();
        return getStatus();
    }

    @PostMapping("/disconnect")
    public IbkrStatusResponse disconnect() {
        ibkr.disconnect();
        return getStatus();
    }
}
