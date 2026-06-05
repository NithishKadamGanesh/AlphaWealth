package com.alphatrade.ibkr.model;

public enum ConnectionState {
    DISCONNECTED,
    AUTH_REQUIRED,
    CONNECTED,
    SYNCING,
    DEGRADED,
    LAST_SYNC_FAILED
}
