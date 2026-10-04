/* Deterministic fictional data. This prototype never requests patient records. */
(function () {
  "use strict";

  
  const round = (value) => Math.round(value * 10) / 10;
  const asDate = (value) => new Date(value + "T00:00:00Z");
  const noise = (seed) => {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  };

  function makeMonth(month, days, total, transported, treated) {
    const first = asDate("2026-" + month + "-01");
    const offset = (first.getUTCDay() + 6) % 7;
    return Array.from({ length: total }, (_, index) => {
      const day = (index % days) + 1;
      const week = Math.floor((day - 1 + offset) / 7);
      const seed = index + Number(month) * 2000;
      const draw = noise(seed + 19);
      const priority = draw < 0.19 ? "high" : draw < 0.58 ? "medium" : "low";
      const disposition = index < transported ? "transported" : index < transported + treated ? "treated" : "referred";
      const responseBase = [7.4, 8.2, 9.4, 8.7, 7.8, 8.3][week];
      const priorityOffset = priority === "high" ? -0.4 : priority === "low" ? 0.3 : 0;
      const missingResponse = month === "09" ? index < 23 : index < 19;
      return Object.freeze({
        id: "DEMO-2026" + month + "-" + String(index + 1).padStart(4, "0"),
        date: "2026-" + month + "-" + String(day).padStart(2, "0"),
        disposition,
        priority,
        response: missingResponse ? null : round(responseBase + (noise(seed) - 0.5) * 2.8 + priorityOffset + (month === "08" ? 0.5 : 0)),
        scene: index % 83 === 0 ? null : round([19.3, 20.5, 22.2, 21, 19.8, 20][week] + (noise(seed + 71) - 0.5) * 8 + (disposition === "transported" ? 2 : -1)),
      });
    });
  }

  const records = Object.freeze([
    ...makeMonth("08", 31, 912, 665, 171),
    ...makeMonth("09", 30, 1000, 742, 181),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));

  // Rows may be arrays or objects keyed by header. All cells are quoted; string formulas are escaped.
  function csv(headers, rows) {
    const cell = (value) => {
      let text = value == null ? "" : String(value);
      if (typeof value === "string" && /^\s*[=+\-@]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    return [headers, ...rows.map((row) => Array.isArray(row) ? row : headers.map((header) => row[header]))]
      .map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
  }

  window.AnalyticsDemo = Object.freeze({ records, csv });
}());
