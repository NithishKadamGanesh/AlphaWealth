package com.alphatrade.matching;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class MatchEngineApplication {
    public static void main(String[] args) {
        SpringApplication.run(MatchEngineApplication.class, args);
    }
}
