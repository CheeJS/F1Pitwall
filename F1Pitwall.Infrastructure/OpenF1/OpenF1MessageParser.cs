using F1Pitwall.Core.Models;
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace F1Pitwall.Infrastructure.OpenF1
{
    /// <summary>
    /// Parses raw JSON messages from OpenF1 WebSocket into typed TimingUpdate objects.
    /// 
    /// BEGINNER EXPLANATION:
    /// OpenF1 sends weird message formats:
    /// - Some are compressed (zlib)
    /// - Some are single messages, some are batches
    /// - Different message types have different structures
    /// 
    /// This class figures out what type of message it is and converts it
    /// into our C# objects (PositionUpdate, CarDataUpdate, etc.)
    /// </summary>
    public class OpenF1MessageParser
    {
        /// <summary>
        /// Main parsing method - takes raw JSON string, returns list of updates.
        /// Returns a LIST because one message might contain multiple updates.
        /// </summary>
        public IEnumerable<TimingUpdate> Parse(string raw)
        {
            try
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;

                // OpenF1 sends two formats:
                // 1. Single message: ["Position.z", {...data...}, "2024-03-15T14:23:01Z"]
                // 2. Batch: [["Position.z", {...}], ["CarData.z", {...}]]

                // Check if it's a single message or a batch
                if (root.ValueKind == JsonValueKind.Array && root.GetArrayLength() > 0)
                {
                    var firstElement = root[0];

                    // Single message: first element is a string (the message type)
                    if (firstElement.ValueKind == JsonValueKind.String)
                    {
                        return ParseSingleMessage(root);
                    }

                    // Batch: first element is an array
                    if (firstElement.ValueKind == JsonValueKind.Array)
                    {
                        return root.EnumerateArray().SelectMany(ParseSingleMessage);
                    }
                }

                return Enumerable.Empty<TimingUpdate>();
            }
            catch (JsonException)
            {
                // If parsing fails, just return empty (don't crash the whole service)
                return Enumerable.Empty<TimingUpdate>();
            }
        }

        /// <summary>
        /// Parses a single message array: ["MessageType", {...data...}, "timestamp"]
        /// </summary>
        private IEnumerable<TimingUpdate> ParseSingleMessage(JsonElement msg)
        {
            // OpenF1 message format: [type, data, timestamp]
            if (msg.GetArrayLength() < 2)
                return Enumerable.Empty<TimingUpdate>();

            var messageType = msg[0].GetString();
            var data = msg[1];
            
            // Timestamp is optional (sometimes it's not there)
            var timestamp = msg.GetArrayLength() > 2 && msg[2].ValueKind == JsonValueKind.String
                ? DateTimeOffset.Parse(msg[2].GetString()!)
                : DateTimeOffset.UtcNow;

            // Route to the correct parser based on message type
            return messageType switch
            {
                "Position.z" => ParsePositions(data, timestamp),          // Compressed position data
                "CarData.z" => ParseCarData(data, timestamp),             // Compressed telemetry
                "TimingData" => ParseTimingData(data, timestamp),         // Lap times
                "PitLaneTimeCollection" => ParsePitData(data, timestamp), // Pit stops
                "SessionStatus" => ParseSessionStatus(data, timestamp),   // Race status
                "TrackStatus" => ParseTrackStatus(data, timestamp),       // Safety car
                "SessionInfo" => ParseSessionInfo(data, timestamp),       // Session type (Race/Qualifying/etc)
                _ => Enumerable.Empty<TimingUpdate>() // Unknown type - skip it
            };
        }

        // ============================================
        // PARSING METHODS FOR EACH MESSAGE TYPE
        // ============================================

        /// <summary>
        /// Parses position updates (compressed with zlib).
        /// OpenF1 sends this as base64-encoded compressed data to save bandwidth.
        /// </summary>
        private IEnumerable<TimingUpdate> ParsePositions(JsonElement data, DateTimeOffset timestamp)
        {
            try
            {
                // ".z" means it's zlib-compressed and base64-encoded
                var base64 = data.GetString();
                if (string.IsNullOrEmpty(base64))
                    return Enumerable.Empty<TimingUpdate>();

                // Step 1: Decode from base64 → get compressed bytes
                var compressed = Convert.FromBase64String(base64);

                // Step 2: Decompress → get JSON string
                var json = DecompressZlib(compressed);

                // Step 3: Parse the decompressed JSON
                using var doc = JsonDocument.Parse(json);

                // The format is: { "Lines": { "1": {"Position": 1}, "44": {"Position": 2} } }
                if (!doc.RootElement.TryGetProperty("Lines", out var lines))
                    return Enumerable.Empty<TimingUpdate>();

                var updates = new List<TimingUpdate>();

                foreach (var driver in lines.EnumerateObject())
                {
                    // driver.Name = "44" (driver number as string)
                    // driver.Value = { "Position": 2 }
                    
                    if (int.TryParse(driver.Name, out var driverNumber) &&
                        driver.Value.TryGetProperty("Position", out var posElement))
                    {
                        updates.Add(new PositionUpdate(driverNumber, posElement.GetInt32())
                        {
                            Date = timestamp
                        });
                    }
                }

                return updates;
            }
            catch
            {
                return Enumerable.Empty<TimingUpdate>();
            }
        }

        /// <summary>
        /// Parses car telemetry data (speed, throttle, brake, gear, DRS).
        /// Also compressed like positions.
        /// </summary>
        private IEnumerable<TimingUpdate> ParseCarData(JsonElement data, DateTimeOffset timestamp)
        {
            try
            {
                var base64 = data.GetString();
                if (string.IsNullOrEmpty(base64))
                    return Enumerable.Empty<TimingUpdate>();

                var compressed = Convert.FromBase64String(base64);
                var json = DecompressZlib(compressed);
                using var doc = JsonDocument.Parse(json);

                if (!doc.RootElement.TryGetProperty("Entries", out var entries))
                    return Enumerable.Empty<TimingUpdate>();

                var updates = new List<TimingUpdate>();

                foreach (var car in entries.EnumerateArray())
                {
                    // Extract driver number
                    if (!car.TryGetProperty("RacingNumber", out var racingNum) ||
                        !int.TryParse(racingNum.GetString(), out var driverNumber))
                        continue;

                    // Extract telemetry values (with defaults if missing)
                    var speed = car.TryGetProperty("Speed", out var s) ? s.GetInt32() : 0;
                    var throttle = car.TryGetProperty("Throttle", out var t) ? t.GetInt32() : 0;
                    var brake = car.TryGetProperty("Brake", out var b) ? (b.GetInt32() > 0 ? 100 : 0) : 0;
                    var gear = car.TryGetProperty("nGear", out var g) ? g.GetInt32() : 0;
                    var drs = car.TryGetProperty("DRS", out var d) ? d.GetInt32() == 10 || d.GetInt32() == 12 : false;

                    updates.Add(new CarDataUpdate(driverNumber, speed, throttle, brake, gear, drs)
                    {
                        Date = timestamp
                    });
                }

                return updates;
            }
            catch
            {
                return Enumerable.Empty<TimingUpdate>();
            }
        }

        /// <summary>
        /// Parses timing data (lap times, gaps, intervals).
        /// This one is NOT compressed (just regular JSON).
        /// </summary>
        private IEnumerable<TimingUpdate> ParseTimingData(JsonElement data, DateTimeOffset timestamp)
        {
            try
            {
                if (!data.TryGetProperty("Lines", out var lines))
                    return Enumerable.Empty<TimingUpdate>();

                var updates = new List<TimingUpdate>();

                foreach (var driver in lines.EnumerateObject())
                {
                    if (!int.TryParse(driver.Name, out var driverNumber))
                        continue;

                    var lastLap = driver.Value.TryGetProperty("LastLapTime", out var lap) 
                        ? lap.GetProperty("Value").GetString() 
                        : null;
                    
                    var gap = driver.Value.TryGetProperty("GapToLeader", out var g) 
                        ? g.GetString() 
                        : null;
                    
                    var interval = driver.Value.TryGetProperty("IntervalToPositionAhead", out var i) 
                        ? i.GetProperty("Value").GetString() 
                        : null;
                    
                    var currentLap = driver.Value.TryGetProperty("NumberOfLaps", out var n) 
                        ? n.GetInt32() 
                        : 0;

                    updates.Add(new TimingDataUpdate(driverNumber, lastLap, gap, interval, currentLap)
                    {
                        Date = timestamp
                    });
                }

                return updates;
            }
            catch
            {
                return Enumerable.Empty<TimingUpdate>();
            }
        }

        /// <summary>
        /// Parses pit stop data from PitLaneTimeCollection messages.
        /// Format: { "PitTimes": { "44": { "InProgress": 1, "Duration": "24.532", "Lap": 23 } } }
        /// InProgress=1 means driver is currently in pit lane; 0 means pit stop completed.
        /// </summary>
        private IEnumerable<TimingUpdate> ParsePitData(JsonElement data, DateTimeOffset timestamp)
        {
            try
            {
                if (!data.TryGetProperty("PitTimes", out var pitTimes))
                    return Enumerable.Empty<TimingUpdate>();

                var updates = new List<TimingUpdate>();

                foreach (var driver in pitTimes.EnumerateObject())
                {
                    if (!int.TryParse(driver.Name, out var driverNumber))
                        continue;

                    // InProgress: 1 = currently in pit, 0 = pit stop completed
                    var inProgress = driver.Value.TryGetProperty("InProgress", out var ip)
                        && ip.GetInt32() == 1;

                    // Compound info is not available in this message type;
                    // it comes separately from TyreStintSeries messages.
                    updates.Add(new PitUpdate(driverNumber, inProgress, 0, null)
                    {
                        Date = timestamp
                    });
                }

                return updates;
            }
            catch
            {
                return Enumerable.Empty<TimingUpdate>();
            }
        }

        /// <summary>
        /// Parses SessionInfo messages to determine the session type (Race, Qualifying, Practice, Sprint).
        /// Format: { "Type": "Race", "Name": "Race", "Meeting": { "Name": "Monaco Grand Prix" }, ... }
        /// </summary>
        private IEnumerable<TimingUpdate> ParseSessionInfo(JsonElement data, DateTimeOffset timestamp)
        {
            try
            {
                var typeStr = data.TryGetProperty("Type", out var t) ? t.GetString() : null;
                var name = data.TryGetProperty("Name", out var n) ? n.GetString() ?? string.Empty : string.Empty;

                var sessionType = typeStr switch
                {
                    "Race" => SessionType.Race,
                    "Qualifying" => SessionType.Qualifying,
                    "Sprint" => SessionType.Sprint,
                    string s when s.StartsWith("Practice") => SessionType.Practice,
                    _ => SessionType.Race
                };

                return new[] { new SessionInfoUpdate(sessionType, name) { Date = timestamp } };
            }
            catch
            {
                return Enumerable.Empty<TimingUpdate>();
            }
        }

        /// <summary>
        /// Parses session status (Started, Finished, etc.)
        /// </summary>
        private IEnumerable<TimingUpdate> ParseSessionStatus(JsonElement data, DateTimeOffset timestamp)
        {
            try
            {
                if (data.TryGetProperty("Status", out var statusElement))
                {
                    var statusString = statusElement.GetString();
                    var status = statusString switch
                    {
                        "Started" => SessionStatus.Started,
                        "Finished" => SessionStatus.Finished,
                        "Aborted" => SessionStatus.Aborted,
                        _ => SessionStatus.Inactive
                    };

                    var totalLaps = data.TryGetProperty("TotalLaps", out var laps) 
                        ? laps.GetInt32() 
                        : 0;

                    return new[] { new SessionStatusUpdate(status, totalLaps) { Date = timestamp } };
                }
            }
            catch { }

            return Enumerable.Empty<TimingUpdate>();
        }

        /// <summary>
        /// Parses track status (Safety Car, VSC, etc.)
        /// </summary>
        private IEnumerable<TimingUpdate> ParseTrackStatus(JsonElement data, DateTimeOffset timestamp)
        {
            try
            {
                if (data.TryGetProperty("Status", out var statusElement))
                {
                    var status = statusElement.GetString() ?? "None";
                    return new[] { new SafetyCarUpdate(status) { Date = timestamp } };
                }
            }
            catch { }

            return Enumerable.Empty<TimingUpdate>();
        }

        // ============================================
        // HELPER: Decompress zlib data
        // ============================================

        /// <summary>
        /// Decompresses zlib-compressed data.
        /// OpenF1 uses raw DEFLATE (zlib without the header).
        /// </summary>
        private static string DecompressZlib(byte[] data)
        {
            using var input = new MemoryStream(data);
            using var deflate = new DeflateStream(input, CompressionMode.Decompress);
            using var output = new MemoryStream();
            
            deflate.CopyTo(output);
            
            return Encoding.UTF8.GetString(output.ToArray());
        }
    }
}
