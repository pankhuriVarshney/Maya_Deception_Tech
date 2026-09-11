FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download || true
COPY main.go ./
RUN CGO_ENABLED=0 go build -o /lifecycle-manager .

FROM gcr.io/distroless/static-debian12
COPY --from=build /lifecycle-manager /lifecycle-manager
EXPOSE 8081
ENTRYPOINT ["/lifecycle-manager"]
