// environments.js — AquaFlow Environment Library (AQ-S3-008)
//
// 20 built-in lighting/atmosphere environments for the preview + 4K renderer, each
// with the physically-meaningful parameters the render pipeline consumes (ambient
// lux, sun position, sky turbidity, fog, wind, temperature, humidity). Values are
// within the ranges from the AQ-S3-008 research spec.

// Editable/validated parameter ranges (min, max, default).
export const ENV_PARAM_RANGES = {
  ambient_lux:      { min: 0,     max: 100000, default: 20000 },
  sun_elevation_deg:{ min: -10,   max: 90,     default: 45 },
  sun_azimuth_deg:  { min: 0,     max: 360,    default: 135 },
  sky_turbidity:    { min: 1.7,   max: 20,     default: 2.5 },
  fog_density:      { min: 0,     max: 0.02,   default: 0.0008 },
  wind_speed_mps:   { min: 0,     max: 25,     default: 2 },
  temperature_c:    { min: -20,   max: 55,     default: 20 },
  humidity_percent: { min: 0,     max: 100,    default: 55 },
};

export const ENV_TIMES = ["day", "sunset", "night", "controlled"];

function env(id, name, time, hdri, params) {
  return { id, name, time, hdri, builtin: true, params };
}

// Built-in environments ENV001–ENV020 (matches the research v1 list).
export const BUILTIN_ENVIRONMENTS = [
  env("ENV001", "Clear Day Urban Plaza", "day", true,
    { ambient_lux: 22000, sun_elevation_deg: 58, sun_azimuth_deg: 140, sky_turbidity: 2.4, fog_density: 0.0003, wind_speed_mps: 3, temperature_c: 24, humidity_percent: 45 }),
  env("ENV002", "Golden Hour Urban Plaza", "sunset", true,
    { ambient_lux: 9000, sun_elevation_deg: 8, sun_azimuth_deg: 255, sky_turbidity: 4.5, fog_density: 0.0009, wind_speed_mps: 2, temperature_c: 22, humidity_percent: 50 }),
  env("ENV003", "Night Urban Plaza", "night", true,
    { ambient_lux: 3, sun_elevation_deg: -10, sun_azimuth_deg: 0, sky_turbidity: 2.0, fog_density: 0.0009, wind_speed_mps: 2, temperature_c: 17, humidity_percent: 60 }),
  env("ENV004", "Luxury Hotel Courtyard (Day)", "day", true,
    { ambient_lux: 16000, sun_elevation_deg: 52, sun_azimuth_deg: 120, sky_turbidity: 2.6, fog_density: 0.0002, wind_speed_mps: 1.5, temperature_c: 26, humidity_percent: 48 }),
  env("ENV005", "Luxury Hotel Courtyard (Night)", "night", true,
    { ambient_lux: 4, sun_elevation_deg: -10, sun_azimuth_deg: 0, sky_turbidity: 2.0, fog_density: 0.0007, wind_speed_mps: 1, temperature_c: 20, humidity_percent: 58 }),
  env("ENV006", "Large Public Square (Day)", "day", true,
    { ambient_lux: 24000, sun_elevation_deg: 62, sun_azimuth_deg: 160, sky_turbidity: 2.3, fog_density: 0.0003, wind_speed_mps: 4, temperature_c: 23, humidity_percent: 42 }),
  env("ENV007", "Large Public Square (Night)", "night", true,
    { ambient_lux: 5, sun_elevation_deg: -10, sun_azimuth_deg: 0, sky_turbidity: 2.1, fog_density: 0.0010, wind_speed_mps: 3, temperature_c: 16, humidity_percent: 62 }),
  env("ENV008", "Indoor Mall Atrium (Day)", "day", true,
    { ambient_lux: 450, sun_elevation_deg: 0, sun_azimuth_deg: 180, sky_turbidity: 1.8, fog_density: 0.0, wind_speed_mps: 0, temperature_c: 22, humidity_percent: 40 }),
  env("ENV009", "Indoor Mall Atrium (Night)", "night", true,
    { ambient_lux: 220, sun_elevation_deg: 0, sun_azimuth_deg: 180, sky_turbidity: 1.8, fog_density: 0.0, wind_speed_mps: 0, temperature_c: 22, humidity_percent: 42 }),
  env("ENV010", "Resort Lagoon (Day)", "day", true,
    { ambient_lux: 26000, sun_elevation_deg: 66, sun_azimuth_deg: 150, sky_turbidity: 3.0, fog_density: 0.0004, wind_speed_mps: 3, temperature_c: 30, humidity_percent: 70 }),
  env("ENV011", "Resort Lagoon (Night)", "night", true,
    { ambient_lux: 3, sun_elevation_deg: -10, sun_azimuth_deg: 0, sky_turbidity: 2.2, fog_density: 0.0011, wind_speed_mps: 2, temperature_c: 25, humidity_percent: 75 }),
  env("ENV012", "Desert Environment", "sunset", true,
    { ambient_lux: 11000, sun_elevation_deg: 6, sun_azimuth_deg: 260, sky_turbidity: 5.0, fog_density: 0.0002, wind_speed_mps: 6, temperature_c: 34, humidity_percent: 20 }),
  env("ENV013", "Mountain Environment", "day", true,
    { ambient_lux: 21000, sun_elevation_deg: 55, sun_azimuth_deg: 130, sky_turbidity: 2.0, fog_density: 0.0006, wind_speed_mps: 5, temperature_c: 12, humidity_percent: 55 }),
  env("ENV014", "Tropical Environment (Day)", "day", true,
    { ambient_lux: 23000, sun_elevation_deg: 70, sun_azimuth_deg: 170, sky_turbidity: 3.4, fog_density: 0.0008, wind_speed_mps: 3, temperature_c: 31, humidity_percent: 80 }),
  env("ENV015", "Tropical Environment (Night)", "night", true,
    { ambient_lux: 2, sun_elevation_deg: -10, sun_azimuth_deg: 0, sky_turbidity: 2.4, fog_density: 0.0013, wind_speed_mps: 2, temperature_c: 26, humidity_percent: 85 }),
  env("ENV016", "Waterfront Promenade (Day)", "day", true,
    { ambient_lux: 20000, sun_elevation_deg: 50, sun_azimuth_deg: 145, sky_turbidity: 2.8, fog_density: 0.0007, wind_speed_mps: 6, temperature_c: 21, humidity_percent: 65 }),
  env("ENV017", "Waterfront Promenade (Night)", "night", true,
    { ambient_lux: 4, sun_elevation_deg: -10, sun_azimuth_deg: 0, sky_turbidity: 2.2, fog_density: 0.0012, wind_speed_mps: 5, temperature_c: 18, humidity_percent: 70 }),
  env("ENV018", "Civic Plaza (Day)", "day", true,
    { ambient_lux: 19000, sun_elevation_deg: 48, sun_azimuth_deg: 135, sky_turbidity: 2.5, fog_density: 0.0004, wind_speed_mps: 3, temperature_c: 20, humidity_percent: 50 }),
  env("ENV019", "Civic Plaza (Night)", "night", true,
    { ambient_lux: 5, sun_elevation_deg: -10, sun_azimuth_deg: 0, sky_turbidity: 2.1, fog_density: 0.0009, wind_speed_mps: 2, temperature_c: 15, humidity_percent: 58 }),
  env("ENV020", "Studio Black Background", "controlled", false,
    { ambient_lux: 0.5, sun_elevation_deg: 0, sun_azimuth_deg: 0, sky_turbidity: 1.7, fog_density: 0.0, wind_speed_mps: 0, temperature_c: 20, humidity_percent: 50 }),
];

export const ENV_EDITABLE_FIELDS = [
  "name", "hdri", "sun_elevation_deg", "sun_azimuth_deg", "ambient_lux",
  "wind_speed_mps", "fog_density", "humidity_percent", "temperature_c",
];
