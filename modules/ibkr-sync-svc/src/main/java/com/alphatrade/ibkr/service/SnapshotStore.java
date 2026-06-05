package com.alphatrade.ibkr.service;

import com.alphatrade.ibkr.model.Snapshot;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;

@Slf4j
@Service
@RequiredArgsConstructor
public class SnapshotStore {

    private final ObjectMapper objectMapper;

    @Value("${ibkr.snapshot-path:/data/ibkr-snapshot.json}")
    private String snapshotPath;

    public Snapshot load() {
        File f = new File(snapshotPath);
        if (!f.exists() || f.length() == 0) return null;
        try {
            return objectMapper.readValue(f, Snapshot.class);
        } catch (Exception e) {
            log.warn("Could not read snapshot from {}: {}", snapshotPath, e.getMessage());
            return null;
        }
    }

    public void save(Snapshot snapshot) {
        try {
            Path p = Path.of(snapshotPath);
            if (p.getParent() != null) Files.createDirectories(p.getParent());
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(p.toFile(), snapshot);
        } catch (Exception e) {
            log.warn("Could not persist snapshot to {}: {}", snapshotPath, e.getMessage());
        }
    }
}
