package com.alphatrade.ibkr.api;

import com.alphatrade.ibkr.model.AccountSummary;
import com.alphatrade.ibkr.model.IbkrPosition;
import com.alphatrade.ibkr.service.IbkrConnectionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Collection;
import java.util.Map;

@RestController
@RequestMapping("/ibkr")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
public class IbkrController {

    private final IbkrConnectionService ibkr;

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

    @GetMapping("/status")
    public Map<String, Object> getStatus() {
        return Map.of(
                "connected", ibkr.isConnected(),
                "positionCount", ibkr.getPositions().size(),
                "accountCount", ibkr.getAccountSummaries().size()
        );
    }

    @PostMapping("/sync")
    public Map<String, Object> forceSync() {
        if (!ibkr.isConnected()) {
            return Map.of("status", "error", "message", "Not connected to TWS");
        }
        ibkr.requestPositions();
        ibkr.requestAccountSummary();
        return Map.of("status", "ok", "message", "Sync requested");
    }
}
