-- Portfolio analytics schema for Athena + QuickSight
-- Replace {{ANALYTICS_BUCKET}} with your bucket name before running manually.

CREATE DATABASE IF NOT EXISTS portfolio_analytics;

CREATE EXTERNAL TABLE IF NOT EXISTS portfolio_analytics.events_raw (
  version int,
  event_type string,
  event_time string,
  event_date string,
  event_hour string,
  route string,
  page string,
  source string,
  referrer string,
  session_id string,
  visitor_id string,
  user_agent string,
  ip_hash string,
  metadata_json string,
  received_at string
)
PARTITIONED BY (dt string, hr string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES (
  'ignore.malformed.json'='true'
)
STORED AS TEXTFILE
LOCATION 's3://{{ANALYTICS_BUCKET}}/events/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.dt.type'='date',
  'projection.dt.format'='yyyy-MM-dd',
  'projection.dt.range'='2025-01-01,NOW',
  'projection.dt.interval'='1',
  'projection.dt.interval.unit'='DAYS',
  'projection.hr.type'='integer',
  'projection.hr.range'='0,23',
  'projection.hr.digits'='2',
  'storage.location.template'='s3://{{ANALYTICS_BUCKET}}/events/dt=${dt}/hr=${hr}/'
);

CREATE OR REPLACE VIEW portfolio_analytics.events_enriched AS
SELECT
  CAST(from_iso8601_timestamp(event_time) AS timestamp) AS event_ts,
  date(CAST(from_iso8601_timestamp(event_time) AS timestamp)) AS event_day,
  event_type,
  route,
  page,
  source,
  referrer,
  session_id,
  visitor_id,
  ip_hash,
  metadata_json
FROM portfolio_analytics.events_raw;

CREATE OR REPLACE VIEW portfolio_analytics.events_daily AS
SELECT
  event_day,
  source,
  event_type,
  route,
  count(*) AS event_count,
  approx_distinct(session_id) AS session_count,
  approx_distinct(visitor_id) AS visitor_count
FROM portfolio_analytics.events_enriched
GROUP BY 1,2,3,4;

CREATE OR REPLACE VIEW portfolio_analytics.cta_performance_daily AS
SELECT
  event_day,
  event_type,
  route,
  count(*) AS clicks
FROM portfolio_analytics.events_enriched
WHERE event_type LIKE '%clicked%'
   OR event_type LIKE '%submit%'
   OR event_type LIKE '%subscribe%'
GROUP BY 1,2,3;

-- AI Disclosure: Drafted with AI assistance.
-- Validated By: Grayson Wills
-- Validation Date: 2026-02-25
