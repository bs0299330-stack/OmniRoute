// Alfred — looks after the user: suggests rest late at night and water on hot days. Each reminder
// comes rarely (rest at most every two hours, water once a day), so he cares without nagging.

/** Late at night: from 23:00 to 04:59. */
export const isLate = (date) => date.getHours() >= 23 || date.getHours() < 5;

const HOT = 32; // °C
/** Weather data from weblite (`{ current: { temp }, day: { max } }`) that calls for water. */
export const isHot = (w) => Number(w?.day?.max ?? -99) >= HOT || Number(w?.current?.temp ?? -99) >= HOT;

export const REST_LINE = "E já é tarde, mestre. Não seria hora de descansar?";
export const WATER_LINE = "Com esse calor, mestre, não se esqueça de beber água.";

/**
 * Keeps track of what was already said. `note({ weather })` returns the caring line to add after
 * Alfred's answer, or "".
 */
export function createCare({ now = () => new Date() } = {}) {
  let lastRest = 0;
  let waterDay = "";
  return {
    note({ weather = null } = {}) {
      const at = now();
      if (weather && isHot(weather) && waterDay !== at.toDateString()) {
        waterDay = at.toDateString();
        return WATER_LINE;
      }
      if (isLate(at) && at.getTime() - lastRest >= 2 * 3600_000) {
        lastRest = at.getTime();
        return REST_LINE;
      }
      return "";
    },
  };
}
