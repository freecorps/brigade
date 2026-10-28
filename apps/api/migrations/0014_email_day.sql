-- The Brigade-wide daily email ceiling (RFC 0005 "Abuse", Q21; src/email-ceiling.ts): how many emails the instance sent
-- on each UTC day, from every workspace and every kind of email together, counted with one upsert per send so sends at
-- once in any isolate each count. Past `EMAIL_DAILY_CEILING`, emails are dropped and logged, except the ones about a
-- page that failed, which are counted and always sent. One row a day; the cron deletes rows older than a week.
create table "email_day" (
  "day" text not null primary key,
  "sent" integer not null
);
