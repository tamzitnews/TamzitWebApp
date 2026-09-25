// Sunset and nightfall from the NOAA solar position equations (public-domain algorithm, our own
// implementation). Used only as an offline fallback for plain Shabbat times when the server's
// app_rest_periods have not been downloaded yet; accurate to about a minute at inhabited latitudes.

const RAD = Math.PI / 180;
const sin = (d: number) => Math.sin(d * RAD);
const cos = (d: number) => Math.cos(d * RAD);
const tan = (d: number) => Math.tan(d * RAD);

/** Julian day at 0h UT of a civil date. */
function julianDay(y: number, m: number, d: number) {
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

/** Solar declination (degrees) and equation of time (minutes) at a Julian day. */
function sunAt(jd: number) {
  const t = (jd - 2451545) / 36525;
  const l0 = (((280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sin(2 * m) * (0.019993 - 0.000101 * t) + sin(3 * m) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * sin(omega);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cos(omega);
  const decl = Math.asin(sin(eps) * sin(lambda)) / RAD;
  const y = tan(eps / 2) ** 2;
  const eqTime =
    (4 / RAD) *
    (y * sin(2 * l0) - 2 * e * sin(m) + 4 * e * y * sin(m) * cos(2 * l0) - 0.5 * y * y * sin(4 * l0) - 1.25 * e * e * sin(2 * m));
  return { decl, eqTime };
}

/**
 * The evening moment on a civil date (in the place's own calendar) when the sun's centre is
 * `depression` degrees below the horizon. Sunset uses 0.833° (refraction + solar radius).
 * Returns null when it never happens that day (polar regions).
 */
export function eveningAt(ymd: string, lat: number, lon: number, depression: number): Date | null {
  const [y, m, d] = ymd.split('-').map(Number);
  const jd0 = julianDay(y, m, d);
  const zenith = 90 + depression;
  // First guess: local solar evening; then refine at the computed moment.
  let minutes = 720 - 4 * lon + 360;
  for (let i = 0; i < 3; i++) {
    const { decl, eqTime } = sunAt(jd0 + minutes / 1440);
    const cosH = (cos(zenith) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl));
    if (cosH < -1 || cosH > 1) return null;
    const hourAngle = Math.acos(cosH) / RAD;
    minutes = 720 - 4 * lon - eqTime + 4 * hourAngle;
  }
  return new Date(Date.UTC(y, m - 1, d) + minutes * 60_000);
}

/** Sunset (0.833° below the horizon). */
export const sunsetAt = (ymd: string, lat: number, lon: number) => eveningAt(ymd, lat, lon, 0.833);
