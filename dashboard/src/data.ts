// The pipeline's committed output, bundled into the dashboard by Vite.
import auditJson from "@output/audit_log.json";
import forecastJson from "@output/forecast.json";
import weekOverWeekJson from "@output/week_over_week.json";

import type { AuditFile, ForecastFile, WeekOverWeekFile } from "./types";

export const forecast = forecastJson as unknown as ForecastFile;
export const audit = auditJson as unknown as AuditFile;
export const weekOverWeek = weekOverWeekJson as unknown as WeekOverWeekFile;
