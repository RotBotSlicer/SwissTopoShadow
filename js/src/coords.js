// LV95 <-> WGS84 nach den Näherungsformeln von swisstopo (Genauigkeit ~1 m; für Sonnenstand
// und Kartenanzeige mehr als ausreichend).
export function lv95ToWgs84(E, N) {
  const y = (E - 2600000) / 1e6, x = (N - 1200000) / 1e6;
  const lam = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3;
  const phi = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x ** 3;
  return { lat: phi * 100 / 36, lon: lam * 100 / 36 };
}

export function wgs84ToLv95(lat, lon) {
  const p = (lat * 3600 - 169028.66) / 10000, l = (lon * 3600 - 26782.5) / 10000;
  return {
    E: 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3,
    N: 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3,
  };
}

// ------------------------------------------------------------------ Projektionen
// Eine Projektion ist ein Objekt { name, toLatLon(E, N) -> {lat, lon}, fromLatLon(lat, lon) -> {E, N} }.
// Gerechnet wird immer in einem ebenen Metergitter; nur die Projektion unterscheidet Schweiz und Welt.

/** Schweiz: LV95 (swisstopo-Näherungsformeln). */
export const LV95 = Object.freeze({ name: 'LV95', toLatLon: lv95ToWgs84, fromLatLon: wgs84ToLv95 });

const A_WGS = 6378137, F_WGS = 1 / 298.257223563;
/**
 * Weltweit: lokale Transversale Mercator (WGS84, Massstab 1) mit Mittelmeridian lon0 und Ursprung (lat0, lon0)
 * = (0, 0). Krüger-Reihen nach Karney (2011), Genauigkeit << 1 mm innerhalb einiger 100 km.
 */
export function localTM(lat0, lon0) {
  const n = F_WGS / (2 - F_WGS), n2 = n * n, n3 = n2 * n;
  const A = A_WGS / (1 + n) * (1 + n2 / 4 + n2 * n2 / 64);
  const e = 2 * Math.sqrt(n) / (1 + n);
  const al = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16, 13 * n2 / 48 - 3 * n3 / 5, 61 * n3 / 240];
  const be = [n / 2 - 2 * n2 / 3 + 37 * n3 / 96, n2 / 48 + n3 / 15, 17 * n3 / 480];
  const de = [2 * n - 2 * n2 / 3 - 2 * n3, 7 * n2 / 3 - 8 * n3 / 5, 56 * n3 / 15];
  const D = Math.PI / 180;
  const fwd = (lat, lon) => {
    const phi = lat * D, dl = (lon - lon0) * D, s = Math.sin(phi);
    const t = Math.sinh(Math.atanh(s) - e * Math.atanh(e * s));
    const xi = Math.atan2(t, Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
    let x = eta, y = xi;
    for (let j = 1; j <= 3; j++) { x += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); y += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); }
    return { E: A * x, N: A * y };
  };
  const N0 = fwd(lat0, lon0).N;
  return Object.freeze({
    name: `TM(${lat0.toFixed(4)},${lon0.toFixed(4)})`, lat0, lon0,
    fromLatLon(lat, lon) { const p = fwd(lat, lon); return { E: p.E, N: p.N - N0 }; },
    toLatLon(E, N) {
      const xi = (N + N0) / A, eta = E / A;
      let xp = xi, ep = eta;
      for (let j = 1; j <= 3; j++) { xp -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); ep -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
      const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
      let phi = chi;
      for (let j = 1; j <= 3; j++) phi += de[j - 1] * Math.sin(2 * j * chi);
      return { lat: phi / D, lon: lon0 + Math.atan2(Math.sinh(ep), Math.cos(xp)) / D };
    },
  });
}

/** Gitterazimut [°] von geografisch Nord am Ort (E, N) – Meridiankonvergenz (Vorzeichen: Azimut_Gitter = Azimut_geo + g). */
export function gridBearingOfNorth(E, N, d = 0.001, proj = LV95) {
  const { lat, lon } = proj.toLatLon(E, N);
  const a = proj.fromLatLon(lat, lon), b = proj.fromLatLon(lat + d, lon);
  return Math.atan2(b.E - a.E, b.N - a.N) * 180 / Math.PI;
}
