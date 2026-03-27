package com.alphatrade.common.serde;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Centralized JSON serialization. Every service uses this single ObjectMapper config
 * so wire formats stay consistent across the pipeline.
 */
public final class JsonSerde {

    private static final Logger log = LoggerFactory.getLogger(JsonSerde.class);

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    private JsonSerde() {}

    public static ObjectMapper mapper() {
        return MAPPER;
    }

    public static <T> String serialize(T obj) {
        try {
            return MAPPER.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            log.error("Serialization failed for {}: {}", obj.getClass().getSimpleName(), e.getMessage());
            throw new RuntimeException("JSON serialization failed", e);
        }
    }

    public static <T> T deserialize(String json, Class<T> clazz) {
        try {
            return MAPPER.readValue(json, clazz);
        } catch (JsonProcessingException e) {
            log.error("Deserialization failed for {}: {}", clazz.getSimpleName(), e.getMessage());
            throw new RuntimeException("JSON deserialization failed", e);
        }
    }
}
