package com.alphatrade.analysis.cpp;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.zeromq.SocketType;
import org.zeromq.ZContext;
import org.zeromq.ZMQ;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class CppSignalStreamService {
    private static final Logger log = LoggerFactory.getLogger(CppSignalStreamService.class);
    private static final ObjectMapper mapper = new ObjectMapper();
    private static final int MAX_EVENTS = 200;

    private final String endpoint;
    private final ArrayDeque<Map<String, Object>> recent = new ArrayDeque<>();
    private volatile boolean running;
    private volatile boolean connected;
    private volatile String lastError;
    private Thread worker;

    public CppSignalStreamService(@Value("${services.cpp-zmq:${CPP_ZMQ_URL:tcp://cpp-signal-engine:5555}}") String endpoint) {
        this.endpoint = endpoint;
    }

    @PostConstruct
    public void start() {
        running = true;
        worker = new Thread(this::listenLoop, "cpp-signal-zmq-subscriber");
        worker.setDaemon(true);
        worker.start();
    }

    @PreDestroy
    public void stop() {
        running = false;
        if (worker != null) worker.interrupt();
    }

    public Map<String, Object> status() {
        return Map.of(
            "endpoint", endpoint,
            "running", running,
            "connected", connected,
            "events", recentSize(),
            "lastError", lastError == null ? "" : lastError
        );
    }

    public List<Map<String, Object>> recent(int limit) {
        int capped = Math.max(1, Math.min(limit, MAX_EVENTS));
        synchronized (recent) {
            List<Map<String, Object>> out = new ArrayList<>();
            recent.stream().limit(capped).forEach(event -> out.add(new LinkedHashMap<>(event)));
            return out;
        }
    }

    private int recentSize() {
        synchronized (recent) {
            return recent.size();
        }
    }

    private void listenLoop() {
        while (running) {
            try (ZContext context = new ZContext()) {
                ZMQ.Socket socket = context.createSocket(SocketType.SUB);
                socket.setReceiveTimeOut(1000);
                socket.subscribe(ZMQ.SUBSCRIPTION_ALL);
                socket.connect(endpoint);
                connected = true;
                lastError = null;

                while (running && !Thread.currentThread().isInterrupted()) {
                    String msg = socket.recvStr();
                    if (msg != null && !msg.isBlank()) addEvent(parseMessage(msg));
                }
            } catch (Exception e) {
                connected = false;
                lastError = e.getMessage();
                log.debug("C++ ZMQ stream unavailable at {}: {}", endpoint, e.getMessage());
                sleepQuietly(2000);
            }
        }
        connected = false;
    }

    private Map<String, Object> parseMessage(String msg) {
        Map<String, Object> event;
        try {
            event = mapper.readValue(msg, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            event = new LinkedHashMap<>();
            event.put("message", msg);
        }
        event.putIfAbsent("receivedAt", Instant.now().toString());
        event.putIfAbsent("source", "cpp-signal-engine");
        return event;
    }

    private void addEvent(Map<String, Object> event) {
        synchronized (recent) {
            recent.addFirst(event);
            while (recent.size() > MAX_EVENTS) recent.removeLast();
        }
    }

    private void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
