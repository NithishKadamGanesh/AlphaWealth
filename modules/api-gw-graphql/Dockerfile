FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY pom.xml .
COPY modules/common modules/common
COPY modules/api-gw-graphql modules/api-gw-graphql
RUN mvn -pl modules/common -am install -DskipTests -q
RUN mvn -pl modules/api-gw-graphql -am package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/modules/api-gw-graphql/target/*.jar app.jar
EXPOSE 8085
ENTRYPOINT ["java", "-jar", "app.jar"]
