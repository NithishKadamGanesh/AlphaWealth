package com.alphatrade.ibkr;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class IbkrSyncApplication {
    public static void main(String[] args) {
        SpringApplication.run(IbkrSyncApplication.class, args);
    }
}
