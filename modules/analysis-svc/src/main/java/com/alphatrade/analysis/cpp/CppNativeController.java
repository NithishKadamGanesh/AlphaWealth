package com.alphatrade.analysis.cpp;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/analysis/cpp")
@CrossOrigin(origins = "*")
public class CppNativeController {
    private final CppSignalStreamService stream;

    public CppNativeController(CppSignalStreamService stream) {
        this.stream = stream;
    }

    @GetMapping("/stream/status")
    public ResponseEntity<?> status() {
        return ResponseEntity.ok(stream.status());
    }

    @GetMapping("/stream/recent")
    public ResponseEntity<?> recent(@RequestParam(defaultValue = "50") int limit) {
        return ResponseEntity.ok(stream.recent(limit));
    }
}
