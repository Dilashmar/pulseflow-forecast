// The pipeline's committed output, bundled into the dashboard by Vite.
import forecastJson from "@output/forecast.json";

import type { ForecastFile } from "./types";

export const forecast = forecastJson as unknown as ForecastFile;
