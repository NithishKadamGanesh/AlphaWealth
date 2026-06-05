package com.alphatrade.ibkr.api;

import com.alphatrade.ibkr.service.IbkrConnectionService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
public class IbkrHealthController {

    private final IbkrConnectionService ibkr;

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                "status", "healthy",
                "service", "ibkr-sync-svc",
                "state", ibkr.getState().name(),
                "gatewayReachable", ibkr.isGatewayReachable()
        );
    }
}
