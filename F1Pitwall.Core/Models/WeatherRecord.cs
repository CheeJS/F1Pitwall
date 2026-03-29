namespace F1Pitwall.Core.Models
{
    public record WeatherRecord(
        DateTimeOffset Date,
        double AirTemperature,
        double Humidity,
        double Pressure,
        bool Rainfall,
        double TrackTemperature,
        int WindDirection,
        double WindSpeed,
        int SessionKey
    );
}
