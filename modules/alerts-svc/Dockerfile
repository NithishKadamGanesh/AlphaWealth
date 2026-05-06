FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests -B

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/alerts-svc-*.jar app.jar
EXPOSE 8095
HEALTHCHECK --interval=20s --timeout=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8095/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
