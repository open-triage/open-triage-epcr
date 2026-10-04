/* Isolated design prototype: the catalog is discovered from fictional agency records. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const base = window.AnalyticsDemo;
  const agencyId = "demo-agency";
  const names = { transported: "Transported", treated: "Treated on scene", referred: "Referred", high: "High", medium: "Medium", low: "Low" };
  const records = base.records.map((record, index) => ({
    ...record, agencyId,
    elements: {
      "Disposition": [names[record.disposition]],
      "Priority": [names[record.priority]],
      "Primary impression": [["Respiratory complaint", "Chest discomfort", "Injury", "General illness"][index % 4]],
      "Responding unit": [record.date < "2026-09-01" && index % 5 === 0 ? "Medic 09" : ["Medic 01", "Medic 02", "Medic 03"][index % 3]],
      "Care location": [["Home", "Public place", "Care facility"][index % 3]],
      "Procedures": index % 3 === 0 ? ["ECG", "Oxygen"] : index % 3 === 1 ? ["ECG"] : ["Monitoring"],
      ...(record.disposition === "transported" ? { "Destination": [["Central Hospital", "North Hospital", "Community Hospital"][index % 3]] } : {}),
      ...(index % 4 !== 0 ? { "Custom · Care pathway": [record.date < "2026-09-01" && index % 7 === 0 ? "Falls assessment" : ["Standard care", "Urgent assessment"][index % 2]] } : {}),
    },
  })).filter((record) => record.agencyId === agencyId);

  // Neither date selection nor active filters participate in catalog discovery.
  const catalog = new Map();
  for (const record of records) for (const [element, documented] of Object.entries(record.elements)) {
    const values = [...new Set(documented.filter((value) => value !== null && value !== ""))];
    if (!values.length) continue;
    if (!catalog.has(element)) catalog.set(element, { records: 0, values: new Map(), repeating: false });
    const entry = catalog.get(element);
    entry.records++;
    entry.repeating ||= values.length > 1;
    for (const value of values) entry.values.set(value, (entry.values.get(value) || 0) + 1);
  }
  const elementNames = [...catalog.keys()].sort((a, b) => a.localeCompare(b));
  const sortedValues = (element) => [...catalog.get(element).values.keys()].sort((a, b) => element === "Priority" ? ["High", "Medium", "Low"].indexOf(a) - ["High", "Medium", "Low"].indexOf(b) : a.localeCompare(b));
  let draft = { viz: "line", metric: "response", aggregation: "median", from: "2026-09-01", to: "2026-09-30", group: "Priority", grain: "week", filters: [{ field: "Disposition", values: ["Transported"] }] };
  let applied = clone(draft);
  let result;
  let catalogMode = "group", chosenElement = "Priority", filterElement = "Disposition", chosenValues = new Set();
  let dialogTrigger = null, toastTimer, resizeTimer;
  const DAY = 86400000;
  const date = (value) => new Date(value + "T00:00:00Z");
  const iso = (value) => value.toISOString().slice(0, 10);
  const shortDate = (value) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date(value));
  const period = (query) => `${shortDate(query.from)} ${query.from.slice(0, 4)} – ${shortDate(query.to)} ${query.to.slice(0, 4)}`;
  const continuous = (query) => ["response", "scene"].includes(query.metric);
  const metricElement = (query) => query.metric.startsWith("element:") ? query.metric.slice(8) : null;
  const metric = (query) => ({ response: "Response time", scene: "Time on scene", count: "Records" }[query.metric] || metricElement(query));
  const aggregationNames = { mean: "Mean", median: "Median", minimum: "Minimum", maximum: "Maximum", count: "Count", percentage: "Percentage" };
  const unit = (query) => continuous(query) ? "min" : query.aggregation === "percentage" ? "%" : "records";
  const measure = (query) => `${aggregationNames[query.aggregation]}${continuous(query) ? " " : " of "}${metric(query).toLowerCase()}`;
  const title = (query) => measure(query) + (query.group ? " by " + query.group.toLowerCase() : "");
  const filterText = (query) => query.filters.map((filter) => `${filter.field}: ${filter.values.join(" or ")}`).join(" · ") || "All records";
  const selectedRecords = (query) => records.filter((record) => record.date >= query.from && record.date <= query.to && query.filters.every((filter) => filter.values.some((value) => record.elements[filter.field]?.includes(value))));
  const format = (value) => value == null ? "—" : applied.aggregation === "count" ? value.toLocaleString("en-GB") : value.toFixed(1);

  function stats(items, query, options = {}) {
    if (!continuous(query)) {
      const element = metricElement(query);
      const valid = element ? items.filter((record) => record.elements[element]?.length) : items;
      const matches = options.matchValue !== undefined ? valid.filter((record) => record.elements[element].includes(options.matchValue)) : valid;
      const denominator = options.matchValue !== undefined ? valid.length : options.denominatorItems ? options.denominatorItems.length : items.length;
      const numerator = matches.length;
      const value = query.aggregation === "percentage" ? (denominator ? Math.round(numerator / denominator * 1000) / 10 : null) : numerator;
      return { value, count: items.length, valid: valid.length, missing: items.length - valid.length, numerator, denominator };
    }
    const values = items.map((record) => record[query.metric]).filter(Number.isFinite).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    let value = null;
    if (values.length) {
      if (query.aggregation === "mean") value = values.reduce((sum, entry) => sum + entry, 0) / values.length;
      else if (query.aggregation === "minimum") value = values[0];
      else if (query.aggregation === "maximum") value = values.at(-1);
      else value = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      value = Math.round(value * 10) / 10;
    }
    return { value, count: items.length, valid: values.length, missing: items.length - values.length, numerator: null, denominator: null };
  }

  function timeKey(day, grain) {
    if (grain === "day") return day;
    if (grain === "month") return day.slice(0, 7) + "-01";
    const current = date(day);
    return iso(new Date(current.getTime() - (current.getUTCDay() + 6) % 7 * DAY));
  }

  function timeBuckets(query) {
    const buckets = [];
    let cursor = date(timeKey(query.from, query.grain));
    while (iso(cursor) <= query.to) {
      const key = iso(cursor);
      const next = new Date(cursor);
      if (query.grain === "month") next.setUTCMonth(next.getUTCMonth() + 1);
      else next.setUTCDate(next.getUTCDate() + (query.grain === "week" ? 7 : 1));
      const from = key < query.from ? query.from : key;
      const end = iso(new Date(next.getTime() - DAY));
      const to = end > query.to ? query.to : end;
      const label = query.grain === "month" ? new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(cursor) : from === to ? shortDate(from) : from.slice(0, 7) === to.slice(0, 7) ? `${date(from).getUTCDate()}–${shortDate(to)}` : `${shortDate(from)}–${shortDate(to)}`;
      buckets.push({ key, label }); cursor = next;
    }
    return buckets;
  }

  function summarize(query) {
    const items = selectedRecords(query);
    const groupValues = query.group ? sortedValues(query.group).filter((value) => items.some((record) => record.elements[query.group]?.includes(value))) : ["All records"];
    if (query.group && items.some((record) => !record.elements[query.group]?.length)) groupValues.push("Not documented");
    const buckets = query.viz === "line" ? timeBuckets(query) : [];
    const series = groupValues.flatMap((name) => {
      const members = items.filter((record) => !query.group || (name === "Not documented" ? !record.elements[query.group]?.length : record.elements[query.group]?.includes(name)));
      const element = metricElement(query);
      const categories = element ? sortedValues(element).filter((value) => members.some((record) => record.elements[element]?.includes(value))) : [undefined];
      return categories.map((category) => {
        const label = category === undefined ? name : query.group ? `${name} · ${category}` : category;
        const rows = query.viz === "line" ? buckets.map((bucket) => ({ label: bucket.label, bucket: bucket.key, series: label, ...stats(members.filter((record) => timeKey(record.date, query.grain) === bucket.key), query, { matchValue: category, denominatorItems: items.filter((record) => timeKey(record.date, query.grain) === bucket.key) }) })) : [{ label, bucket: "", series: label, ...stats(members, query, { matchValue: category, denominatorItems: items }) }];
        return { name: label, rows };
      });
    });
    return { items, series, buckets, rows: series.flatMap((entry) => entry.rows), ...stats(items, query) };
  }

  function notify(message) { clearTimeout(toastTimer); $("toast").textContent = message; $("toast").hidden = false; toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4000); }
  function renderAggregation() {
    const options = continuous(draft) ? ["mean", "median", "minimum", "maximum"] : ["count", "percentage"];
    const changed = !options.includes(draft.aggregation);
    if (changed) draft.aggregation = continuous(draft) ? "median" : "count";
    $("aggregation").innerHTML = options.map((value) => `<option value="${value}"${draft.aggregation === value ? " selected" : ""}>${aggregationNames[value]}</option>`).join("");
    $("aggregation-help").textContent = continuous(draft) ? "Continuous values · minutes" : "Discrete values · count or percentage";
    if (changed) notify(`${aggregationNames[draft.aggregation]} selected for ${continuous(draft) ? "continuous" : "discrete"} values.`);
  }
  function validDates() { return !!draft.from && !!draft.to && draft.from <= draft.to && Number.isFinite(date(draft.from).getTime()) && Number.isFinite(date(draft.to).getTime()) && date(draft.to) - date(draft.from) <= 3660 * DAY; }
  function refreshDraft() {
    const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
    const valid = validDates();
    $("pending-notice").hidden = !dirty;
    $("control-status").textContent = !valid ? "Choose valid dates within a 10-year range" : dirty ? "Changes ready to apply" : "All choices applied";
    $("control-status").classList.toggle("invalid", !valid);
    $("generate").disabled = !valid;
    $("export-button").disabled = dirty || !result?.count;
    $("export-button").title = dirty ? "Apply your changes before exporting" : "Export the displayed result";
    $("time-controls").hidden = draft.viz !== "line";
    $("time-note").textContent = dirty ? "Update visualization to apply changes" : draft.grain === "week" ? "Record date · Weeks start Monday" : draft.grain === "month" ? "Record date · Calendar months" : "Record date · Calendar days";
    $("group-value").textContent = draft.group || "No grouping";
    $("group-help").textContent = `${catalog.size} recorded elements · All agency records`;
    document.querySelectorAll("[data-viz]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.viz === draft.viz)));
  }

  function renderFilters() {
    $("filter-count").textContent = draft.filters.length;
    $("filter-chips").innerHTML = draft.filters.map((filter, index) => `<div class="filter-chip"><button type="button" class="chip-edit" data-edit="${index}" aria-label="Edit ${esc(filter.field)} filter"><span>${esc(filter.field)}</span>${esc(filter.values.join(", "))}</button><button type="button" class="chip-remove" data-remove="${index}" aria-label="Remove ${esc(filter.field)} filter">×</button></div>`).join("");
    $("filter-chips").querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => { dialogTrigger = button; openValues(draft.filters[Number(button.dataset.edit)].field); }));
    $("filter-chips").querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => { draft.filters.splice(Number(button.dataset.remove), 1); renderFilters(); refreshDraft(); $("add-filter").focus(); }));
  }

  function renderCatalog() {
    const search = $("element-search").value.toLowerCase();
    const candidates = [...(catalogMode === "group" ? [""] : []), ...elementNames].filter((element) => (element || "No grouping").toLowerCase().includes(search));
    $("element-options").innerHTML = candidates.map((element) => {
      const entry = catalog.get(element);
      return `<label class="catalog-option"><input type="radio" name="element" value="${esc(element)}"${chosenElement === element ? " checked" : ""}><span><strong>${esc(element || "No grouping")}</strong><small>${entry ? `${entry.values.size} unique values · ${entry.records.toLocaleString("en-GB")} records${entry.repeating ? " · multiple values per record" : ""}` : "Combine all matching records"}</small></span></label>`;
    }).join("") || '<p class="no-options">No documented elements match your search.</p>';
    $("element-options").querySelectorAll("input").forEach((input) => input.addEventListener("change", () => { chosenElement = input.value; $("choose-element").disabled = false; }));
    $("choose-element").disabled = chosenElement === null;
  }

  function openCatalog(mode, trigger) {
    catalogMode = mode; dialogTrigger = trigger;
    chosenElement = mode === "group" ? draft.group : null;
    $("catalog-title").textContent = mode === "group" ? "Group by an element" : "Filter by an element";
    $("catalog-scope").textContent = `${catalog.size} documented elements across ${records.length.toLocaleString("en-GB")} agency records · All dates`;
    $("choose-element").textContent = mode === "group" ? "Use element" : "Choose values";
    $("element-search").value = ""; renderCatalog(); $("catalog-dialog").showModal();
  }

  function renderValues() {
    const search = $("value-search").value.toLowerCase();
    const entry = catalog.get(filterElement);
    const values = sortedValues(filterElement).filter((value) => value.toLowerCase().includes(search));
    $("value-options").innerHTML = values.map((value) => `<label><input type="checkbox" value="${esc(value)}"${chosenValues.has(value) ? " checked" : ""}><span>${esc(value)}</span><span class="value-count">${entry.values.get(value).toLocaleString("en-GB")} records</span></label>`).join("") || '<p class="no-options">No recorded values match your search.</p>';
    $("value-options").querySelectorAll("input").forEach((input) => input.addEventListener("change", () => { if (input.checked) chosenValues.add(input.value); else chosenValues.delete(input.value); $("apply-filter").disabled = !chosenValues.size; }));
    $("apply-filter").disabled = !chosenValues.size;
  }

  function openValues(element) {
    filterElement = element;
    chosenValues = new Set(draft.filters.find((filter) => filter.field === element)?.values || []);
    $("values-title").textContent = `Filter ${element.toLowerCase()}`;
    $("values-scope").textContent = `${catalog.get(element).values.size} unique documented values · All agency records · All dates`;
    $("value-search").value = ""; renderValues(); $("values-dialog").showModal();
  }

  const paints = ["var(--green)", "#3d6988", "#8a6038", "#755995", "#567541", "#994963"];
  const dash = (index) => ["", "7 4", "2 4", "9 3 2 3"][index % 4];
  const color = (index) => paints[index % paints.length];
  const text = (x, y, content, extra = "") => `<text x="${x}" y="${y}" ${extra}>${esc(content)}</text>`;
  function renderPlot() {
    if (!result.count) return;
    const container = $("visualization");
    const W = Math.max(310, container.clientWidth, applied.viz === "bar" ? result.rows.length * 150 + 80 : 0), H = Math.max(240, container.clientHeight);
    const left = 42, right = 24, top = 32, bottom = 49, pw = W - left - right, ph = H - top - bottom;
    const rows = result.rows;
    const max = Math.max(1, ...rows.map((row) => row.value || 0));
    const step = applied.aggregation === "percentage" ? 20 : max <= 12 ? 2 : max <= 30 ? 5 : max <= 100 ? 20 : max <= 300 ? 50 : Math.ceil(max / 1000) * 200;
    const maxY = applied.aggregation === "percentage" ? 100 : Math.ceil(max / step) * step;
    const y = (value) => top + ph - value / maxY * ph;
    let svg = `<title>${esc(title(applied))}</title><desc>${esc(rows.map((row) => `${row.series}, ${row.label}: ${format(row.value)}`).join("; "))}</desc>`;
    svg += text(left, 14, continuous(applied) ? "Minutes" : applied.aggregation === "percentage" ? "Percent" : "Records", 'class="axis-title"');
    for (let tick = 0; tick <= maxY; tick += step) svg += `<line class="gridline" x1="${left}" x2="${W - right}" y1="${y(tick)}" y2="${y(tick)}"/>` + text(left - 14, y(tick) + 4, tick, 'text-anchor="end"');
    if (applied.viz === "line") {
      const buckets = result.buckets;
      const x = (index) => left + pw * (buckets.length === 1 ? .5 : index / (buckets.length - 1));
      result.series.forEach((series, seriesIndex) => {
        let d = "", active = false;
        series.rows.forEach((row, index) => { if (row.value === null) { active = false; return; } d += `${active ? "L" : "M"}${x(index)},${y(row.value)} `; active = true; });
        svg += `<path d="${d}" fill="none" stroke="${color(seriesIndex)}" stroke-width="2.5" stroke-dasharray="${dash(seriesIndex)}"/>`;
        series.rows.forEach((row, index) => { if (row.value === null) return; svg += `<circle cx="${x(index)}" cy="${y(row.value)}" r="${buckets.length > 12 ? 2.5 : 4}" fill="white" stroke="${color(seriesIndex)}" stroke-width="2"><title>${esc(series.name)} · ${esc(row.label)}: ${format(row.value)}; ${row.valid} records with values</title></circle>`; });
      });
      const n = Math.min(buckets.length, 9, Math.max(2, Math.floor(pw / 95)));
      const indexes = new Set(Array.from({ length: n }, (_, index) => n === 1 ? 0 : Math.round(index * (buckets.length - 1) / (n - 1))));
      buckets.forEach((bucket, index) => { if (indexes.has(index)) svg += text(x(index), H - 20, bucket.label, `text-anchor="${index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle"}"`); });
    } else {
      const slot = pw / rows.length;
      rows.forEach((row, index) => {
        const at = left + slot * (index + .5), width = Math.min(100, slot * .6);
        if (row.value !== null) svg += `<rect x="${at - width / 2}" y="${y(row.value)}" width="${width}" height="${y(0) - y(row.value)}" rx="3" fill="var(--green)"><title>${esc(row.series)}: ${format(row.value)}</title></rect>` + text(at, y(row.value) - 12, format(row.value), 'text-anchor="middle" class="value-label"');
        svg += text(at, H - 20, row.series, 'text-anchor="middle"');
      });
    }
    container.innerHTML = `<svg class="chart" style="min-width:${W}px" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title(applied))}">${svg}</svg>`;
  }

  function renderResult() {
    result = summarize(applied);
    $("chart-kind").textContent = `${applied.viz === "table" ? "Table" : applied.viz + " chart"}`.toUpperCase();
    $("applied-group").textContent = applied.group || "No grouping";
    $("result-title").textContent = title(applied);
    $("result-context").textContent = `${period(applied)} · ${filterText(applied)}`;
    $("overall-value").innerHTML = `${format(result.value)} <span>${unit(applied)}</span>`;
    $("overall-caption").textContent = continuous(applied) ? `${aggregationNames[applied.aggregation]} across matching records` : metricElement(applied) ? "Records with a documented value" : "All matching records";
    $("population-count").textContent = `${result.count.toLocaleString("en-GB")} matching records`;
    $("missing-count").textContent = `${result.valid.toLocaleString("en-GB")} with values · ${result.missing} missing`;
    $("chart-description").textContent = applied.aggregation === "percentage" ? metricElement(applied) ? "Percentage of records with a value in each group and time bucket" : "Percentage of matching records in each time bucket" : continuous(applied) ? `Missing values excluded from the ${aggregationNames[applied.aggregation].toLowerCase()}` : "One count per record per distinct value";
    if (catalog.get(applied.group)?.repeating || catalog.get(metricElement(applied))?.repeating) $("chart-description").textContent += " · Records may contribute to multiple categories";
    $("chart-legend").hidden = applied.viz !== "line" || !result.count;
    $("chart-legend").innerHTML = result.series.map((series, index) => `<span class="legend-item"><svg viewBox="0 0 23 10" aria-hidden="true"><path d="M0 5H23" stroke="${color(index)}" stroke-width="2.5" stroke-dasharray="${dash(index)}"/></svg>${esc(series.name)}</span>`).join("");
    refreshDraft();
    if (!result.count) $("visualization").innerHTML = '<div class="empty-state"><strong>No matching records</strong><p>Change the dates or remove a filter.</p></div>';
    else if (applied.viz === "table") $("visualization").innerHTML = `<table class="data-table"><thead><tr><th>${esc(metricElement(applied) ? "Category" : applied.group || "Group")}</th><th>${esc(measure(applied))} (${unit(applied)})</th><th>Records</th><th>Missing</th></tr></thead><tbody>${result.rows.map((row) => `<tr><td>${esc(row.series)}</td><td>${format(row.value)}</td><td>${row.count}</td><td>${row.missing}</td></tr>`).join("")}</tbody></table>`;
    else { renderPlot(); requestAnimationFrame(renderPlot); }
  }

  function openExport() {
    $("export-context").textContent = `${title(applied)} · ${period(applied)} · ${filterText(applied)}`;
    $("aggregate-detail").textContent = `${result.rows.length} rows · ${applied.viz === "line" ? "time buckets and groups" : "groups"}, counts and missing values`;
    $("record-detail").textContent = `${result.count.toLocaleString("en-GB")} rows · one per matching record`;
    $("export-dialog").showModal();
  }

  function download(recordLevel) {
    const headers = recordLevel ? ["Demo record ID", "Date", "Response time (min)", "Time on scene (min)", ...elementNames] : ["Group", "Time bucket", "Value", "Unit", "Records", "Valid values", "Missing", "Numerator", "Denominator"];
    const rows = recordLevel ? result.items.map((record) => [record.id, record.date, record.response, record.scene, ...elementNames.map((element) => JSON.stringify(record.elements[element] || []))]) : result.rows.map((row) => [row.series, row.label, row.value, unit(applied), row.count, row.valid, row.missing, row.numerator, row.denominator]);
    const context = [metric(applied), aggregationNames[applied.aggregation], applied.from, applied.to, filterText(applied), applied.group || "No grouping", applied.viz === "line" ? applied.grain : "", "Fictional agency records"];
    const csv = base.csv([...headers, "Metric", "Aggregation", "From", "Through", "Filters", "Grouping", "Time grouping", "Data source"], rows.map((row) => [...row, ...context]));
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `opentriage-analytics-${recordLevel ? "records" : "aggregate"}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); $("export-dialog").close(); notify(`Downloaded ${rows.length} fictional ${recordLevel ? "record" : "aggregate"} rows.`);
  }

  document.querySelectorAll("[data-viz]").forEach((button) => button.addEventListener("click", () => { draft.viz = button.dataset.viz; refreshDraft(); }));
  $("metric").addEventListener("change", (event) => { draft.metric = event.target.value; renderAggregation(); refreshDraft(); });
  $("aggregation").addEventListener("change", (event) => { draft.aggregation = event.target.value; refreshDraft(); });
  for (const key of ["from", "to"]) $("date-" + key).addEventListener("change", (event) => { draft[key] = event.target.value; refreshDraft(); });
  $("time-group").addEventListener("change", (event) => { draft.grain = event.target.value; refreshDraft(); });
  $("query-form").addEventListener("submit", (event) => { event.preventDefault(); if (!validDates()) return; applied = clone(draft); renderResult(); });
  $("group-button").addEventListener("click", (event) => openCatalog("group", event.currentTarget));
  $("add-filter").addEventListener("click", (event) => openCatalog("filter", event.currentTarget));
  $("element-search").addEventListener("input", renderCatalog);
  $("value-search").addEventListener("input", renderValues);
  $("catalog-form").addEventListener("submit", (event) => {
    event.preventDefault(); if (chosenElement === null) return;
    $("catalog-dialog").close();
    if (catalogMode === "group") { draft.group = chosenElement; refreshDraft(); }
    else openValues(chosenElement);
  });
  $("values-form").addEventListener("submit", (event) => {
    event.preventDefault(); if (!chosenValues.size) return;
    draft.filters = draft.filters.filter((filter) => filter.field !== filterElement);
    draft.filters.push({ field: filterElement, values: [...chosenValues].sort() });
    $("values-dialog").close(); renderFilters(); refreshDraft(); $("add-filter").focus();
  });
  document.querySelectorAll(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  for (const id of ["catalog-dialog", "values-dialog"]) $(id).addEventListener("close", () => { if (dialogTrigger?.isConnected && !document.querySelector("dialog[open]")) dialogTrigger.focus(); });
  $("export-button").addEventListener("click", openExport);
  $("export-aggregate").addEventListener("click", () => download(false));
  $("export-records").addEventListener("click", () => download(true));
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderResult, 100); });
  // Exposed only to make the fictional data source inspectable during design review.
  window.AnalyticsWorkspaceDemo = { records, catalog, summarize };
  function selectWorkspace(mode) {
    ["review", "analytics"].forEach((name) => {
      $(name + "-tab").setAttribute("aria-selected", String(name === mode));
      $(name + "-tab").tabIndex = name === mode ? 0 : -1;
      $(name + "-panel").hidden = name !== mode;
    });
    if (mode === "analytics") renderResult();
  }
  ["review", "analytics"].forEach((mode) => {
    $(mode + "-tab").addEventListener("click", () => selectWorkspace(mode));
    $(mode + "-tab").addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const next = event.key === "Home" ? "review" : event.key === "End" ? "analytics" : mode === "review" ? "analytics" : "review";
      selectWorkspace(next); $(next + "-tab").focus();
    });
  });
  renderAggregation(); renderFilters(); renderResult();
})();
