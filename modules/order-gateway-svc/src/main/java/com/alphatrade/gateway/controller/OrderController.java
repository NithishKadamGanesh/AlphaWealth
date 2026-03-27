package com.alphatrade.gateway.controller;

import com.alphatrade.common.model.OrderRequest;
import com.alphatrade.common.model.OrderResponse;
import com.alphatrade.gateway.service.OrderPublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1")
@CrossOrigin(origins = "*")
public class OrderController {

    private static final Logger log = LoggerFactory.getLogger(OrderController.class);
    private final OrderPublisher publisher;

    public OrderController(OrderPublisher publisher) {
        this.publisher = publisher;
    }

    @PostMapping("/orders")
    public ResponseEntity<OrderResponse> submitOrder(@RequestBody OrderRequest request) {
        log.info("Received order: {} {} {} qty={} px={}",
            request.side(), request.type(), request.symbol(), request.qty(), request.price());

        if (request.clientId() == null || request.symbol() == null || request.side() == null) {
            return ResponseEntity.badRequest().body(
                new OrderResponse(null, null, null, "Missing required fields: clientId, symbol, side"));
        }

        OrderResponse response = publisher.submit(request);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(response);
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of("service", "order-gateway", "status", "UP"));
    }
}
