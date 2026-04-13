FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy project files and restore dependencies
COPY F1Pitwall.Core/F1Pitwall.Core.csproj         F1Pitwall.Core/
COPY F1Pitwall.Infrastructure/F1Pitwall.Infrastructure.csproj F1Pitwall.Infrastructure/
COPY F1PitWall/F1PitWall.Api.csproj               F1PitWall/
RUN dotnet restore F1PitWall/F1PitWall.Api.csproj

# Copy everything and publish
COPY . .
RUN dotnet publish F1PitWall/F1PitWall.Api.csproj \
    -c Release \
    -o /app \
    --no-restore

# ── Runtime image ─────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .

# Fly.io / Railway set PORT; ASP.NET Core respects ASPNETCORE_URLS
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "F1PitWall.Api.dll"]
