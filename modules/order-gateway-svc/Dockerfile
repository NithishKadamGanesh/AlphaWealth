FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY pom.xml .
COPY modules/common modules/common
COPY modules/order-gateway-svc modules/order-gateway-svc
RUN mvn -pl modules/common -am install -DskipTests -q
RUN mvn -pl modules/order-gateway-svc -am package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/modules/order-gateway-svc/target/*.jar app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "app.jar"]
