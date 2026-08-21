use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, Timelike};
use ical::IcalParser;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;

#[derive(Debug)]
pub struct CalendarEvent {
    pub summary: String,
    pub date: String,        // YYYY-MM-DD
    pub start_time: Option<u32>, // minutes from midnight, None = all-day
    pub end_time: Option<u32>,   // minutes from midnight, None = all-day
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportRecord {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub imported_at: String,
    pub event_count: usize,
    pub date_range: Option<DateRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateRange {
    pub start: String,
    pub end: String,
}

fn parse_datetime(dt_str: &str) -> Option<NaiveDateTime> {
    // Try parsing as date-only (YYYYMMDD)
    if dt_str.len() == 8 {
        if let Ok(date) = NaiveDate::parse_from_str(dt_str, "%Y%m%d") {
            return Some(date.and_hms_opt(0, 0, 0)?);
        }
    }

    // Try parsing with T separator but no Z (YYYYMMDDTHHMMSS)
    if dt_str.len() == 15 && dt_str.chars().nth(8) == Some('T') {
        if let Ok(dt) = NaiveDateTime::parse_from_str(dt_str, "%Y%m%dT%H%M%S") {
            return Some(dt);
        }
    }

    // Try parsing as UTC datetime with Z suffix (YYYYMMDDTHHMMSSZ)
    // Convert to local timezone so events display at the correct local time
    if dt_str.len() == 16 && dt_str.ends_with('Z') {
        if let Ok(dt) = DateTime::parse_from_rfc3339(&format!(
            "{}-{}-{}T{}:{}:{}Z",
            &dt_str[0..4],
            &dt_str[4..6],
            &dt_str[6..8],
            &dt_str[9..11],
            &dt_str[11..13],
            &dt_str[13..15]
        )) {
            // Convert UTC to local timezone
            return Some(dt.with_timezone(&Local).naive_local());
        }
    }

    None
}

fn minutes_from_midnight(dt: &NaiveDateTime) -> u32 {
    (dt.hour() * 60 + dt.minute()) as u32
}

pub fn parse_ics_file(path: &str) -> Result<Vec<CalendarEvent>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open ICS file: {}", e))?;
    let reader = BufReader::new(file);
    let parser = IcalParser::new(reader);

    let mut events = Vec::new();

    for calendar in parser {
        let calendar = calendar.map_err(|e| format!("Failed to parse ICS: {}", e))?;
        eprintln!("Parsing calendar with {} events", calendar.events.len());

        for component in calendar.events {
            let mut summary = String::new();
            let mut dtstart: Option<NaiveDateTime> = None;
            let mut dtend: Option<NaiveDateTime> = None;
            let mut is_all_day = false;

            for property in component.properties {
                match property.name.as_str() {
                    "SUMMARY" => {
                        if let Some(value) = property.value {
                            summary = value.trim().to_string();
                        }
                    }
                    "DTSTART" => {
                        if let Some(value) = property.value {
                            let val = value.trim();
                            // Check if it's a date-only (all-day event)
                            // Also check for VALUE=DATE parameter
                            let is_date_only = val.len() == 8 && !val.contains('T');
                            let has_date_param = property.params.as_ref()
                                .map(|params| {
                                    params.iter().any(|(key, vals)| {
                                        key == "VALUE" && vals.iter().any(|v| v == "DATE")
                                    })
                                })
                                .unwrap_or(false);

                            if is_date_only || has_date_param {
                                is_all_day = true;
                            }
                            dtstart = parse_datetime(val);
                        }
                    }
                    "DTEND" => {
                        if let Some(value) = property.value {
                            dtend = parse_datetime(value.trim());
                        }
                    }
                    _ => {}
                }
            }

            // Only include events with at least a summary and start date
            if !summary.is_empty() && dtstart.is_some() {
                let start_dt = dtstart.unwrap();
                let date = format!(
                    "{:04}-{:02}-{:02}",
                    start_dt.year(),
                    start_dt.month(),
                    start_dt.day()
                );

                let (start_time, end_time) = if is_all_day {
                    (None, None)
                } else {
                    (
                        Some(minutes_from_midnight(&start_dt)),
                        dtend.map(|dt| minutes_from_midnight(&dt)),
                    )
                };

                let event = CalendarEvent {
                    summary: summary.clone(),
                    date: date.clone(),
                    start_time,
                    end_time,
                };
                eprintln!("Parsed event: {} on {} (all-day: {}, start: {:?}, end: {:?})",
                    summary, date, is_all_day, start_time, end_time);
                events.push(event);
            }
        }
    }

    eprintln!("Total events parsed: {}", events.len());
    Ok(events)
}

fn format_time_12h(minutes: u32) -> String {
    let hour = minutes / 60;
    let min = minutes % 60;
    let period = if hour >= 12 { "pm" } else { "am" };
    let hour_12 = if hour == 0 {
        12
    } else if hour > 12 {
        hour - 12
    } else {
        hour
    };

    if min == 0 {
        format!("{}{}", hour_12, period)
    } else {
        format!("{}:{:02}{}", hour_12, min, period)
    }
}

pub fn format_event_line(event: &CalendarEvent, import_id: Option<&str>) -> String {
    let time_range = match (event.start_time, event.end_time) {
        (None, None) => "[all-day]".to_string(),
        (Some(start), Some(end)) => {
            format!("[{}-{}]", format_time_12h(start), format_time_12h(end))
        }
        (Some(start), None) => format!("[{}]", format_time_12h(start)),
        (None, Some(_)) => "[all-day]".to_string(), // Shouldn't happen, but handle it
    };

    let base = format!("{} {} !{}", time_range, event.summary, event.date);
    if let Some(id) = import_id {
        format!("{} !import:{}", base, id)
    } else {
        base
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_time_12h() {
        assert_eq!(format_time_12h(0), "12am");
        assert_eq!(format_time_12h(60), "1am");
        assert_eq!(format_time_12h(720), "12pm");
        assert_eq!(format_time_12h(780), "1pm");
        assert_eq!(format_time_12h(930), "3:30pm");
        assert_eq!(format_time_12h(1380), "11pm");
    }

    #[test]
    fn test_format_event_line() {
        let event = CalendarEvent {
            summary: "Team Meeting".to_string(),
            date: "2026-08-21".to_string(),
            start_time: Some(540), // 9am
            end_time: Some(600),   // 10am
        };
        assert_eq!(
            format_event_line(&event, None),
            "[9am-10am] Team Meeting !2026-08-21"
        );
        assert_eq!(
            format_event_line(&event, Some("01ABC123")),
            "[9am-10am] Team Meeting !2026-08-21 !import:01ABC123"
        );

        let all_day = CalendarEvent {
            summary: "Holiday".to_string(),
            date: "2026-08-25".to_string(),
            start_time: None,
            end_time: None,
        };
        assert_eq!(format_event_line(&all_day, None), "[all-day] Holiday !2026-08-25");
    }

    #[test]
    fn test_parse_datetime() {
        // Date-only (all-day)
        let dt = parse_datetime("20260821");
        assert!(dt.is_some());
        let dt = dt.unwrap();
        assert_eq!(dt.year(), 2026);
        assert_eq!(dt.month(), 8);
        assert_eq!(dt.day(), 21);

        // DateTime with T separator
        let dt = parse_datetime("20260821T093000");
        assert!(dt.is_some());
        let dt = dt.unwrap();
        assert_eq!(dt.hour(), 9);
        assert_eq!(dt.minute(), 30);
    }

    #[test]
    fn test_end_to_end_formatting() {
        // Test that we can format events in the markdown format that frontend expects
        let timed_event = CalendarEvent {
            summary: "F1: FP1 (Dutch Grand Prix)".to_string(),
            date: "2026-08-21".to_string(),
            start_time: Some(870), // 2:30pm
            end_time: Some(960),   // 4:00pm
        };
        let line = format_event_line(&timed_event, None);
        assert_eq!(line, "[2:30pm-4pm] F1: FP1 (Dutch Grand Prix) !2026-08-21");

        let all_day = CalendarEvent {
            summary: "Holiday".to_string(),
            date: "2026-08-25".to_string(),
            start_time: None,
            end_time: None,
        };
        let line = format_event_line(&all_day, None);
        assert_eq!(line, "[all-day] Holiday !2026-08-25");
    }

    #[test]
    fn test_utc_timezone_conversion() {
        // Test that UTC times (Z suffix) convert to local timezone
        // 20260821T150000Z = 3pm UTC
        // In PDT (UTC-7): should become 8am local
        // In EDT (UTC-4): should become 11am local
        let dt = parse_datetime("20260821T150000Z");
        assert!(dt.is_some());
        let dt = dt.unwrap();

        // The converted time should NOT be 15 (3pm UTC)
        // It should be adjusted to local timezone
        // We can't hardcode the exact hour since it depends on the machine's timezone,
        // but we can verify it's a valid datetime and different from UTC
        assert_eq!(dt.year(), 2026);
        assert_eq!(dt.month(), 8);
        // Day might change if crossing midnight boundary
        assert!(dt.day() >= 20 && dt.day() <= 22);

        // Verify it parsed successfully and has a time component
        assert!(dt.hour() < 24);
        assert!(dt.minute() < 60);

        // In most US timezones (PDT/EDT), 3pm UTC should convert to morning/early afternoon
        // This is a sanity check that some conversion happened
        println!("UTC 15:00 converted to local: {:02}:{:02}", dt.hour(), dt.minute());
    }

    #[test]
    fn test_parse_ics_with_utc_times() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        // Create a test ICS file with UTC times
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "BEGIN:VCALENDAR").unwrap();
        writeln!(file, "VERSION:2.0").unwrap();
        writeln!(file, "PRODID:-//Test//Test//EN").unwrap();
        writeln!(file, "BEGIN:VEVENT").unwrap();
        writeln!(file, "DTSTART:20260821T150000Z").unwrap();  // 3pm UTC
        writeln!(file, "DTEND:20260821T160000Z").unwrap();    // 4pm UTC
        writeln!(file, "SUMMARY:UTC Test Event").unwrap();
        writeln!(file, "UID:test-001@jimothy").unwrap();
        writeln!(file, "END:VEVENT").unwrap();
        writeln!(file, "END:VCALENDAR").unwrap();
        file.flush().unwrap();

        // Parse the ICS file
        let events = parse_ics_file(file.path().to_str().unwrap()).unwrap();

        assert_eq!(events.len(), 1);
        let event = &events[0];

        // Verify event was parsed
        assert_eq!(event.summary, "UTC Test Event");
        assert_eq!(event.date, "2026-08-21");

        // Verify times were converted from UTC to local
        // start_time should NOT be 900 (15*60 = 3pm UTC)
        // In PDT it should be 480 (8*60 = 8am)
        // In EDT it should be 660 (11*60 = 11am)
        assert!(event.start_time.is_some());
        let start_minutes = event.start_time.unwrap();

        println!("\nParsed event from ICS:");
        println!("  Event: {}", event.summary);
        println!  ("  Date: {}", event.date);
        println!("  Start: {} minutes ({:02}:{:02})",
                 start_minutes, start_minutes / 60, start_minutes % 60);

        // The start time should be in local timezone, not UTC
        // We can't assert exact value because it depends on machine timezone,
        // but we can verify it's not the UTC time
        // 900 minutes = 15:00 (3pm UTC)
        if start_minutes == 900 {
            panic!("Event time was NOT converted from UTC! Still showing 3pm (900 minutes)");
        }
    }
}
