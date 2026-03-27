FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY pom.xml .
COPY modules/common modules/common
COPY modules/portfolio-svc modules/portfolio-svc
RUN mvn -pl modules/common -am install -DskipTests -q
RUN mvn -pl modules/portfolio-svc -am package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/modules/portfolio-svc/target/*.jar app.jar
EXPOSE 8084
ENTRYPOINT ["java", "-jar", "app.jar"]
