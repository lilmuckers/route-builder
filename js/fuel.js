/**
 * Citroën app fuel export: tab-delimited, columns:
 * date | time of departure | time of arrival | time (hr:min) |
 * address of departure | destination address | distance (mi) |
 * mileage on odometer (mi) | avg. consumption (mpg) |
 * price of fuel (GBP/l) | cost (GBP) | category
 */

export function parseFuelCSV(text) {
  const lines = text.trim().split('\n');
  const trips = [];

  for (const line of lines) {
    const cols = line.split('\t').map(c => c.trim());
    if (cols.length < 11) continue;

    const [
      date, depTime, arrTime, duration,
      depAddr, destAddr, distMi, odometer,
      mpg, fuelPricePL, costGBP, category,
    ] = cols;

    const mpgNum = parseFloat(mpg);
    if (isNaN(mpgNum)) continue;

    const departureTs = parseDateTime(date, depTime);
    const arrivalTs = parseDateTime(date, arrTime);
    if (!departureTs) continue;

    const distMiNum = parseFloat(distMi);
    const litersUsed = distMiNum > 0 && mpgNum > 0
      ? (distMiNum / mpgNum) * 4.54609
      : null;

    trips.push({
      date,
      departureTs,
      arrivalTs,
      depAddr,
      destAddr,
      distanceMi: distMiNum,
      odometerMi: parseFloat(odometer),
      mpg: mpgNum,
      fuelPricePerLiter: parseFloat(fuelPricePL),
      costGBP: parseFloat(costGBP),
      category,
      litersUsed,
    });
  }

  return trips;
}

function parseDateTime(date, time) {
  if (!date || !time) return null;
  // date formats: DD/MM/YYYY or YYYY-MM-DD
  let iso;
  if (date.includes('/')) {
    const [d, m, y] = date.split('/');
    iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  } else {
    iso = date;
  }
  const ts = Date.parse(`${iso}T${time}`);
  return isNaN(ts) ? null : ts;
}

export function matchFuelToRoute(route, fuelTrips) {
  const routeStart = route.points[0]?.gpsTimestamp;
  const routeEnd = route.points[route.points.length - 1]?.gpsTimestamp;
  if (!routeStart || !routeEnd) return [];

  return fuelTrips.filter(trip => {
    const depTs = trip.departureTs;
    const arrTs = trip.arrivalTs ?? depTs + 3600000;
    return depTs < routeEnd && arrTs > routeStart;
  });
}

export function buildEfficiencySegments(route, matchedTrips) {
  if (!matchedTrips.length) return [];

  const allMpg = matchedTrips.map(t => t.mpg);
  const minMpg = Math.min(...allMpg);
  const maxMpg = Math.max(...allMpg);

  return matchedTrips.map(trip => {
    const depTs = trip.departureTs;
    const arrTs = trip.arrivalTs ?? depTs + 3600000;

    const segment = route.points.filter(
      p => p.gpsTimestamp >= depTs && p.gpsTimestamp <= arrTs
    );

    if (!segment.length) return null;

    const t = maxMpg === minMpg ? 0.7 : (trip.mpg - minMpg) / (maxMpg - minMpg);
    const hue = Math.round(t * 120);
    const color = `hsl(${hue},90%,50%)`;

    return { trip, segment, color, minMpg, maxMpg };
  }).filter(Boolean);
}
