package com.alphatrade.ibkr;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Lightweight single-user API authentication.
 *
 * <p>When {@code API_TOKEN} (env) / {@code security.api-token} (property) is set, every
 * request must present it via {@code Authorization: Bearer <token>} or {@code X-API-Token}.
 * When it is blank the filter is a NO-OP, so existing local development keeps working
 * unchanged — auth is strictly opt-in.</p>
 *
 * <p>Always-allowed (so probes & browsers keep working): {@code OPTIONS} preflight,
 * {@code /health}, {@code /ready}, and {@code /actuator/**}.</p>
 */
@Configuration
class SecurityConfig {

    @Value("${security.api-token:${API_TOKEN:}}")
    private String apiToken;

    @Value("${security.cors-origin:${CORS_ALLOW_ORIGIN:*}}")
    private String corsOrigin;

    @Bean
    FilterRegistrationBean<TokenAuthFilter> tokenAuthFilter() {
        FilterRegistrationBean<TokenAuthFilter> reg = new FilterRegistrationBean<>();
        reg.setFilter(new TokenAuthFilter(apiToken, corsOrigin));
        reg.addUrlPatterns("/*");
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return reg;
    }

    static class TokenAuthFilter implements Filter {
        private static final Logger log = LoggerFactory.getLogger(TokenAuthFilter.class);
        private final byte[] expected;
        private final boolean enabled;
        private final String corsOrigin;

        TokenAuthFilter(String expected, String corsOrigin) {
            String t = expected == null ? "" : expected.trim();
            this.enabled = !t.isBlank();
            this.expected = t.getBytes(StandardCharsets.UTF_8);
            this.corsOrigin = (corsOrigin == null || corsOrigin.isBlank()) ? "*" : corsOrigin.trim();
        }

        @Override
        public void init(FilterConfig cfg) {
            if (enabled) {
                log.info("API token auth ENABLED — requests require 'Authorization: Bearer <token>' or 'X-API-Token'");
            } else {
                log.warn("API_TOKEN not set — auth DISABLED (open access). Set API_TOKEN to require a token.");
            }
        }

        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, ServletException {
            if (!enabled) {
                chain.doFilter(request, response);
                return;
            }
            HttpServletRequest http = (HttpServletRequest) request;
            String path = http.getRequestURI();
            String method = http.getMethod();

            if ("OPTIONS".equalsIgnoreCase(method) || isPublicPath(path)) {
                chain.doFilter(request, response);
                return;
            }

            if (tokenMatches(http)) {
                chain.doFilter(request, response);
                return;
            }

            HttpServletResponse hr = (HttpServletResponse) response;
            // Echo a CORS header so the browser surfaces the 401 instead of a CORS error.
            String origin = http.getHeader("Origin");
            hr.setHeader("Access-Control-Allow-Origin", "*".equals(corsOrigin) ? (origin != null ? origin : "*") : corsOrigin);
            hr.setHeader("Vary", "Origin");
            hr.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            hr.setContentType("application/json");
            hr.getWriter().write("{\"error\":\"unauthorized\",\"detail\":\"missing or invalid API token\"}");
        }

        private boolean isPublicPath(String path) {
            return path.equals("/health")
                    || path.equals("/ready")
                    || path.startsWith("/actuator");
        }

        private boolean tokenMatches(HttpServletRequest http) {
            String auth = http.getHeader("Authorization");
            String token = null;
            if (auth != null && auth.regionMatches(true, 0, "Bearer ", 0, 7)) {
                token = auth.substring(7).trim();
            }
            if (token == null) token = http.getHeader("X-API-Token");
            if (token == null) return false;
            // Constant-time comparison to avoid leaking length/content via timing.
            return MessageDigest.isEqual(expected, token.trim().getBytes(StandardCharsets.UTF_8));
        }
    }
}
