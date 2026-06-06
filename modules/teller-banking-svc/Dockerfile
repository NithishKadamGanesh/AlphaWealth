FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY pom.xml .
COPY modules modules
RUN mvn -pl modules/teller-banking-svc package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/modules/teller-banking-svc/target/teller-banking-svc-*.jar app.jar
EXPOSE 8092
HEALTHCHECK --interval=20s --timeout=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8092/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
