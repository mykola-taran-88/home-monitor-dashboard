const API = "https://smart-home-api-v2.mykola-taran-88.workers.dev/api/v1",
  $ = (x) => document.getElementById(x),
  state = {
    overview: null,
    dash: null,
    score: null,
    power: null,
    climate: null,
    charts: {},
    token: sessionStorage.getItem("hmAdmin") || "",
    mode: localStorage.getItem("hmMode") || "eco",
    timer: null,
    loading: false,
    admin: { channels: [], overrides: [], categories: [] },
    periods: { power: "day", climate: "day", energy: "day" },
    loadedTabs: new Set(["home"]),
    timelineItems: [],
    timelineFilter: "all",
    weatherMetric: "temperature",
    chartMetrics: {
      power: "power",
      climate: "tempHumidity",
      voltage: "energyCost",
    },
    requestCache: new Map(),
    activeRequests: new Map(),
    climateHidden: {},
    climateShowArchive: false,
    climateSelectedRooms: [],
    climateSelectionInitialized: false,
    climateOverlayEnabled: false,
    climatePlanRoom: null,
    floorPlanMetric: "temperature",
    tariffRange: null,
    homeEnergy24: null,
    homeClimate24: null,
    deviceStatus: null,
    energySeries: null,
    energyTariffSettings: { day_start: "07:00", night_start: "23:00" },
    chartHours: { power: 168, energy: 168, climate: 168 },
    smartPeriods: { energy: "week", energy2: "week", climate: "week" },
    rangeSeries: { energy: null, energy2: null },
  };
const setHTML = (id, value) => {
    const el = $(id);
    if (el) el.innerHTML = value;
    return el;
  },
  setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
    return el;
  },
  timeValue = (v) => {
    const s = String(v ?? "").trim();
    if (!s) return "";
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{1,2}$/.test(s)) return s.padStart(2, "0") + ":00";
    const m = s.match(/(\d{1,2}):(\d{2})/);
    return m ? m[1].padStart(2, "0") + ":" + m[2] : "";
  };
const fmt = (v, d = 1) =>
    v == null || isNaN(+v)
      ? "—"
      : Number(v).toLocaleString("uk-UA", { maximumFractionDigits: d }),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const kyivPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function kyivParts(timestamp) {
  return Object.fromEntries(
    kyivPartsFormatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function kyivWallTime({ year, month, day, hour = 0, minute = 0 }) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const local = kyivParts(guess);
    guess +=
      target -
      Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
      );
  }
  return guess;
}

function chartLabelTimestamp(value, now = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const label = String(value ?? "").trim();
  if (!label) return NaN;
  const today = kyivParts(now);
  const relative = label.match(/^(Сьогодні|Завтра)\s+(\d{1,2}):(\d{2})/i);
  if (relative) {
    const offset = relative[1].toLowerCase() === "завтра" ? 1 : 0;
    const date = new Date(
      Date.UTC(today.year, today.month - 1, today.day + offset),
    );
    return kyivWallTime({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: Number(relative[2]),
      minute: Number(relative[3]),
    });
  }
  const dateTime = label.match(
    /(?:^|\D)(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?[, ]+(\d{1,2}):(\d{2})/,
  );
  if (dateTime)
    return kyivWallTime({
      day: Number(dateTime[1]),
      month: Number(dateTime[2]),
      year: Number(dateTime[3]) || today.year,
      hour: Number(dateTime[4]),
      minute: Number(dateTime[5]),
    });
  const normalized = label.includes("T") ? label : label.replace(" ", "T");
  const parsed = Date.parse(
    /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : normalized + "Z",
  );
  return Number.isFinite(parsed) ? parsed : NaN;
}

function chartTimeline(chart) {
  const scale = chart.scales.x;
  if (!scale || !chart.chartArea) return null;
  if (scale.type === "linear" || scale.type === "time") {
    const start = Number(scale.min);
    const end = Number(scale.max);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return null;
    return {
      start,
      end,
      xAt: (timestamp) => scale.getPixelForValue(timestamp),
    };
  }
  const entries = (chart.data.labels || [])
    .map((label, index) => ({ index, timestamp: chartLabelTimestamp(label) }))
    .filter((entry) => Number.isFinite(entry.timestamp));
  if (entries.length < 2) return null;
  return {
    start: entries[0].timestamp,
    end: entries.at(-1).timestamp,
    xAt(timestamp) {
      let right = entries.findIndex((entry) => entry.timestamp >= timestamp);
      if (right < 0) right = entries.length - 1;
      if (right === 0) return scale.getPixelForValue(entries[0].index);
      const before = entries[right - 1];
      const after = entries[right];
      const span = after.timestamp - before.timestamp;
      const ratio = span > 0 ? (timestamp - before.timestamp) / span : 0;
      return scale.getPixelForValue(before.index + ratio);
    },
  };
}

function kyivCalendarDates(start, end) {
  const first = kyivParts(start);
  const last = kyivParts(end);
  const cursor = new Date(Date.UTC(first.year, first.month - 1, first.day - 1));
  const finish = Date.UTC(last.year, last.month - 1, last.day + 1);
  const dates = [];
  for (let stamp = cursor.getTime(); stamp <= finish; stamp += 86400000) {
    const date = new Date(stamp);
    dates.push({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  }
  return dates;
}

function timeAxisTicks(start, end, width) {
  const rangeHours = Math.max(1, (end - start) / 3600000);
  const slots = Math.max(3, Math.floor(width / 60));
  const targetHours = rangeHours / slots;
  const intervals = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168, 336, 720, 2160];
  const intervalHours = intervals.find((hours) => hours >= targetHours) || 2160;
  const values = [start, end];
  const dates = kyivCalendarDates(start, end);

  if (intervalHours < 24) {
    for (const date of dates) {
      for (let hour = 0; hour < 24; hour += intervalHours) {
        const stamp = kyivWallTime({ ...date, hour });
        if (stamp > start && stamp < end) values.push(stamp);
      }
    }
  } else {
    const dayStep = Math.max(1, Math.round(intervalHours / 24));
    for (let index = 0; index < dates.length; index += 1) {
      if (index % dayStep !== 0) continue;
      const stamp = kyivWallTime(dates[index]);
      if (stamp > start && stamp < end) values.push(stamp);
    }
  }

  const ordered = [...new Set(values)].sort((a, b) => a - b);
  const chartWidth = Math.max(120, Number(width) || 500);
  const minimumGap = ((end - start) * 58) / chartWidth;
  const ticks = [start];
  for (const value of ordered.slice(1, -1)) {
    if (
      value - ticks[ticks.length - 1] >= minimumGap &&
      end - value >= minimumGap
    ) {
      ticks.push(value);
    }
  }
  ticks.push(end);
  return ticks;
}

const chartDayMarkers = {
  id: "chartDayMarkers",
  beforeDatasetsDraw(chart, _args, options) {
    if (!options?.tariffBands) return;
    const timeline = chartTimeline(chart);
    if (!timeline) return;
    const settings = state.energyTariffSettings || {};
    const toMinutes = (value, fallback) => {
      const match = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
      return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
    };
    const dayStart = toMinutes(settings.day_start, "07:00");
    const nightStart = toMinutes(settings.night_start, "23:00");
    const boundaries = [timeline.start, timeline.end];
    for (const date of kyivCalendarDates(timeline.start, timeline.end)) {
      boundaries.push(kyivWallTime(date));
      boundaries.push(
        kyivWallTime({
          ...date,
          hour: Math.floor(dayStart / 60),
          minute: dayStart % 60,
        }),
        kyivWallTime({
          ...date,
          hour: Math.floor(nightStart / 60),
          minute: nightStart % 60,
        }),
      );
    }
    const points = [...new Set(boundaries)]
      .filter((stamp) => stamp >= timeline.start && stamp <= timeline.end)
      .sort((a, b) => a - b);
    const { ctx, chartArea } = chart;
    ctx.save();
    for (let i = 0; i < points.length - 1; i++) {
      const leftTime = points[i];
      const rightTime = points[i + 1];
      const midpoint = kyivParts(leftTime + (rightTime - leftTime) / 2);
      const minuteOfDay = midpoint.hour * 60 + midpoint.minute;
      const isDay =
        dayStart < nightStart
          ? minuteOfDay >= dayStart && minuteOfDay < nightStart
          : minuteOfDay >= dayStart || minuteOfDay < nightStart;
      const left = Math.max(chartArea.left, timeline.xAt(leftTime));
      const right = Math.min(chartArea.right, timeline.xAt(rightTime));
      if (right <= left) continue;
      ctx.fillStyle = isDay
        ? "rgba(88, 225, 255, 0.055)"
        : "rgba(113, 92, 255, 0.075)";
      ctx.fillRect(
        left,
        chartArea.top,
        right - left,
        chartArea.bottom - chartArea.top,
      );
      if (right - left >= 54) {
        ctx.fillStyle = isDay ? "#9cecff99" : "#c2b8ff99";
        ctx.font = "600 10px Inter,system-ui,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(
          isDay ? "День" : "Ніч",
          (left + right) / 2,
          chartArea.top + 4,
        );
      }
    }
    ctx.restore();
  },
  afterDatasetsDraw(chart) {
    const timeline = chartTimeline(chart);
    if (!timeline) return;
    const { ctx, chartArea } = chart;
    const midnights = kyivCalendarDates(timeline.start, timeline.end)
      .map((date) => kyivWallTime(date))
      .filter((stamp) => stamp > timeline.start && stamp < timeline.end);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(210, 230, 255, 0.42)";
    ctx.fillStyle = "#dceaff";
    ctx.font = "600 9px Inter,system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    midnights.forEach((timestamp) => {
      const x = timeline.xAt(timestamp);
      if (x < chartArea.left || x > chartArea.right) return;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      const date = kyivParts(timestamp);
      const label = `00:00 · ${String(date.day).padStart(2, "0")}.${String(date.month).padStart(2, "0")}`;
      const width = ctx.measureText(label).width + 8;
      const labelX = Math.min(
        chartArea.right - width / 2,
        Math.max(chartArea.left + width / 2, x),
      );
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(7, 17, 32, 0.88)";
      ctx.fillRect(labelX - width / 2, chartArea.top + 2, width, 14);
      ctx.fillStyle = "#dceaff";
      ctx.fillText(label, labelX, chartArea.top + 4);
      ctx.setLineDash([4, 4]);
    });
    if (
      chart.canvas.id === "weather48Chart" ||
      chart.canvas.id === "homeWeatherChart"
    ) {
      ctx.setLineDash([]);
      const labels = chart.data.labels || [];
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        if (!/температура/i.test(dataset.label || "")) return;
        const dailyValues = new Map();
        (dataset.data || []).forEach((raw, index) => {
          if (raw == null || raw === "") return;
          const value = Number(raw);
          const timestamp = chartLabelTimestamp(labels[index]);
          if (!Number.isFinite(value) || !Number.isFinite(timestamp)) return;
          const date = kyivParts(timestamp);
          const key = `${date.year}-${date.month}-${date.day}`;
          const entry = { index, value, timestamp, date };
          const group = dailyValues.get(key) || { min: entry, max: entry };
          if (value < group.min.value) group.min = entry;
          if (value > group.max.value) group.max = entry;
          dailyValues.set(key, group);
        });

        const meta = chart.getDatasetMeta(datasetIndex);
        dailyValues.forEach(({ min, max }) => {
          const marks =
            min.index === max.index
              ? [{ entry: min, label: "Мін/макс" }]
              : [
                  { entry: max, label: "Макс" },
                  { entry: min, label: "Мін" },
                ];
          marks.forEach(({ entry, label }) => {
            const point = meta.data[entry.index];
            if (!point || point.skip) return;
            const position = point.getProps(["x", "y"], true);
            const day = String(entry.date.day).padStart(2, "0");
            const month = String(entry.date.month).padStart(2, "0");
            const value = fmt(entry.value, 1);
            const shortLabel =
              label === "Макс"
                ? "↑ Макс"
                : label === "Мін"
                  ? "↓ Мін"
                  : "• Мін/макс";
            const text = `${shortLabel} ${day}.${month} ${value}°`;
            ctx.font = "700 8px Inter,system-ui,sans-serif";
            const width = ctx.measureText(text).width;
            const x = Math.max(
              chartArea.left + width / 2 + 2,
              Math.min(position.x, chartArea.right - width / 2 - 2),
            );
            const maxLabel = label === "Макс" || label === "Мін/макс";
            let y = maxLabel ? position.y - 10 : position.y + 12;
            if (y < chartArea.top + 7) y = position.y + 12;
            if (y > chartArea.bottom - 7) y = position.y - 10;
            y = Math.max(chartArea.top + 7, Math.min(y, chartArea.bottom - 7));

            ctx.beginPath();
            ctx.arc(position.x, position.y, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = dataset.borderColor || "#58e1ff";
            ctx.fill();
            ctx.lineWidth = 1.3;
            ctx.strokeStyle = "#f5fbff";
            ctx.stroke();

            ctx.lineJoin = "round";
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = "rgba(7, 17, 32, 0.94)";
            ctx.fillStyle = "#f5fbff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.strokeText(text, x, y);
            ctx.fillText(text, x, y);
          });
        });
      });
    }
    ctx.restore();
  },
};

if (typeof Chart !== "undefined") Chart.register(chartDayMarkers);

async function req(path, opt = {}) {
  const method = opt.method || "GET",
    cacheKey = method + ":" + path,
    ttl = opt.ttl ?? 0,
    now = Date.now();
  if (method === "GET" && ttl && state.requestCache.has(cacheKey)) {
    const c = state.requestCache.get(cacheKey);
    if (now - c.at < ttl) return c.data;
  }
  if (method === "GET" && state.activeRequests.has(cacheKey))
    return state.activeRequests.get(cacheKey);
  const task = (async () => {
    const hd = { "Content-Type": "application/json", ...(opt.headers || {}) };
    if (state.token) hd.Authorization = "Bearer " + state.token;
    const r = await fetch(API + path, {
        ...opt,
        headers: hd,
        cache: "no-store",
      }),
      j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error || r.status);
    if (method === "GET" && ttl)
      state.requestCache.set(cacheKey, { at: Date.now(), data: j });
    return j;
  })();
  if (method === "GET") state.activeRequests.set(cacheKey, task);
  try {
    return await task;
  } finally {
    state.activeRequests.delete(cacheKey);
  }
}
function toast(t) {
  $("toast").textContent = t;
  $("toast").style.display = "block";
  setTimeout(() => ($("toast").style.display = "none"), 2500);
}
function hideChartTooltips() {
  const tooltip = document.getElementById("roomSparkTooltip");
  if (tooltip) tooltip.style.opacity = "0";
  Object.values(state.charts).forEach((chart) => {
    if (!chart?.canvas) return;
    chart.setActiveElements?.([]);
    chart.tooltip?.setActiveElements?.([], { x: 0, y: 0 });
    chart.update?.("none");
  });
}
function showView(v) {
  hideChartTooltips();
  document
    .querySelectorAll(".view")
    .forEach((x) => x.classList.toggle("active", x.id === v));
  document
    .querySelectorAll(".tab")
    .forEach((x) => x.classList.toggle("active", x.dataset.view === v));
  state.loadedTabs.add(v);
  if (v === "timeline") loadTimeline();
  if (v === "admin" && state.token) loadAdmin();
  if (v === "weather") renderWeather48();
  if (v === "energy" || v === "climate") loadPeriod(v, state.periods[v], true);
  requestAnimationFrame(() =>
    Object.values(state.charts).forEach((c) => c?.resize?.()),
  );
}
document
  .querySelectorAll(".tab")
  .forEach((x) => (x.onclick = () => showView(x.dataset.view)));
function kpi(i, l, v, f = "") {
  return `<div class="kpi"><span>${i}</span><small>${l}</small><b>${v}</b><small>${f}</small></div>`;
}
function chart(name, id, type, labels, datasets, unit = "") {
  state.charts[name]?.destroy();
  const canvas = $(id);
  let table = canvas.parentElement.querySelector(".chartTable");
  if (type === "table") {
    canvas.style.display = "none";
    if (!table) {
      table = document.createElement("div");
      table.className = "chartTable";
      canvas.parentElement.appendChild(table);
    }
    table.style.display = "block";
    const offset = Math.max(0, labels.length - 48),
      shown = labels.slice(offset);
    table.innerHTML =
      '<div class="item"><b>Час</b> · ' +
      datasets.map((x) => esc(x.label)).join(" · ") +
      "</div>" +
      shown
        .map(
          (l, i) =>
            '<div class="item">' +
            esc(l) +
            " · " +
            datasets
              .map((x) => fmt(x.data[offset + i], 2) + " " + unit)
              .join(" · ") +
            "</div>",
        )
        .join("");
    return;
  }
  canvas.style.display = "block";
  if (table) table.style.display = "none";
  const actual = type === "area" ? "line" : type;
  datasets = datasets.map((d) => ({
    ...d,
    fill: type === "area",
    tension: 0.3,
    borderWidth: 2,
    pointRadius: 1,
  }));
  state.charts[name] = new Chart($(id), {
    type: actual,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#91a4c4" } },
        tooltip: {
          callbacks: {
            label: (c) =>
              c.dataset.label + ": " + fmt(c.parsed.y, 2) + " " + unit,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: name === "climate" ? "#e4edfa" : "#91a4c4",
            maxTicksLimit: 10,
          },
          grid: { color: name === "climate" ? "#ffffff1c" : "#ffffff0a" },
        },
        y: {
          ticks: { color: name === "climate" ? "#e4edfa" : "#91a4c4" },
          grid: { color: name === "climate" ? "#ffffff1c" : "#ffffff0a" },
        },
      },
    },
  });
}

const PERIODS = {
  day: "День",
  week: "Тиждень",
  month: "Місяць",
  year: "Рік",
  custom: "Власний",
};
function periodDays(p) {
  return p === "day"
    ? 1
    : p === "week"
      ? 7
      : p === "month"
        ? 30
        : p === "year"
          ? 365
          : 30;
}
function dateISO(d) {
  return d.toISOString().slice(0, 10);
}
function setupPeriods() {
  document.querySelectorAll(".periodBar").forEach((el) => {
    const scope = el.dataset.scope;
    el.innerHTML =
      '<div class="seg">' +
      Object.entries(PERIODS)
        .map(
          ([k, v]) =>
            `<button type="button" data-period="${k}" class="${state.periods[scope] === k ? "active" : ""}">${v}</button>`,
        )
        .join("") +
      '</div><span class="customDates" hidden><input class="input pfrom" type="date"><input class="input pto" type="date"><button type="button" class="btn applyPeriod">Застосувати</button></span>';
    el.onclick = (e) => {
      const b = e.target.closest("[data-period]");
      if (!b) return;
      const p = b.dataset.period;
      el.querySelectorAll("[data-period]").forEach((x) =>
        x.classList.toggle("active", x === b),
      );
      el.querySelector(".customDates").hidden = p !== "custom";
      if (p !== "custom") {
        state.periods[scope] = p;
        loadPeriod(scope, p, true);
      }
    };
    el.querySelector(".applyPeriod").onclick = () => {
      state.periods[scope] = "custom";
      loadPeriod(scope, "custom", true);
    };
  });
}
async function loadPeriod(scope, p, force = false) {
  const root = document.querySelector(`[data-scope="${scope}"]`),
    fromEl = root?.querySelector(".pfrom"),
    toEl = root?.querySelector(".pto"),
    days = periodDays(p),
    to = toEl?.value || dateISO(new Date()),
    fr = fromEl?.value || dateISO(new Date(Date.now() - (days - 1) * 86400000));
  try {
    root?.classList.add("loading");
    if (p === "day") {
      const hours = 24;
      const [pw, cl] = await Promise.all([
        req(`/charts/power?hours=${hours}`, { ttl: force ? 0 : 300000 }),
        req(`/charts/climate?hours=${hours}`, { ttl: force ? 0 : 300000 }),
      ]);
      state.power = pw;
      state.climate = cl;
    } else {
      const a = await req(`/analytics/range?from=${fr}&to=${to}`, {
        ttl: force ? 0 : 900000,
      });
      state.analytics = a.analytics;
    }
    renderPeriodCharts(scope, p);
  } catch (e) {
    toast("Графік: " + e.message);
  } finally {
    root?.classList.remove("loading");
  }
}
function renderPeriodCharts(scope, p) {
  if (p === "day") {
    renderCharts();
    return;
  }
  const a = state.analytics;
  if (!a) return;
  const labels = (a.power || []).map((x) => x.period),
    type =
      localStorage.getItem(
        "chart-" + (scope === "energy" ? "voltage" : scope),
      ) || "line";
  if (scope === "energy" || scope === "power")
    chart(
      scope === "power" ? "power" : "voltage",
      scope === "power" ? "powerChart" : "voltageChart",
      type,
      labels,
      [
        {
          label: "Енергія, кВт·год",
          data: (a.power || []).map((x) => x.energy_kwh),
          borderColor: "#58e1ff",
          backgroundColor: "#58e1ff44",
        },
        {
          label: "Вартість, грн",
          data: (a.power || []).map((x) => x.cost),
          borderColor: "#8c6cff",
          backgroundColor: "#8c6cff44",
        },
      ],
      "",
    );
  if (scope === "climate") {
    const ds = [];
    for (const [id, rows] of Object.entries(a.climate || {}))
      ds.push({
        label: id,
        data: rows.map((x) => x.avg_temperature),
        borderColor: ["#58e1ff", "#8c6cff", "#39dc98", "#ffc857"][
          ds.length % 4
        ],
      });
    chart("climate", "climateChart", type, labels, ds, "°C");
  }
}
function commandMetric(icon, label, value, foot = "") {
  return `<div class="metric"><span>${icon} ${label}</span><strong>${value}</strong><small>${foot}</small></div>`;
}
function renderComfortMatrix(rooms) {
  const el = $("comfortMatrix");
  if (!el) return;
  el.innerHTML = (rooms || [])
    .map(
      (r) =>
        `<div class="comfortCell" style="background:${r.comfort_score >= 80 ? "#39dc9812" : r.comfort_score >= 60 ? "#ffc85712" : "#ff647c12"}"><div class="row"><b>${esc(r.name)}</b><strong>${r.comfort_score}</strong></div><small>${fmt(r.temperature)}°C · ${fmt(r.humidity, 0)}%</small></div>`,
    )
    .join("");
}
function setTariffRangeMode(mode) {
  state.tariffRangeMode = mode;
  document.querySelectorAll("[data-tariff-mode]").forEach((button) => {
    const active = button.dataset.tariffMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("tariffMonthField").hidden = mode !== "month";
  $("tariffFromField").hidden = mode !== "custom";
  $("tariffToField").hidden = mode !== "custom";
  $("tariffApply").hidden = mode !== "custom";
}
async function loadTariffRange() {
  try {
    const month = $("tariffMonth")?.value,
      from = $("tariffFrom")?.value,
      to = $("tariffTo")?.value,
      qs = new URLSearchParams();
    if (state.tariffRangeMode === "custom") {
      if (!from || !to) {
        toast("Оберіть початкову й кінцеву дати");
        return;
      }
      if (from > to) {
        toast("Початкова дата має бути раніше кінцевої");
        return;
      }
      qs.set("from", from);
      qs.set("to", to);
    } else if (month) qs.set("month", month);
    state.tariffRange = await req("/analytics/tariff-range?" + qs.toString(), {
      ttl: 0,
    });
    renderEnergyExtras();
  } catch (e) {
    toast("Тариф: " + e.message);
  }
}
function renderEnergyExtras() {
  const data = state.tariffRange,
    month = state.dash?.insights?.power?.statistics?.month;
  if (!data && !month) return;
  const dayKwh = data?.totals?.day?.kwh ?? (+month.energy_day || 0),
    nightKwh = data?.totals?.night?.kwh ?? (+month.energy_night || 0),
    dayCost = data?.totals?.day?.cost ?? (+month.cost_day || 0),
    nightCost = data?.totals?.night?.cost ?? (+month.cost_night || 0);
  state.charts.tariff?.destroy();
  state.charts.tariff = new Chart($("tariffChart"), {
    type: "doughnut",
    data: {
      labels: ["Денний тариф", "Нічний тариф"],
      datasets: [
        {
          data: [dayKwh, nightKwh],
          backgroundColor: ["#58e1ff", "#715cff"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "63%",
      plugins: { legend: { labels: { color: "#91a4c4" } } },
    },
  });
  setHTML(
    "tariffTotals",
    `<div class="tariffTotal"><b>☀️ Денний тариф</b><br><strong>${fmt(dayKwh, 2)} кВт·год</strong><br><span>${fmt(dayCost, 2)} грн</span></div><div class="tariffTotal"><b>🌙 Нічний тариф</b><br><strong>${fmt(nightKwh, 2)} кВт·год</strong><br><span>${fmt(nightCost, 2)} грн</span></div>`,
  );
  const total = dayKwh + nightKwh,
    night = total ? (nightKwh / total) * 100 : 0;
  setHTML(
    "energyInsights",
    `<div class="item"><b>Нічний тариф</b><p>${fmt(night, 0)}% споживання</p></div><div class="item"><b>Разом за період</b><p>${fmt(dayKwh + nightKwh, 2)} кВт·год · ${fmt(dayCost + nightCost, 2)} грн</p></div>`,
  );
}
function friendlyTime(value) {
  if (value == null) return "—";
  const raw = String(value).trim(),
    normalized = raw.includes("T") ? raw : raw.replace(" ", "T"),
    d = new Date(
      /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
        ? normalized
        : normalized + "Z",
    );
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
function dualChart(name, id, labels, datasets, chartOptions = {}) {
  const probabilityAxes = new Set(
    (datasets || [])
      .filter(
        (x) =>
          /%/.test(x.label || "") &&
          /дощ|опад|rain|precip/i.test(x.label || ""),
      )
      .map((x) => x.yAxisID || "y"),
  );
  const canvas = $(id);
  if (!canvas || typeof Chart === "undefined") return;
  state.charts[name]?.destroy();
  state.charts[name] = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels || [],
      datasets: (datasets || []).map((x) => ({
        ...x,
        tension: x.type === "line" ? 0.28 : 0,
        pointRadius:
          x.pointRadius ??
          (x.type === "line" ? (name === "climate" ? 3 : 1.5) : 0),
        borderWidth: x.borderWidth || 2,
        order: x.type === "line" ? 1 : 2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        chartDayMarkers: {
          tariffBands:
            chartOptions.tariffBands ??
            ["power", "voltage", "homeEnergy"].includes(name),
        },
        legend: {
          display: name !== "climate",
          labels: {
            color: "#91a4c4",
            boxWidth: window.innerWidth <= 650 ? 8 : 12,
            usePointStyle: true,
            font: { size: window.innerWidth <= 650 ? 9 : 12 },
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: "#091426",
          titleColor: "#f8fbff",
          bodyColor: "#e4edfa",
          borderColor: name === "climate" ? "#60799f" : "#ffffff22",
          borderWidth: 1,
          displayColors: true,
        },
      },
      scales: {
        x: {
          ticks: {
            color: name === "climate" ? "#e4edfa" : "#91a4c4",
            maxTicksLimit:
              name === "homeEnergy" || name === "homeWeather"
                ? window.innerWidth <= 650
                  ? name === "homeWeather"
                    ? 4
                    : 5
                  : name === "homeWeather"
                    ? 7
                    : 10
                : 18,
            maxRotation: 0,
            autoSkip: true,
            font: { size: window.innerWidth <= 650 ? 9 : 12 },
          },
          grid: { color: name === "climate" ? "#ffffff1c" : "#ffffff0a" },
        },
        y: {
          display:
            name !== "climate" || state.chartMetrics.climate !== "humidity",
          position: "left",
          beginAtZero: false,
          ...(name === "climate"
            ? { min: 0, max: 40 }
            : probabilityAxes.has("y")
              ? { min: 0, max: 100 }
              : {}),
          ticks: { color: name === "climate" ? "#e4edfa" : "#91a4c4" },
          grid: { color: name === "climate" ? "#ffffff1c" : "#ffffff0a" },
        },
        y1: {
          display:
            name !== "climate" || state.chartMetrics.climate !== "temperature",
          position:
            name === "climate" && state.chartMetrics.climate === "humidity"
              ? "left"
              : "right",
          beginAtZero: true,
          stacked: (datasets || []).some((x) => x.yAxisID === "y1" && x.stack),
          ...(name === "climate" || probabilityAxes.has("y1")
            ? { min: 0, max: 100 }
            : {}),
          ticks: { color: name === "climate" ? "#e4edfa" : "#91a4c4" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}
function weatherLabel(v) {
  const d = new Date(String(v || "").replace(" ", "T") + "Z"),
    now = new Date(),
    kyiv = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d),
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
    tomorrow = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now.getTime() + 86400000)),
    time = d.toLocaleTimeString("uk-UA", {
      timeZone: "Europe/Kyiv",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    (kyiv === today
      ? "Сьогодні "
      : kyiv === tomorrow
        ? "Завтра "
        : d.toLocaleDateString("uk-UA", {
            timeZone: "Europe/Kyiv",
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
          }) + " ") + time
  );
}
function renderWeather48() {
  const now = Date.now(),
    rows = (state.dash?.weather?.hourly_3h || [])
      .filter(
        (x) =>
          new Date(String(x.forecast_time).replace(" ", "T") + "Z").getTime() >=
          now - 1800000,
      )
      .slice(0, 16);
  if (!rows.length || !$("weather48Chart")) return;
  const labels = rows.map((x) => weatherLabel(x.forecast_time)),
    metric = state.weatherMetric,
    pairs =
      {
        temperature: [
          [
            "Температура, °C",
            rows.map((x) => x.temperature),
            "#58e1ff",
            "line",
            "y",
          ],
          [
            "Дощ, %",
            rows.map((x) => x.precipitation_probability),
            "#715cff",
            "bar",
            "y1",
          ],
        ],
        humidity: [
          ["Вологість, %", rows.map((x) => x.humidity), "#39dc98", "bar", "y"],
          [
            "Температура, °C",
            rows.map((x) => x.temperature),
            "#58e1ff",
            "line",
            "y1",
          ],
        ],
        wind: [
          [
            "Вітер, км/год",
            rows.map((x) => x.wind_speed),
            "#ffc857",
            "bar",
            "y",
          ],
          [
            "Температура, °C",
            rows.map((x) => x.temperature),
            "#58e1ff",
            "line",
            "y1",
          ],
        ],
      }[metric] || [];
  dualChart(
    "weather48",
    "weather48Chart",
    labels,
    pairs.map((p) => ({
      label: p[0],
      data: p[1],
      borderColor: p[2],
      backgroundColor: p[2] + "55",
      type: p[3],
      yAxisID: p[4],
    })),
  );
  const out = rows.find(
    (x) => +x.precipitation_probability < 30 && +x.wind_speed < 20,
  );
  setHTML(
    "ventilationWindow",
    out
      ? `<b>💨 Вікно для провітрювання</b><br><small>${weatherLabel(out.forecast_time)} · ${fmt(out.temperature)}°C</small>`
      : "<b>💨 Провітрювання</b><br><small>Сприятливого вікна не знайдено</small>",
  );
}
function setupTimelineFilters() {
  const cats = ["all", "energy", "climate", "weather", "device", "alert"];
  $("timelineFilters").innerHTML = cats
    .map(
      (c, i) =>
        `<button type="button" class="btn ${i === 0 ? "primary" : ""}" data-tfilter="${c}">${{ all: "Усі", energy: "Енергія", climate: "Клімат", weather: "Погода", device: "Пристрої", alert: "Алерти" }[c]}</button>`,
    )
    .join("");
  $("timelineFilters").onclick = (e) => {
    const b = e.target.closest("[data-tfilter]");
    if (!b) return;
    state.timelineFilter = b.dataset.tfilter;
    $("timelineFilters")
      .querySelectorAll("button")
      .forEach((x) => x.classList.toggle("primary", x === b));
    renderTimelineItems();
  };
}
function renderTimelineItems() {
  const a =
    state.timelineFilter === "all"
      ? state.timelineItems
      : state.timelineItems.filter((x) =>
          String(x.category || x.severity || "").includes(state.timelineFilter),
        );
  const groups = {};
  for (const x of a) {
    const d = String(x.created_at || "").slice(0, 10);
    (groups[d] ??= []).push(x);
  }
  $("timelineList").innerHTML =
    Object.entries(groups)
      .map(
        ([d, rows]) =>
          `<h3>${d === dateISO(new Date()) ? "Сьогодні" : d}</h3>` +
          rows
            .map(
              (x) =>
                `<div class="item"><div class="row"><b>${esc(x.title)}</b><small>${esc(String(x.created_at).slice(11, 16))}</small></div><p>${esc(x.message || "")}</p></div>`,
            )
            .join(""),
      )
      .join("") || '<div class="empty">Подій не знайдено</div>';
}
function allDevices(o, d) {
  return state.deviceStatus?.items || [];
}
const ageText = (m) =>
  m == null
    ? "даних ще немає"
    : m < 1
      ? "щойно"
      : m < 60
        ? m + " хв тому"
        : Math.floor(m / 60) + " год " + (m % 60) + " хв тому";
function renderDevices(o, d) {
  const el = $("devicesGrid");
  if (!el) return [];
  const items = allDevices(o, d).filter((x) => x.device_type === "climate");
  el.innerHTML =
    items
      .map(
        (x) =>
          `<div class="deviceCard ${x.is_outdoor ? "outdoor" : ""}"><div class="row"><b>${roomIcon(x)} ${esc(x.device_name)}</b><span class="statusPill status-${x.status}">${x.status === "online" ? "Online" : x.status === "warning" ? "Затримка" : "Offline"}</span></div>${x.device_type === "power" ? `<h3>${fmt(x.power, 0)} Вт · ${fmt(x.voltage, 1)} В</h3>` : `<h3>${fmt(x.temperature)}°C · ${fmt(x.humidity, 0)}%</h3><small>${x.is_outdoor ? "Вуличний датчик" : "Кімнатний датчик"}${x.wifi_rssi != null ? " · " + x.wifi_rssi + " dBm" : ""}</small>`}<div class="age">${x.status === "online" ? "Дані актуальні" : "Оновлення " + (x.status === "warning" ? "затримується" : "прострочене")} · ${ageText(x.age_minutes)}</div></div>`,
      )
      .join("") || '<div class="empty">Пристрої не зареєстровані</div>';
  const rooms = items.filter(
      (x) => x.device_type === "climate" && !x.is_outdoor,
    ),
    outdoor = items.find((x) => x.is_outdoor),
    attention = items.filter((x) => !x.online),
    scores = (o.rooms || [])
      .map((x) => Number(x.comfort_score))
      .filter(Number.isFinite),
    comfort = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;
  setHTML(
    "roomSummary",
    `<div class="insight"><b>🏆 Кімнатні датчики</b><br>${rooms.filter((x) => x.online).length}/${rooms.length} online</div><div class="insight"><b>🍃 Комфорт дому</b><br>${comfort === null ? "—" : comfort + "/100"}</div><div class="insight"><b>🌳 Вулиця</b><br>${outdoor ? fmt(outdoor.temperature) + "°C · " + fmt(outdoor.humidity, 0) + "%" : "не налаштовано"}</div><div class="insight"><b>⚠ Потребують уваги</b><br>${attention.length}</div>`,
  );
  setHTML(
    "overviewRooms",
    `<div class="insight"><b>🏆 Найкомфортніша</b><br>${esc((o.rooms || [])[0]?.name || "—")}</div><div class="insight"><b>🌳 Вулиця</b><br>${outdoor ? fmt(outdoor.temperature) + "°C · " + fmt(outdoor.humidity, 0) + "%" : "немає даних"}</div><div class="insight"><b>📡 Зв’язок</b><br>${state.deviceStatus?.online || 0}/${state.deviceStatus?.total || 0} online</div>`,
  );
  renderFloorPlan();
  return items;
}
function showDetail(title, html) {
  $("detailTitle").textContent = title;
  $("detailBody").innerHTML = html;
  $("detailModal").classList.add("show");
}
function renderAlertsAndRecommendations(o, d) {
  if (!$("recs")) return;
  const recs = [...(o.recommendations || d.recommendations || [])],
    alerts = d.alerts || [],
    offline = allDevices(o, d).filter((x) => !x.online);
  for (const x of offline)
    if (!recs.some((r) => String(r.message || "").includes(x.device_name)))
      recs.unshift({
        title: "Перевірте " + x.device_name,
        message:
          "Немає актуальних даних. Останній зв’язок: " +
          ageText(x.age_minutes) +
          ". Перевірте живлення та Wi-Fi.",
      });
  $("recCount").textContent = recs.length;
  $("recs").innerHTML =
    recs
      .slice(0, 6)
      .map(
        (x) =>
          `<div class="item"><b>${esc(x.title || x.category || "Рекомендація")}</b><p>${esc(x.message || x.action || "")}</p></div>`,
      )
      .join("") || '<div class="empty">✅ Активних рекомендацій немає</div>';
  $("alertsPreview").innerHTML =
    alerts
      .slice(0, 6)
      .map(
        (x, i) =>
          `<div class="item" data-alert-index="${i}"><div class="row"><b>${esc(x.alert_message || x.alert_type || "Алерт")}</b><span class="statusPill ${x.severity === "critical" ? "critical" : "attention"}">${esc(x.severity || "warning")}</span></div><small>${esc(String(x.created_at || "").slice(0, 16))}</small></div>`,
      )
      .join("") || '<div class="empty">✅ Активних алертів немає</div>';
  $("alertsPreview").onclick = (e) => {
    const el = e.target.closest("[data-alert-index]");
    if (!el) return;
    const x = alerts[+el.dataset.alertIndex];
    showDetail(
      "🚨 Деталі алерту",
      `<div class="item"><b>${esc(x.alert_type || "Алерт")}</b><p>${esc(x.alert_message || "")}</p><small>Severity: ${esc(x.severity || "warning")} · ${esc(x.created_at || "")}</small></div><button type="button" class="btn primary" data-go="timeline">Відкрити всі події</button>`,
    );
  };
}
function roomIcon(room) {
  const n = String(room?.device_name || "").toLowerCase();
  if (
    room?.is_outdoor ||
    n.includes("outdoor") ||
    n.includes("вулиц") ||
    n.includes("улиц")
  )
    return "🌳";
  if (/kids?|child|nursery|дит|детск/.test(n)) return "👶";
  if (/hallway|corridor|hall|коридор|передпок/.test(n)) return "🚪";
  if (/bedroom|спальн/.test(n)) return "🛏️";
  if (/living|lounge|вітальн|гостин/.test(n)) return "🛋️";
  if (/kitchen|кухн/.test(n)) return "🍳";
  if (/bath|ванн/.test(n)) return "🛁";
  if (/office|study|кабінет|кабинет/.test(n)) return "💻";
  return "🏠";
}
function renderOverviewCompact(o, d, devices) {
  const climate = devices.filter((x) => x.device_type === "climate"),
    outdoor = climate.find((x) => x.is_outdoor),
    rooms = climate.filter((x) => !x.is_outdoor),
    power = devices.find((x) => x.device_type === "power"),
    cards = [...rooms.slice(0, 3), ...(outdoor ? [outdoor] : [])];
  setHTML(
    "overviewRoomCards",
    cards
      .map((x, i) => {
        const freshness =
          x.status === "online"
            ? "Актуально"
            : x.status === "warning"
              ? "Оновлення затримується"
              : "Дані застарілі";
        return `<div class="compactRoom"><div class="row"><b>${roomIcon(x)} ${esc(x.device_name)}</b><span class="status-${x.status}">●</span></div><strong>${fmt(x.temperature)}°C · ${fmt(x.humidity, 0)}%</strong><div class="age" title="Останній зв’язок: ${ageText(x.age_minutes)}">${freshness} · ${ageText(x.age_minutes)}</div><div class="compactSpark"><canvas id="roomSpark${i}"></canvas></div></div>`;
      })
      .join("") +
      (power
        ? `<div class="compactRoom"><b>⚡ ${esc(power.device_name)}</b><br><strong>${fmt(power.power, 0)} Вт</strong><div class="age">${power.status === "online" ? "Дані актуальні" : "Дані застарілі"} · ${ageText(power.age_minutes)}</div></div>`
        : ""),
  );
  renderHomeDailyChanges(rooms);
  renderRoomSparks(cards);
  renderHomeEnergy();
  const recs = o.recommendations || d.recommendations || [],
    alerts = d.alerts || [],
    offline = devices.filter((x) => !x.online),
    offlineNames = offline.map((x) =>
      String(x.device_name || "").toLowerCase(),
    ),
    uniqueAlerts = alerts.filter((a) => {
      const text = String(
        (a.alert_type || "") + " " + (a.alert_message || ""),
      ).toLowerCase();
      return !offlineNames.some((name) => name && text.includes(name));
    }),
    items = [
      ...offline.map((x) => ({
        t: "📡 " + x.device_name,
        m: "Немає актуальних даних",
      })),
      ...uniqueAlerts.slice(0, 2).map((x) => ({
        t: "🚨 " + (x.alert_type || "Алерт"),
        m: x.alert_message,
      })),
      ...recs
        .slice(0, 2)
        .map((x) => ({ t: "💡 " + (x.title || "Рекомендація"), m: x.message })),
    ].slice(0, 3);
  setHTML(
    "homeAttention",
    items
      .map(
        (x) =>
          `<div class="item"><b>${esc(x.t)}</b><br><small>${esc(x.m || "")}</small></div>`,
      )
      .join("") || '<div class="empty">✅ Усе спокійно</div>',
  );
  renderHomeWeather();
}
function renderHomeDailyChanges(devices) {
  const box = $("homeDailyChanges");
  if (!box) return;
  const history = state.homeClimate24?.datasets || {},
    now = Date.now(),
    rows = [];
  for (const device of devices) {
    if (device.status !== "online") continue;
    const series = Object.entries(history).find(
      ([id]) => climateDeviceForSeries(id) === device,
    )?.[1];
    if (!series) continue;
    const labels = series.labels || [],
      points = [];
    for (let i = 0; i < labels.length; i++) {
      const time = climateUtcMs(labels[i]),
        temperature = Number(series.temperature?.[i]),
        humidity = Number(series.humidity?.[i]);
      if (
        Number.isFinite(time) &&
        time >= now - 86400000 &&
        time <= now &&
        Number.isFinite(temperature)
      )
        points.push({
          time,
          temperature,
          humidity: Number.isFinite(humidity) ? humidity : null,
        });
    }
    points.sort((a, b) => a.time - b.time);
    if (points.length < 2 || now - points[points.length - 1].time > 90 * 60000)
      continue;
    const first = points[0],
      last = points[points.length - 1],
      tempDelta = last.temperature - first.temperature,
      humidityDelta =
        first.humidity === null || last.humidity === null
          ? null
          : last.humidity - first.humidity;
    if (
      Math.abs(tempDelta) >= 0.4 ||
      (humidityDelta !== null && Math.abs(humidityDelta) >= 3)
    ) {
      const signed = (value) =>
        (value > 0 ? "+" : "") + value.toFixed(1).replace(".", ",");
      rows.push(
        `<div class="dailyChangeRow"><span>${roomIcon(device)} ${esc(device.device_name)}</span><b>${Math.abs(tempDelta) >= 0.4 ? signed(tempDelta) + "°" : ""}${Math.abs(tempDelta) >= 0.4 && humidityDelta !== null && Math.abs(humidityDelta) >= 3 ? " · " : ""}${humidityDelta !== null && Math.abs(humidityDelta) >= 3 ? signed(humidityDelta) + "%" : ""}</b></div>`,
      );
    }
  }
  const body = rows.length
    ? rows.slice(0, 3).join("")
    : devices.some((x) => x.status === "online")
      ? "<p>Без помітних змін за останню добу.</p>"
      : "<p>Ще збираємо дані для порівняння.</p>";
  box.innerHTML = '<div class="dailyChangeHeading">За добу</div>' + body;
}
function climateUtcMs(value) {
  const raw = String(value ?? "").trim(),
    normalized = raw.includes("T") ? raw : raw.replace(" ", "T"),
    d = new Date(
      /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
        ? normalized
        : normalized + "Z",
    );
  return Number.isNaN(d.getTime()) ? NaN : d.getTime();
}
function mergeRecentClimate(base, recent) {
  if (!base?.datasets || !recent?.datasets) return base;
  const datasets = { ...base.datasets },
    hourMs = 3600000,
    stepMs = 15 * 60000;
  for (const [id, fresh] of Object.entries(recent.datasets)) {
    const labels = fresh.labels || [],
      times = labels.map(climateUtcMs).filter(Number.isFinite);
    if (!times.length) continue;
    const old = datasets[id] || {
        labels: [],
        temperature: [],
        humidity: [],
        wifi_rssi: [],
      },
      cutoff = Math.floor(Math.min(...times) / hourMs) * hourMs,
      rows = [];
    for (let i = 0; i < (old.labels || []).length; i++) {
      const t = climateUtcMs(old.labels[i]);
      if (Number.isFinite(t) && t < cutoff)
        rows.push({
          t,
          label: old.labels[i],
          temperature: old.temperature?.[i] ?? null,
          humidity: old.humidity?.[i] ?? null,
          wifi_rssi: old.wifi_rssi?.[i] ?? null,
        });
    }
    const bins = new Map();
    for (let i = 0; i < labels.length; i++) {
      const t = climateUtcMs(labels[i]);
      if (!Number.isFinite(t)) continue;
      const bucket = Math.floor(t / stepMs) * stepMs,
        g = bins.get(bucket) || {
          t: bucket,
          temperature: 0,
          temperatureN: 0,
          humidity: 0,
          humidityN: 0,
          wifi_rssi: 0,
          wifi_rssiN: 0,
        };
      for (const key of ["temperature", "humidity", "wifi_rssi"]) {
        const value = fresh[key]?.[i];
        if (value != null && value !== "" && Number.isFinite(Number(value))) {
          g[key] += Number(value);
          g[key + "N"]++;
        }
      }
      bins.set(bucket, g);
    }
    for (const g of bins.values())
      rows.push({
        t: g.t,
        label: new Date(g.t).toISOString().slice(0, 19).replace("T", " "),
        temperature: g.temperatureN ? g.temperature / g.temperatureN : null,
        humidity: g.humidityN ? g.humidity / g.humidityN : null,
        wifi_rssi: g.wifi_rssiN ? g.wifi_rssi / g.wifi_rssiN : null,
      });
    rows.sort((a, b) => a.t - b.t);
    datasets[id] = {
      labels: rows.map((x) => x.label),
      temperature: rows.map((x) => x.temperature),
      humidity: rows.map((x) => x.humidity),
      wifi_rssi: rows.map((x) => x.wifi_rssi),
    };
  }
  return { ...base, datasets };
}
function renderRoomSparks(cards) {
  const climate =
      state.homeClimate24?.datasets || state.climate?.datasets || {},
    keys = Object.keys(climate),
    extent = (values, minSpan, bounds) => {
      const nums = (values || []).map(Number).filter(Number.isFinite);
      if (!nums.length) return bounds;
      const lo = Math.min(...nums),
        hi = Math.max(...nums),
        center = (lo + hi) / 2,
        span = Math.min(
          bounds[1] - bounds[0],
          Math.max(minSpan, (hi - lo) * 1.4 + minSpan * 0.12),
        );
      let min = Math.max(bounds[0], center - span / 2),
        max = Math.min(bounds[1], center + span / 2);
      if (max - min < minSpan) {
        if (min === bounds[0]) max = Math.min(bounds[1], min + minSpan);
        else min = Math.max(bounds[0], max - minSpan);
      }
      return [min, max];
    };
  (cards || []).forEach((room, i) => {
    const nameKey = String(room.device_name || "")
        .toLowerCase()
        .split(" ")[0],
      key = keys.find(
        (k) => k === room.device_id || k.toLowerCase().includes(nameKey),
      ),
      series = key ? climate[key] : null,
      canvas = $("roomSpark" + i);
    if (!canvas || !series?.temperature?.length) return;
    const name = "roomSpark" + i,
      color = room.is_outdoor ? "#ffc857" : "#58e1ff",
      temperature = series.temperature || [],
      humidity = series.humidity || [],
      labels = series.labels || temperature.map((_, n) => n),
      times = labels.map(climateUtcMs).filter(Number.isFinite),
      timeStart = times.length ? Math.min(...times) : Date.now() - 86400000,
      timeEnd = times.length ? Math.max(...times) : Date.now(),
      tempRange = extent(temperature, 3, [-30, 60]),
      humidityRange = extent(humidity, 12, [0, 100]),
      toPoints = (values) =>
        values
          .map((value, index) => ({
            x: climateUtcMs(labels[index]),
            y: value == null ? null : Number(value),
          }))
          .filter(
            (point) =>
              Number.isFinite(point.x) &&
              (point.y === null || Number.isFinite(point.y)),
          );
    state.charts[name]?.destroy();
    state.charts[name] = new Chart(canvas, {
      type: "line",
      data: {
        datasets: [
          {
            label: "Температура, °C",
            data: toPoints(temperature),
            borderColor: color,
            backgroundColor: color + "18",
            yAxisID: "y",
            fill: false,
            tension: 0.24,
            spanGaps: false,
            pointRadius: 0,
            pointHoverRadius: 3,
            borderWidth: 2.2,
            order: 1,
          },
          {
            label: "Вологість, %",
            data: toPoints(humidity),
            borderColor: "#bd83ff",
            backgroundColor: "#bd83ff18",
            yAxisID: "y1",
            fill: false,
            tension: 0.24,
            spanGaps: false,
            pointRadius: 0,
            pointHoverRadius: 3,
            borderWidth: 2,
            order: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: ({ chart, tooltip }) => {
              let el = document.getElementById("roomSparkTooltip");
              if (!el) {
                el = document.createElement("div");
                el.id = "roomSparkTooltip";
                el.style.cssText =
                  "position:fixed;z-index:9999;pointer-events:none;padding:8px 10px;border:1px solid #58e1ff66;border-radius:9px;background:#101b30;color:#f5f8ff;font:12px Inter,system-ui,sans-serif;box-shadow:0 8px 24px #0009;white-space:nowrap;opacity:0;transition:opacity .08s";
                document.body.appendChild(el);
              }
              if (!tooltip || tooltip.opacity === 0) {
                el.style.opacity = "0";
                return;
              }
              const stamp = tooltip.dataPoints?.[0]?.parsed?.x,
                title = Number.isFinite(stamp)
                  ? new Intl.DateTimeFormat("uk-UA", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                      timeZone: "Europe/Kyiv",
                    }).format(new Date(stamp))
                  : "—";
              el.innerHTML =
                "<b>" +
                esc(title) +
                "</b>" +
                tooltip.dataPoints
                  .map(
                    (p) =>
                      "<div>" +
                      esc(p.dataset.label) +
                      ": <b>" +
                      fmt(p.raw?.y ?? p.raw) +
                      "</b></div>",
                  )
                  .join("");
              const r = chart.canvas.getBoundingClientRect();
              el.style.opacity = "1";
              el.style.left =
                Math.min(
                  window.innerWidth - el.offsetWidth - 8,
                  Math.max(8, r.left + tooltip.caretX),
                ) + "px";
              el.style.top =
                Math.max(
                  8,
                  Math.min(
                    window.innerHeight - el.offsetHeight - 8,
                    r.top + tooltip.caretY - el.offsetHeight - 10,
                  ),
                ) + "px";
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: timeStart,
            max: timeEnd,
            ticks: {
              autoSkip: false,
              maxRotation: 0,
              minRotation: 0,
              color: "#91a4c4",
              font: { size: window.innerWidth <= 650 ? 9 : 10 },
              padding: 2,
              callback: (value) => {
                const local = kyivParts(Number(value));
                return `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
              },
            },
            afterBuildTicks: (scale) => {
              scale.ticks = timeAxisTicks(
                timeStart,
                timeEnd,
                scale.width || canvas.clientWidth || 500,
              ).map((value) => ({ value }));
            },
            grid: { display: false },
            border: { display: false },
            afterFit: (scale) => {
              scale.height = Math.max(scale.height, 25);
            },
          },
          y: {
            display: true,
            min: tempRange[0],
            max: tempRange[1],
            position: "left",
            title: {
              display: true,
              text: "°C",
              color: "#b9c8dd",
              font: { size: 9, weight: "700" },
            },
            grid: { color: "#ffffff16", drawTicks: false },
            border: { display: false },
            ticks: {
              maxTicksLimit: 4,
              color: "#d3deed",
              font: { size: 9, weight: "600" },
              padding: 3,
            },
          },
          y1: {
            display: true,
            min: humidityRange[0],
            max: humidityRange[1],
            position: "right",
            title: {
              display: true,
              text: "%",
              color: "#d2b9ff",
              font: { size: 9, weight: "700" },
            },
            grid: { drawOnChartArea: false, drawTicks: false },
            border: { display: false },
            ticks: {
              maxTicksLimit: 4,
              color: "#d9caff",
              font: { size: 9, weight: "600" },
              padding: 3,
            },
          },
        },
      },
    });
    canvas.addEventListener("pointerleave", () => {
      const tooltip = document.getElementById("roomSparkTooltip");
      if (tooltip) tooltip.style.opacity = "0";
    });
  });
}
function renderHomeEnergy() {
  const canvas = $("homeEnergyChart"),
    empty = $("homeEnergyEmpty"),
    points = state.homeEnergy24?.points || [];
  if (!canvas) return;
  if (!points.length) {
    canvas.style.display = "none";
    if (empty) empty.hidden = false;
    return;
  }
  canvas.style.display = "block";
  if (empty) empty.hidden = true;
  dualChart(
    "homeEnergy",
    "homeEnergyChart",
    points.map((x) => friendlyTime(x.label)),
    [
      {
        label: "Середня потужність, Вт",
        data: points.map((x) => x.avg_power),
        borderColor: "#8c6cff",
        backgroundColor: "#8c6cff18",
        type: "line",
        yAxisID: "y",
      },
      {
        label: "Витрати за 15 хв, грн",
        data: points.map((x) => x.cost),
        borderColor: "#58e1ff55",
        backgroundColor: "#58e1ff55",
        type: "bar",
        yAxisID: "y1",
      },
    ],
  );
}
function renderHomeWeather() {
  const now = Date.now(),
    rows = (state.dash?.weather?.hourly_3h || [])
      .filter(
        (x) =>
          new Date(String(x.forecast_time).replace(" ", "T") + "Z").getTime() >=
          now - 1800000,
      )
      .slice(0, 16),
    canvas = $("homeWeatherChart");
  if (!canvas) return;
  if (!rows.length) {
    canvas.style.display = "none";
    return;
  }
  canvas.style.display = "block";
  dualChart(
    "homeWeather",
    "homeWeatherChart",
    rows.map((x) => weatherLabel(x.forecast_time)),
    [
      {
        label: "Температура, °C",
        data: rows.map((x) => x.temperature),
        borderColor: "#58e1ff",
        backgroundColor: "#58e1ff18",
        type: "line",
        yAxisID: "y",
      },
      {
        label: "Дощ, %",
        data: rows.map((x) => x.precipitation_probability),
        borderColor: "#715cff",
        backgroundColor: "#715cff55",
        type: "bar",
        yAxisID: "y1",
      },
    ],
  );
}
function scoreReasons(o, d, devices) {
  const offline = devices.filter((x) => !x.online),
    alerts = d.alerts || [],
    reasons = [],
    positive = [];
  if (offline.length)
    reasons.push(
      `${offline.length} пристрої без актуальних даних: ${offline.map((x) => x.device_name).join(", ")}`,
    );
  if (alerts.length) reasons.push(`${alerts.length} активних алертів`);
  if (o.scores.comfort < 80) reasons.push(`Comfort ${o.scores.comfort}/100`);
  else positive.push(`Comfort ${o.scores.comfort}/100`);
  if (!offline.length) positive.push("усі пристрої передають дані");
  if (o.scores.energy >= 80) positive.push("енергетичні показники стабільні");
  return { reasons, positive };
}
function scoreTile(icon, title, value, details, index) {
  return `<div class="insight scoreTile" data-score-index="${index}"><b>${icon} ${title}</b><br><strong>${value}</strong><div class="tip">${details}</div></div>`;
}
function renderScores(o, d, devices) {
  const r = scoreReasons(o, d, devices),
    alerts = d.alerts || [],
    offline = devices.filter((x) => !x.online),
    outdoor = devices.find((x) => x.is_outdoor);
  const summary = [...r.reasons, ...r.positive];
  $("scoreExplain").innerHTML =
    `<b>Оцінка дому ${fmt(o.scores.overall, 0)}/100 · ${o.scores.overall >= 80 ? "Дім у доброму стані" : o.scores.overall >= 60 ? "Є фактори для покращення" : "Є важливі проблеми"}</b>${summary.length ? "<br>" + summary.slice(0, 2).map(esc).join(" · ") + (summary.length > 2 ? "<br>Ще " + (summary.length - 2) + " фактор(и)" : "") : "<br>Суттєвих проблем не виявлено."}`;
  const defs = [
    [
      "🌡",
      "Комфорт",
      o.scores.comfort + "/100",
      `Кімнатний комфорт. ${esc(r.reasons.find((x) => x.startsWith("Comfort")) || "Температура і вологість у прийнятному діапазоні.")}`,
    ],
    [
      "⚡",
      "Енергія",
      o.scores.energy + "/100",
      `Поточна потужність ${fmt(o.today.power?.power, 0)} Вт, напруга ${fmt(o.today.power?.voltage, 1)} В.`,
    ],
    [
      "📟",
      "Пристрої",
      (state.deviceStatus?.online || 0) +
        "/" +
        (state.deviceStatus?.total || 0),
      offline.length
        ? `Offline: ${offline.map((x) => esc(x.device_name)).join(", ")}`
        : "Усі зареєстровані пристрої online.",
    ],
    [
      "🌦",
      "Погода",
      o.scores.weather + "/100",
      `На вулиці ${fmt(outdoor?.temperature ?? o.today.weather?.temperature)}°C. Ризик дощу ${fmt(d.weather.daily?.[0]?.precipitation_probability, 0)}%.`,
    ],
    [
      "🚨",
      "Алерти",
      alerts.length,
      alerts.length
        ? alerts
            .slice(0, 5)
            .map((x) => esc(x.alert_message))
            .join("<br>")
        : "Активних алертів немає.",
    ],
  ];
  $("scoreParts").innerHTML = defs.map((x, i) => scoreTile(...x, i)).join("");
  $("scoreParts").onclick = (e) => {
    const t = e.target.closest("[data-score-index]");
    if (t) {
      const x = defs[+t.dataset.scoreIndex];
      showDetail(x[0] + " " + x[1], `<div class="item">${x[3]}</div>`);
    }
  };
}
function render() {
  const o = state.overview,
    d = state.dash;
  if (!o || !d) return;
  const status = {
    good: ["good", "● Усе добре", "Ваш дім під контролем"],
    attention: [
      "attention",
      "● Потребує уваги",
      "Є події, які варто перевірити",
    ],
    critical: ["critical", "● Критична подія", "Потрібна ваша увага"],
  }[o.status];
  $("statusPill").className = "statusPill " + status[0];
  $("statusPill").textContent = status[1];
  $("heroTitle").textContent = status[2];
  $("heroText").textContent =
    d.alerts?.[0]?.alert_message ||
    o.recommendations?.[0]?.message ||
    "Система працює стабільно.";
  $("score").textContent = o.scores.overall;
  $("scoreRing").style.setProperty("--s", o.scores.overall);
  const discovered = allDevices(o, d),
    onlineCount = state.deviceStatus?.online || 0,
    deviceScore = state.deviceStatus?.total
      ? Math.round((onlineCount / state.deviceStatus.total) * 100)
      : 0;
  renderScores(o, d, discovered);
  const devices = discovered,
    onlineDevices = onlineCount;
  $("quickFacts").innerHTML =
    `<span class="fact">📟 ${onlineDevices}/${devices.length} online</span><span class="fact">🚨 ${o.today.alerts} алертів</span><span class="fact">⚡ ${fmt(o.today.power?.power, 0)} Вт</span><span class="fact">🌤 ${fmt(o.today.weather?.temperature)}°C</span>`;
  $("commandStrip").innerHTML = [
    commandMetric("⚡", "Зараз", fmt(o.today.power?.power, 0) + " Вт"),
    commandMetric(
      "⚡",
      "Сьогодні",
      fmt(d.insights.power.statistics.today.energy_total, 2) + " кВт·год",
    ),
    commandMetric(
      "📅",
      "Місяць",
      fmt(d.insights.power.statistics.month.energy_total, 2) + " кВт·год",
      fmt(d.insights.power.statistics.month.cost_total, 2) + " грн витрати",
    ),
    commandMetric(
      "💰",
      "Витрати сьогодні",
      fmt(d.insights.power.statistics.today.cost_total, 2) + " грн",
    ),
  ].join("");
  $("kpis").innerHTML = [
    kpi("🌡", "Comfort", o.scores.comfort + "/100"),
    kpi("⚡", "Energy", o.scores.energy + "/100"),
    kpi("📟", "Devices", o.scores.devices + "/100"),
    kpi("🌦", "Weather", o.scores.weather + "/100"),
    kpi("🚨", "Алерти", o.today.alerts),
  ].join("");
  $("recs").innerHTML =
    (o.recommendations || [])
      .map(
        (x) =>
          `<div class="item"><b>${esc(x.title)}</b><p>${esc(x.message)}</p></div>`,
      )
      .join("") || '<div class="item">✅ Термінових рекомендацій немає</div>';
  const rr = o.rooms || [];
  $("rooms").innerHTML = rr
    .map(
      (x, i) =>
        `<div class="room"><div class="row"><b>${i === 0 ? "🏆 " : ""}${esc(x.name)}</b><span class="statusPill ${x.comfort_score >= 75 ? "good" : "attention"}">${x.comfort_score}</span></div><h3>${fmt(x.temperature)}°C · ${fmt(x.humidity, 0)}%</h3><span class="roomTag">${i === 0 ? "🏆 Найкомфортніша" : "Оновлено"}</span><div class="miniTrend"></div></div>`,
    )
    .join("");
  const w = d.weather.current;
  $("weatherNow").textContent =
    `${w?.weather_icon || "🌦"} ${fmt(w?.temperature)} °C`;
  $("weatherInfo").textContent = w
    ? `${w.weather_description} · ${fmt(w.humidity, 0)}% · вітер ${fmt(w.wind_speed)} км/год`
    : "";
  $("forecast").innerHTML = (d.weather.daily || [])
    .map(
      (x) =>
        `<div class="forecastDay"><b>${esc(x.day_label)}</b><h2>${x.weather_icon}</h2><div>${fmt(x.temp_min)}…${fmt(x.temp_max)}°C</div><small>Дощ ${fmt(x.precipitation_probability, 0)}%</small></div>`,
    )
    .join("");
  const st = d.insights.power.statistics;
  $("dayEnergy").textContent = fmt(st.month.energy_day, 2) + " кВт·год";
  $("nightEnergy").textContent = fmt(st.month.energy_night, 2) + " кВт·год";
  $("monthCost").textContent = fmt(st.month.cost_total, 2) + " грн";
  renderDevices(o, d);
  renderAlertsAndRecommendations(o, d);
  renderOverviewCompact(o, d, devices);
  renderComfortMatrix(rr);
  renderCharts();
  renderEnergyExtras();
  renderWeather48();
}
async function loadSmartRange(scope, period, from = null, to = null) {
  const qs = new URLSearchParams({ period });
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (scope === "climate") {
    const hours = period === "day" ? 24 : period === "week" ? 168 : 744,
      [base, recent] = await Promise.all([
        req("/charts/climate?hours=" + Math.min(168, hours), { ttl: 0 }),
        req("/charts/climate?hours=6", { ttl: 0 }),
      ]);
    state.climate = mergeRecentClimate(base, recent);
    renderCharts();
    return;
  }
  const data = await req("/charts/energy/range?" + qs.toString(), { ttl: 0 });
  state.rangeSeries[scope] = data;
  renderCharts();
}
function setupSmartPeriods() {
  document.querySelectorAll(".smartPeriod").forEach(
    (p) =>
      (p.onclick = (e) => {
        const b = e.target.closest("[data-p]");
        if (!b) return;
        const scope = p.dataset.smartScope,
          period = b.dataset.p;
        p.querySelectorAll("button").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        state.smartPeriods[scope] = period;
        const custom = document.querySelector(`[data-custom="${scope}"]`);
        if (custom) custom.classList.toggle("show", period === "custom");
        if (period !== "custom") loadSmartRange(scope, period);
      }),
  );
  document.querySelectorAll(".customRange .apply").forEach(
    (b) =>
      (b.onclick = () => {
        const c = b.closest(".customRange"),
          scope = c.dataset.custom;
        loadSmartRange(
          scope,
          "custom",
          c.querySelector(".from").value,
          c.querySelector(".to").value,
        );
      }),
  );
}
function climateKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/sensor/g, "")
    .replace(/[^a-z0-9а-яіїєґ]/g, "");
}
function climateDeviceForSeries(id) {
  const devices = (state.deviceStatus?.items || []).filter(
    (x) => x.device_type === "climate",
  );
  const key = climateKey(id);
  let best = null,
    score = 0;
  for (const d of devices) {
    const did = climateKey(d.device_id),
      name = climateKey(d.device_name);
    let n = 0;
    if (key && did && key === did) n = 100;
    else if (key && name && key === name) n = 90;
    else if (key && did && (key.startsWith(did) || did.startsWith(key)))
      n = Math.min(key.length, did.length);
    else if (key && name && (key.startsWith(name) || name.startsWith(key)))
      n = Math.min(key.length, name.length);
    if (n > score) {
      score = n;
      best = d;
    }
  }
  return score >= 5 ? best : null;
}
function climateSeriesLabel(id, device) {
  return device?.device_name || id;
}
const floorPlanBindings = { 1: "hallway", 2: "bedroom", 5: "kidsroom" },
  floorPlanNames = { 1: "🚪 Коридор", 2: "🛏️ Спальня", 5: "👶 Дитяча" };
function floorPlanDevice(room) {
  const key = floorPlanBindings[String(room)];
  return (
    (state.deviceStatus?.items || []).find(
      (d) =>
        d.device_type === "climate" &&
        (climateKey(d.device_name) === key ||
          climateKey(d.device_id) === key ||
          climateKey(d.device_name).startsWith(key)),
    ) || null
  );
}
function floorPlanSeries(room) {
  const device = floorPlanDevice(room),
    keys = Object.keys(state.climate?.datasets || {});
  if (device) {
    const match = keys.find((id) => climateDeviceForSeries(id) === device);
    if (match) return match;
  }
  const wanted = floorPlanBindings[String(room)];
  return keys.find((id) => climateKey(id) === wanted) || null;
}
function floorPlanColor(device) {
  if (!device) return "#94a3b8";
  const value = +(state.floorPlanMetric === "humidity"
    ? device.humidity
    : device.temperature);
  if (!Number.isFinite(value)) return "#94a3b8";
  if (state.floorPlanMetric === "humidity")
    return value < 35
      ? "#f59e0b"
      : value <= 60
        ? "#34d399"
        : value <= 70
          ? "#38bdf8"
          : "#818cf8";
  return value < 18
    ? "#38bdf8"
    : value <= 25
      ? "#34d399"
      : value <= 29
        ? "#fbbf24"
        : "#f87171";
}
function floorPlanAgeLabel(minutes) {
  const value = Number(minutes);
  if (minutes == null || !Number.isFinite(value)) return "давно";
  if (value < 60) return Math.max(1, Math.floor(value)) + " хв";
  return Math.floor(value / 60) + " год";
}
function renderFloorPlan() {
  const svg = $("floorPlanSvg");
  if (!svg) return;
  for (const room of ["1", "2", "5"]) {
    const device = floorPlanDevice(room),
      id = floorPlanSeries(room),
      poly = svg.querySelector(`[data-plan-room="${room}"]`),
      name = svg.querySelector(`[data-plan-name="${room}"]`),
      value = svg.querySelector(`[data-plan-value="${room}"]`),
      readout = svg.querySelector(`[data-plan-readout="${room}"]`),
      title = readout?.querySelector("title"),
      selected = (state.climateSelectedRooms || []).includes(id) && id;
    if (poly) {
      poly.style.fill = floorPlanColor(device);
      poly.style.fillOpacity = device?.online === false ? ".15" : ".34";
      poly.classList.toggle("selected", !!selected);
    }
    if (name) name.textContent = floorPlanNames[room];
    if (value)
      value.textContent = device
        ? device.online === false
          ? "Офлайн · " + floorPlanAgeLabel(device.age_minutes)
          : `${fmt(device.temperature)}°C · ${fmt(device.humidity, 0)}%`
        : "Датчик не знайдено";
    if (title)
      title.textContent = device
        ? device.online === false
          ? `${floorPlanNames[room].replace(/^\S+\s/, "")} — офлайн, останній зв’язок ${ageText(device.age_minutes)} тому`
          : `${floorPlanNames[room].replace(/^\S+\s/, "")} — ${fmt(device.temperature)}°C, вологість ${fmt(device.humidity, 0)}%`
        : `${floorPlanNames[room].replace(/^\S+\s/, "")} — датчик не знайдено`;
  }
  const mode = $("climateOverlayToggle");
  if (mode)
    mode.textContent =
      "Накладання: " + (state.climateOverlayEnabled ? "увімкнено" : "вимкнено");
  const note = $("floorPlanNote");
  if (note)
    note.textContent = state.climateOverlayEnabled
      ? "Натискайте на кімнати, щоб додавати або прибирати серії з накладання."
      : "Натисніть на кімнату, щоб показати її історію; для порівняння ввімкніть накладання.";
}
function selectPlanRoom(room) {
  const id = floorPlanSeries(room);
  if (!id) {
    toast("Для цієї кімнати ще немає історії температури");
    return;
  }
  const entry = Object.entries(state.climate?.datasets || {}).find(
      ([key]) => key === id,
    ),
    device = floorPlanDevice(room);
  if (entry && device && !device.online) state.climateShowArchive = true;
  if (state.climateOverlayEnabled) {
    const set = new Set(state.climateSelectedRooms || []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    state.climateSelectedRooms = [...set];
    state.climatePlanRoom = set.has(id) ? String(room) : null;
  } else {
    state.climateSelectedRooms = [id];
    state.climatePlanRoom = String(room);
  }
  state.climateSelectionInitialized = true;
  renderFloorPlan();
  renderCharts();
}
function setupFloorPlanControls() {
  const svg = $("floorPlanSvg");
  if (svg) {
    svg.addEventListener("click", (e) => {
      const room = e.target.closest("[data-plan-room]");
      if (room?.classList.contains("mapped"))
        selectPlanRoom(room.dataset.planRoom);
    });
    svg.addEventListener("keydown", (e) => {
      const room = e.target.closest("[data-plan-room].mapped");
      if (room && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        selectPlanRoom(room.dataset.planRoom);
      }
    });
  }
  $("climateOverlayToggle")?.addEventListener("click", () => {
    state.climateOverlayEnabled = !state.climateOverlayEnabled;
    if (!state.climateOverlayEnabled && state.climateSelectedRooms.length > 1) {
      const preferred = state.climatePlanRoom
          ? floorPlanSeries(state.climatePlanRoom)
          : null,
        keep =
          preferred && state.climateSelectedRooms.includes(preferred)
            ? preferred
            : state.climateSelectedRooms[0];
      state.climateSelectedRooms = keep ? [keep] : [];
    }
    if (
      !state.climateOverlayEnabled &&
      !state.climatePlanRoom &&
      state.climateSelectedRooms.length
    ) {
      state.climatePlanRoom =
        ["1", "2", "5"].find(
          (room) => floorPlanSeries(room) === state.climateSelectedRooms[0],
        ) || null;
    }
    renderFloorPlan();
    renderCharts();
  });
  $("clearClimateSelection")?.addEventListener("click", () => {
    state.climateSelectedRooms = [];
    state.climatePlanRoom = null;
    state.climateSelectionInitialized = false;
    renderFloorPlan();
    renderCharts();
  });
  document.querySelectorAll("[data-floor-metric]").forEach(
    (b) =>
      (b.onclick = () => {
        state.floorPlanMetric = b.dataset.floorMetric;
        document
          .querySelectorAll("[data-floor-metric]")
          .forEach((x) => x.classList.toggle("active", x === b));
        renderFloorPlan();
      }),
  );
}
function renderClimateFilters(entries, colors) {
  const el = $("climateRoomFilters");
  if (!el) return;
  const archived = entries.filter((x) => !x.current),
    shown = entries.filter((x) => x.current || state.climateShowArchive);
  el.innerHTML =
    shown
      .map(
        (x) =>
          `<button type="button" class="seriesChip ${(state.climateSelectedRooms || []).includes(x.id) && !state.climateHidden[x.id] ? "active" : ""} ${(state.climateSelectedRooms || []).includes(x.id) ? "selected" : ""} ${x.current ? "" : "archived"}" style="--chip:${colors[x.colorIndex % colors.length]}" data-room-series="${encodeURIComponent(x.id)}"><span class="dot"></span>${esc(climateSeriesLabel(x.id, x.device))}${x.current ? "" : " · архів"}</button>`,
      )
      .join("") +
    (archived.length
      ? `<button type="button" class="seriesChip archiveToggle ${state.climateShowArchive ? "active" : ""}" data-climate-archive>${state.climateShowArchive ? "Сховати" : "Архів"} · ${archived.length}</button>`
      : "");
  el.onclick = (e) => {
    if (e.target.closest("[data-climate-archive]")) {
      state.climateShowArchive = !state.climateShowArchive;
      renderCharts();
      return;
    }
    const b = e.target.closest("[data-room-series]");
    if (!b) return;
    const id = decodeURIComponent(b.dataset.roomSeries),
      row = entries.find((x) => x.id === id);
    if (row && !row.current) state.climateShowArchive = true;
    state.climateHidden[id] = false;
    if (state.climateOverlayEnabled) {
      const set = new Set(state.climateSelectedRooms || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      state.climateSelectedRooms = [...set];
      state.climatePlanRoom =
        ["1", "2", "5"].find((room) => floorPlanSeries(room) === id) || null;
    } else {
      state.climateSelectedRooms = [id];
      state.climatePlanRoom =
        ["1", "2", "5"].find((room) => floorPlanSeries(room) === id) || null;
    }
    state.climateSelectionInitialized = true;
    renderFloorPlan();
    renderCharts();
  };
}
function climateTimeKey(value) {
  const raw = String(value ?? "").trim(),
    normalized = raw.includes("T") ? raw : raw.replace(" ", "T"),
    d = new Date(
      /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
        ? normalized
        : normalized + "Z",
    );
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}
function splitCumulativeTariffCosts(labels, costs, cumulative) {
  const settings = state.energyTariffSettings || {},
    toMinutes = (value, fallback) => {
      const m = String(timeValue(value) || fallback).match(/(\d{1,2}):(\d{2})/);
      return m
        ? Number(m[1]) * 60 + Number(m[2])
        : fallback === "07:00"
          ? 420
          : 1380;
    },
    dayStart = toMinutes(settings.day_start, "07:00"),
    nightStart = toMinutes(settings.night_start, "23:00"),
    day = [],
    night = [];
  let dayTotal = 0,
    nightTotal = 0,
    previousCumulative = 0;
  for (let i = 0; i < labels.length; i++) {
    let amount = Number(costs[i]);
    if (!Number.isFinite(amount)) {
      const current = Number(cumulative[i]);
      amount = Number.isFinite(current)
        ? Math.max(0, current - previousCumulative)
        : 0;
    }
    const current = Number(cumulative[i]);
    if (Number.isFinite(current)) previousCumulative = current;
    const timestamp = climateUtcMs(labels[i]);
    let minute = null;
    if (Number.isFinite(timestamp)) {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Kyiv",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(timestamp));
      minute =
        Number(parts.find((x) => x.type === "hour")?.value) * 60 +
        Number(parts.find((x) => x.type === "minute")?.value);
    }
    const isDay =
      minute === null
        ? false
        : dayStart === nightStart
          ? true
          : dayStart < nightStart
            ? minute >= dayStart && minute < nightStart
            : minute >= dayStart || minute < nightStart;
    if (isDay) dayTotal += Math.max(0, amount);
    else nightTotal += Math.max(0, amount);
    day.push(dayTotal);
    night.push(nightTotal);
  }
  return { day, night };
}
function renderCharts() {
  if (!state.power || !state.climate) return;
  const raw = state.energySeries || {},
    r1 = state.rangeSeries.energy,
    r2 = state.rangeSeries.energy2,
    pm = state.chartMetrics.power,
    em = state.chartMetrics.voltage,
    cm = state.chartMetrics.climate,
    src = r1?.points?.length ? r1.points : null,
    src2 = r2?.points?.length ? r2.points : src,
    labels = (
      src ? src.map((x) => x.label) : raw.labels || state.power.labels || []
    ).map(friendlyTime),
    labels2 = (
      src2 ? src2.map((x) => x.label) : raw.labels || state.power.labels || []
    ).map(friendlyTime);
  const avgPower = src
      ? src.map((x) => x.avg_power)
      : raw.datasets?.power || state.power.datasets.power,
    cost = src ? src.map((x) => x.cost) : raw.datasets?.cost || [],
    cumE = src
      ? src.map((x) => x.cumulative_energy)
      : raw.datasets?.cumulative_energy || [],
    cumC = src
      ? src.map((x) => x.cumulative_cost)
      : raw.datasets?.cumulative_cost || [],
    volt = src
      ? src.map((x) => x.avg_voltage)
      : raw.datasets?.voltage || state.power.datasets.voltage;
  if (pm === "voltage")
    dualChart("power", "powerChart", labels, [
      {
        label: "Напруга, В",
        data: volt,
        borderColor: "#ffc857",
        type: "line",
        yAxisID: "y",
      },
    ]);
  else if (pm === "energy") {
    const split = splitCumulativeTariffCosts(
      src ? src.map((x) => x.label) : raw.labels || state.power.labels || [],
      cost,
      cumC,
    );
    dualChart(
      "power",
      "powerChart",
      labels,
      [
        {
          label: "Накопичена енергія, кВт·год",
          data: cumE,
          borderColor: "#58e1ff",
          type: "line",
          yAxisID: "y",
        },
        {
          label: "Денний тариф",
          data: split.day,
          borderColor: "#58e1ff",
          backgroundColor: "#58e1ffbb",
          type: "bar",
          yAxisID: "y1",
          stack: "tariff-cost",
        },
        {
          label: "Нічний тариф",
          data: split.night,
          borderColor: "#715cff",
          backgroundColor: "#715cffbb",
          type: "bar",
          yAxisID: "y1",
          stack: "tariff-cost",
        },
      ],
      { tariffBands: true },
    );
  } else
    dualChart("power", "powerChart", labels, [
      {
        label: "Середня потужність, Вт",
        data: avgPower,
        borderColor: "#8c6cff",
        type: "line",
        yAxisID: "y",
      },
      {
        label: "Витрати за інтервал, грн",
        data: cost,
        borderColor: "#58e1ff",
        backgroundColor: "#58e1ff66",
        type: "bar",
        yAxisID: "y1",
      },
    ]);
  const avgPower2 = src2 ? src2.map((x) => x.avg_power) : avgPower,
    cost2 = src2 ? src2.map((x) => x.cost) : cost,
    cumE2 = src2 ? src2.map((x) => x.cumulative_energy) : cumE,
    cumC2 = src2 ? src2.map((x) => x.cumulative_cost) : cumC,
    volt2 = src2 ? src2.map((x) => x.avg_voltage) : volt;
  if (em === "voltage")
    dualChart("voltage", "voltageChart", labels2, [
      {
        label: "Напруга, В",
        data: volt2,
        borderColor: "#ffc857",
        type: "line",
        yAxisID: "y",
      },
    ]);
  else if (em === "power")
    dualChart("voltage", "voltageChart", labels2, [
      {
        label: "Середня потужність, Вт",
        data: avgPower2,
        borderColor: "#8c6cff",
        type: "line",
        yAxisID: "y",
      },
      {
        label: "Витрати за інтервал, грн",
        data: cost2,
        backgroundColor: "#58e1ff66",
        type: "bar",
        yAxisID: "y1",
      },
    ]);
  else {
    const split = splitCumulativeTariffCosts(
      src2 ? src2.map((x) => x.label) : raw.labels || state.power.labels || [],
      cost2,
      cumC2,
    );
    dualChart(
      "voltage",
      "voltageChart",
      labels2,
      [
        {
          label: "Накопичена енергія, кВт·год",
          data: cumE2,
          borderColor: "#58e1ff",
          type: "line",
          yAxisID: "y",
        },
        {
          label: "Денний тариф",
          data: split.day,
          borderColor: "#58e1ff",
          backgroundColor: "#58e1ffbb",
          type: "bar",
          yAxisID: "y1",
          stack: "tariff-cost",
        },
        {
          label: "Нічний тариф",
          data: split.night,
          borderColor: "#715cff",
          backgroundColor: "#715cffbb",
          type: "bar",
          yAxisID: "y1",
          stack: "tariff-cost",
        },
      ],
      { tariffBands: true },
    );
  }
  const colors = [
      "#ff9f43",
      "#bd83ff",
      "#35c8f2",
      "#35d5a2",
      "#ffc857",
      "#ff647c",
    ],
    allEntries = Object.entries(state.climate.datasets || {}).map(
      ([id, series], colorIndex) => {
        const device = climateDeviceForSeries(id);
        return {
          id,
          series,
          device,
          colorIndex,
          current: !!device && (!!device.online || device.status === "online"),
        };
      },
    );
  let displayEntries = allEntries.filter(
    (x) => x.current || state.climateShowArchive,
  );
  if (!state.climateSelectionInitialized) {
    const primary = allEntries.find((x) => x.current);
    state.climateSelectedRooms = primary ? [primary.id] : [];
    state.climateOverlayEnabled = false;
    state.climatePlanRoom = primary
      ? ["1", "2", "5"].find((room) => floorPlanSeries(room) === primary.id) ||
        null
      : null;
    state.climateSelectionInitialized = true;
  }
  displayEntries = displayEntries.filter((x) =>
    state.climateSelectedRooms.includes(x.id),
  );
  renderClimateFilters(allEntries, colors);
  const tempDs = [],
    humidityDs = [],
    gapLimit = 2 * 60 * 60 * 1000,
    hours = Number(state.chartHours?.climate) || 24,
    bucketMs = hours > 168 ? 30 * 60 * 1000 : hours > 24 ? 15 * 60 * 1000 : 0,
    primaryId = state.climateSelectedRooms[0],
    makePoints = (keys, values) => {
      const buckets = new Map();
      keys.forEach((key, index) => {
        const x = Date.parse(key),
          y = Number(values[index]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const bucket = bucketMs ? Math.floor(x / bucketMs) * bucketMs : x,
          group = buckets.get(bucket) || { sum: 0, count: 0 };
        group.sum += y;
        group.count++;
        buckets.set(bucket, group);
      });
      const points = [...buckets.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([bucket, g]) => ({
            x: bucketMs ? bucket + bucketMs / 2 : bucket,
            y: g.sum / g.count,
            count: g.count,
          })),
        withGaps = [];
      let previous = null;
      points.forEach((point) => {
        if (previous && point.x - previous.x > gapLimit)
          withGaps.push({
            x: previous.x + (point.x - previous.x) / 2,
            y: null,
          });
        withGaps.push(point);
        previous = point;
      });
      return withGaps;
    };
  displayEntries.forEach(({ id, series, device, colorIndex }) => {
    if (state.climateHidden[id]) return;
    const color = colors[colorIndex % colors.length],
      label = climateSeriesLabel(id, device),
      keys = (series.labels || []).map(climateTimeKey),
      primary = id === primaryId,
      style = {
        borderColor: primary ? color : color + "99",
        backgroundColor: color,
        pointBackgroundColor: color,
        pointBorderColor: color,
        pointBorderWidth: 0,
        borderWidth: primary ? 2.5 : 1.7,
        tension: 0.12,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHitRadius: 9,
        spanGaps: false,
        showLine: true,
      };
    tempDs.push({
      label,
      data: makePoints(keys, series.temperature || []),
      ...style,
    });
    humidityDs.push({
      label,
      data: makePoints(keys, series.humidity || []),
      ...style,
    });
  });
  const allPoints = [...tempDs, ...humidityDs].flatMap((d) =>
      d.data.filter((p) => Number.isFinite(p.y)).map((p) => p.x),
    ),
    xMin = allPoints.length
      ? allPoints.reduce((a, b) => Math.min(a, b), Infinity)
      : undefined,
    xMax = allPoints.length
      ? allPoints.reduce((a, b) => Math.max(a, b), -Infinity)
      : undefined,
    renderClimateLine = (key, id, datasets, min, max, unit) => {
      const canvas = $(id);
      if (!canvas || typeof Chart === "undefined") return;
      state.charts[key]?.destroy();
      state.charts[key] = new Chart(canvas, {
        type: "line",
        data: { datasets },
        plugins: [
          {
            id: "climateExtrema",
            afterDatasetsDraw(chart) {
              const i = chart.data.datasets.findIndex(
                  (ds) => Number(ds.borderWidth) >= 2.5,
                ),
                ds = chart.data.datasets[i];
              if (i < 0 || !ds) return;
              const values = (ds.data || [])
                .map((p, n) => ({ p, n }))
                .filter((x) => x.p && Number.isFinite(+x.p.y));
              if (!values.length) return;
              let lo = values[0],
                hi = values[0];
              for (const x of values) {
                if (+x.p.y < +lo.p.y) lo = x;
                if (+x.p.y > +hi.p.y) hi = x;
              }
              const marks =
                  lo.n === hi.n
                    ? [{ entry: lo, title: "Мін/макс" }]
                    : [
                        { entry: lo, title: "Мін" },
                        { entry: hi, title: "Макс" },
                      ],
                meta = chart.getDatasetMeta(i),
                ctx = chart.ctx,
                area = chart.chartArea;
              ctx.save();
              ctx.font = "700 10px Inter,system-ui,sans-serif";
              ctx.textBaseline = "middle";
              for (const mark of marks) {
                const point = meta.data[mark.entry.n];
                if (!point || point.skip) continue;
                const pos = point.getProps(["x", "y"], true),
                  value = (+mark.entry.p.y).toFixed(1).replace(".", ","),
                  label = mark.title + " " + value + " " + unit,
                  w = ctx.measureText(label).width + 12,
                  h = 19;
                let x = pos.x + 8;
                if (x + w > area.right) x = pos.x - w - 8;
                x = Math.max(area.left + 1, Math.min(x, area.right - w - 1));
                let y = pos.y - 24;
                if (y < area.top) y = pos.y + 9;
                y = Math.max(area.top + 1, Math.min(y, area.bottom - h - 1));
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = "#f7fbff";
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = ds.borderColor;
                ctx.stroke();
                ctx.fillStyle = "#071522";
                ctx.strokeStyle = ds.borderColor;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.roundRect(x, y, w, h, 5);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = "#f5f8ff";
                ctx.fillText(label, x + 6, y + h / 2);
              }
              ctx.restore();
            },
          },
        ],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: "nearest", axis: "x", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: true,
              backgroundColor: "#0b1727",
              titleColor: "#f5f8ff",
              bodyColor: "#eef5ff",
              borderColor: "#7c9bb8",
              borderWidth: 1,
              displayColors: true,
              callbacks: {
                title: (items) =>
                  items.length
                    ? new Date(items[0].parsed.x).toLocaleString("uk-UA", {
                        day: "2-digit",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "",
                label: (c) =>
                  " " +
                  c.dataset.label +
                  ": " +
                  (Number.isFinite(+c.parsed.y)
                    ? Number(c.parsed.y).toFixed(1)
                    : "—") +
                  unit +
                  (c.raw?.count > 1
                    ? " · середнє за " + c.raw.count + " вимірів"
                    : ""),
              },
            },
          },
          scales: {
            x: {
              type: "linear",
              min: xMin,
              max: xMax,
              ticks: {
                color: "#d2deee",
                autoSkip: false,
                maxRotation: 0,
                font: { size: window.innerWidth <= 650 ? 10 : 12 },
                callback: (v) => {
                  const local = kyivParts(Number(v));
                  return `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
                },
              },
              afterBuildTicks: (scale) => {
                scale.ticks = timeAxisTicks(
                  xMin,
                  xMax,
                  scale.width || canvas.clientWidth || 500,
                ).map((value) => ({ value }));
              },
              grid: { color: "#ffffff18" },
            },
            y: {
              min,
              max,
              ticks: {
                color: "#e0eaff",
                stepSize: unit === "°C" ? 2 : 10,
                callback: (v) => v + unit,
              },
              grid: { color: "#ffffff20" },
            },
          },
        },
      });
    };
  renderClimateLine("climateTemp", "climateTempChart", tempDs, 16, 32, "°C");
  renderClimateLine(
    "climateHumidity",
    "climateHumidityChart",
    humidityDs,
    0,
    100,
    "%",
  );
  const metric = state.chartMetrics.climate || "tempHumidity";
  const tp = $("climateTemperaturePanel"),
    hp = $("climateHumidityPanel");
  if (tp) tp.hidden = metric === "humidity";
  if (hp) hp.hidden = metric === "temperature";
  document
    .querySelectorAll('[data-mscope="climate"] [data-metric]')
    .forEach((b) => b.classList.toggle("active", b.dataset.metric === metric));
  const statEntry =
      displayEntries.find(
        (x) => x.id === floorPlanSeries(state.climatePlanRoom),
      ) || displayEntries[0],
    statBlock = $("climatePeriodStats");
  if (statBlock) {
    if (!statEntry) {
      statBlock.innerHTML =
        "<h3>Значення за період</h3><p>Немає даних для вибраних кімнат.</p>";
    } else {
      const stats = (arr) => {
          const n = arr.map(Number).filter(Number.isFinite);
          return n.length
            ? {
                min: Math.min(...n),
                avg: n.reduce((a, b) => a + b, 0) / n.length,
                max: Math.max(...n),
              }
            : null;
        },
        t = stats(statEntry.series.temperature || []),
        h = stats(statEntry.series.humidity || []),
        row = (title, icon, s, unit) =>
          '<div class="climateStatRow"><b>' +
          icon +
          " " +
          title +
          "</b><span>Мін. " +
          (s ? fmt(s.min, 1) : "—") +
          unit +
          "</span><span>Сер. " +
          (s ? fmt(s.avg, 1) : "—") +
          unit +
          "</span><span>Макс. " +
          (s ? fmt(s.max, 1) : "—") +
          unit +
          "</span></div>";
      statBlock.innerHTML =
        "<h3>Значення за період <em>(" +
        esc(climateSeriesLabel(statEntry.id, statEntry.device)) +
        ")</em></h3>" +
        row("Температура", "🌡", t, " °C") +
        row("Вологість", "💧", h, " %");
    }
  }
  const meta = $("climateChartMeta");
  if (meta)
    meta.textContent = displayEntries.length
      ? "Останні 6 годин показані 15-хвилинними середніми, раніші — погодинними. Час у підказках наведено за Києвом."
      : "Немає історії для активних датчиків. Перевірте підключення або відкрийте архів.";
  renderFloorPlan();
}
document.querySelectorAll(".chartType").forEach((x) => {
  x.value = localStorage.getItem("chart-" + x.dataset.chart) || "line";
  x.onchange = () => {
    localStorage.setItem("chart-" + x.dataset.chart, x.value);
    savePreference("chart-" + x.dataset.chart, x.value);
    renderCharts();
  };
});
document.querySelectorAll(".metricSwitch").forEach(
  (sw) =>
    (sw.onclick = (e) => {
      const b = e.target.closest("[data-metric]");
      if (!b) return;
      sw.querySelectorAll("button").forEach((x) =>
        x.classList.toggle("active", x === b),
      );
      state.chartMetrics[sw.dataset.mscope] = b.dataset.metric;
      renderCharts();
    }),
);
setupFloorPlanControls();

async function loadAll(force = false) {
  if (state.loading || (!force && document.visibilityState !== "visible"))
    return;
  state.loading = true;
  document.body.classList.add("isLoading");
  try {
    const hours = state.chartHours.power || 24,
      base = [
        req("/dashboard", { ttl: force ? 0 : 60000 }),
        req("/devices/status", { ttl: force ? 0 : 60000 }),
      ],
      needCharts =
        state.loadedTabs.has("home") ||
        state.loadedTabs.has("energy") ||
        state.loadedTabs.has("climate"),
      all = needCharts
        ? base.concat([
            req("/charts/power?hours=" + hours, { ttl: force ? 0 : 300000 }),
            req("/charts/climate?hours=" + (state.chartHours.climate || 24), {
              ttl: force ? 0 : 300000,
            }),
            req("/charts/energy?hours=" + (state.chartHours.energy || 24), {
              ttl: force ? 0 : 300000,
            }),
            req("/charts/energy/range?period=day", { ttl: force ? 0 : 60000 }),
            req("/charts/climate?hours=24", { ttl: force ? 0 : 60000 }),
            req("/charts/climate?hours=6", { ttl: force ? 0 : 60000 }),
          ])
        : base,
      [d, ds, p, c, en, homeEn, homeCl, recentCl] = await Promise.all(all);
    Object.assign(state, {
      overview: d.control_overview,
      dash: d,
      deviceStatus: ds,
    });
    if (p) state.power = p;
    if (c) state.climate = mergeRecentClimate(c, recentCl);
    if (en) state.energySeries = en;
    if (homeEn) state.homeEnergy24 = homeEn;
    if (homeCl) state.homeClimate24 = mergeRecentClimate(homeCl, recentCl);
    render();
    if (!state.rangeSeries.energy) {
      loadSmartRange("energy", "week");
      loadSmartRange("energy2", "week");
    }
    if (!state.tariffRange) loadTariffRange();
    if (!state.loadedClimateWeek) {
      state.loadedClimateWeek = true;
      loadSmartRange("climate", "week");
    }
    $("updated").textContent =
      "Оновлено " +
      new Date().toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      });
  } catch (e) {
    $("updated").textContent = "Помилка завантаження";
    toast(e.message);
    console.error("Dashboard load/render error", e);
  } finally {
    state.loading = false;
    document.body.classList.remove("isLoading");
  }
}
async function loadTimeline() {
  try {
    const j = await req("/timeline?limit=100", { ttl: 60000 }),
      timeline = j.items || [],
      alerts = state.dash?.alerts || [],
      recs = state.dash?.recommendations || [];
    state.timelineItems = timeline.length
      ? timeline
      : [
          ...alerts.map((x) => ({
            category: "alert",
            title: x.alert_type || "Алерт",
            message: x.alert_message,
            created_at: x.created_at,
            severity: x.severity,
          })),
          ...recs.map((x) => ({
            category: x.category || "recommendation",
            title: x.title || "Рекомендація",
            message: x.message,
            created_at: x.created_at || x.generated_at || "",
            severity: x.priority,
          })),
        ].sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)),
        );
    renderTimelineItems();
  } catch (e) {
    toast(e.message);
  }
}
function schedule() {
  clearInterval(state.timer);
  const ms = state.mode === "live" ? 60000 : state.mode === "eco" ? 300000 : 0;
  if (ms) state.timer = setInterval(() => loadAll(false), ms);
  $("mode").value = state.mode;
}
$("mode").onchange = (e) => {
  state.mode = e.target.value;
  localStorage.setItem("hmMode", state.mode);
  savePreference("refresh-mode", state.mode);
  schedule();
};
$("refresh").onclick = () => loadAll(true);
$("theme").onclick = () =>
  (document.documentElement.dataset.theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark");
document.addEventListener("visibilitychange", () => {
  hideChartTooltips();
  if (document.visibilityState === "visible" && state.mode !== "manual")
    loadAll(false);
});
window.addEventListener(
  "scroll",
  () => {
    const tooltip = document.getElementById("roomSparkTooltip");
    if (tooltip) tooltip.style.opacity = "0";
  },
  { passive: true },
);
function openLogin() {
  $("loginModal").classList.add("show");
  $("password").focus();
}
function closeLogin() {
  $("loginModal").classList.remove("show");
}
async function login() {
  try {
    const j = await req("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: $("password").value }),
    });
    state.token = j.token;
    sessionStorage.setItem("hmAdmin", j.token);
    closeLogin();
    $("locked").hidden = true;
    $("adminApp").hidden = false;
    loadAdmin();
    toast("Вхід виконано");
  } catch (e) {
    $("loginError").textContent = e.message;
  }
}
async function logout() {
  try {
    await req("/auth/logout", { method: "POST" });
  } catch {}
  state.token = "";
  sessionStorage.removeItem("hmAdmin");
  $("locked").hidden = false;
  $("adminApp").hidden = true;
  toast("Сесію завершено");
}
async function checkSession() {
  if (!state.token) return;
  try {
    await req("/auth/session");
    $("locked").hidden = true;
    $("adminApp").hidden = false;
  } catch {
    state.token = "";
    sessionStorage.removeItem("hmAdmin");
  }
}
function adminPage(x) {
  document
    .querySelectorAll(".adminPage")
    .forEach((p) => p.classList.toggle("active", p.id === "ap-" + x));
  if (x === "audit") loadAudit();
}
async function loadAdmin() {
  try {
    const [ch, cat, set, modes, prefs] = await Promise.all([
      req("/admin/channels"),
      req("/admin/categories"),
      req("/admin/settings"),
      req("/admin/modes"),
      req("/admin/preferences"),
    ]);
    state.admin = {
      channels: ch.channels || [],
      overrides: ch.overrides || [],
      categories: cat.categories || [],
    };
    state.energyTariffSettings = {
      day_start: set.settings?.day_start || "07:00",
      night_start: set.settings?.night_start || "23:00",
    };
    renderChannels(state.admin.channels);
    renderCategories(state.admin.categories);
    renderSettings(set.settings);
    renderModes(modes.modes || []);
    applyPreferences(prefs.preferences || {});
  } catch (e) {
    toast(e.message);
  }
}
function renderChannels(a) {
  $("channelsList").innerHTML =
    (a || [])
      .map((c) => {
        const cats = state.admin.categories
          .map((k) => {
            const o = state.admin.overrides.find(
                (x) =>
                  String(x.chat_id) === String(c.chat_id) &&
                  x.category_key === k.category_key,
              ),
              on = o ? !!o.enabled : true;
            return `<label class="item"><input class="toggle" type="checkbox" ${on ? "checked" : ""} onchange="setChannelCategory('${esc(c.chat_id)}','${encodeURIComponent(k.category_key)}',this.checked)"> ${esc(k.category_key)}</label>`;
          })
          .join("");
        return `<div class="item"><div class="row"><div><b>${esc(c.channel_name || c.chat_id)}</b><br><small>${esc(c.chat_id)}</small></div><label><input class="toggle" type="checkbox" ${c.enabled ? "checked" : ""} onchange="patchChannel(${c.id},{enabled:this.checked?1:0})"> активний</label></div><div class="formGrid"><label class="field">Тихі години <input type="checkbox" ${c.quiet_enabled ? "checked" : ""} onchange="patchChannel(${c.id},{quiet_enabled:this.checked?1:0})"></label><label class="field">Початок<input class="input" type="time" value="${timeValue(c.quiet_start)}" onchange="patchChannel(${c.id},{quiet_start:this.value})"></label><label class="field">Кінець<input class="input" type="time" value="${timeValue(c.quiet_end)}" onchange="patchChannel(${c.id},{quiet_end:this.value})"></label></div><details><summary>Категорії цього каналу</summary><div class="formGrid">${cats}</div></details><div class="chartTools"><button class="btn" onclick="testChannel(${c.id})">🧪 Тест</button><button class="btn danger" onclick="deleteChannel(${c.id})">Видалити</button></div></div>`;
      })
      .join("") || '<div class="item">Каналів немає</div>';
}
async function setChannelCategory(chat_id, k, enabled) {
  try {
    await req("/admin/channel-category", {
      method: "PATCH",
      body: JSON.stringify({
        chat_id,
        category_key: decodeURIComponent(k),
        enabled: enabled ? 1 : 0,
      }),
    });
    toast("Маршрут каналу оновлено");
  } catch (e) {
    toast(e.message);
  }
}
async function patchChannel(id, b) {
  try {
    await req("/admin/channels/" + id, {
      method: "PATCH",
      body: JSON.stringify(b),
    });
    toast("Канал оновлено");
    loadAdmin();
  } catch (e) {
    toast(e.message);
  }
}
async function testChannel(id) {
  try {
    await req("/admin/test-notification", {
      method: "POST",
      body: JSON.stringify({ channel_id: id }),
    });
    toast("Тест надіслано");
  } catch (e) {
    toast(e.message);
  }
}
async function deleteChannel(id) {
  if (!confirm("Видалити канал?")) return;
  await req("/admin/channels/" + id, { method: "DELETE" });
  loadAdmin();
}
async function addChannel() {
  const chat_id = prompt("Chat ID каналу, наприклад -100...");
  if (!chat_id) return;
  const channel_name = prompt("Назва каналу") || chat_id;
  await req("/admin/channels", {
    method: "POST",
    body: JSON.stringify({ chat_id, channel_name }),
  });
  loadAdmin();
}
function renderCategories(a) {
  const html = (a || [])
    .map(
      (c) =>
        `<div class="item"><div class="row"><div><b>${esc(c.category_key)}</b><br><small>${esc(c.mode || "event")}</small></div><label><input class="toggle" type="checkbox" ${c.enabled ? "checked" : ""} onchange="patchCategory('${encodeURIComponent(c.category_key)}',{enabled:this.checked?1:0})"></label></div><div class="formGrid"><label class="field">Cooldown, хв<input class="input" type="number" value="${c.cooldown || 60}" onchange="patchCategory('${encodeURIComponent(c.category_key)}',{cooldown:+this.value})"></label><label class="field">Час<input class="input" type="time" value="${timeValue(c.schedule_time)}" onchange="patchCategory('${encodeURIComponent(c.category_key)}',{schedule_time:this.value||null})"></label></div></div>`,
    )
    .join("");
  $("categoriesList").innerHTML = html;
  $("schedulesList").innerHTML = html;
}
async function patchCategory(k, b) {
  try {
    await req("/admin/categories/" + k, {
      method: "PATCH",
      body: JSON.stringify(b),
    });
    toast("Категорію оновлено");
  } catch (e) {
    toast(e.message);
  }
}
function renderModes(a) {
  $("modesList").innerHTML =
    (a || [])
      .map(
        (m) =>
          `<label class="item row"><span><b>${esc(m.title || m.mode_key)}</b><br><small>${esc(m.mode_key)}</small></span><input class="toggle" type="radio" name="homeMode" ${m.enabled ? "checked" : ""} onchange="setMode('${encodeURIComponent(m.mode_key)}')"></label>`,
      )
      .join("") || '<div class="item">Режими не налаштовані</div>';
}
async function setMode(k) {
  try {
    await req("/admin/modes/" + k, {
      method: "PATCH",
      body: JSON.stringify({ enabled: 1 }),
    });
    toast("Режим дому змінено");
    loadAdmin();
  } catch (e) {
    toast(e.message);
  }
}
function applyPreferences(p) {
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith("chart-")) localStorage.setItem(k, v);
    if (k === "refresh-mode") {
      state.mode = v;
      schedule();
    }
  }
  renderCharts();
}
async function savePreference(k, v) {
  if (!state.token) return;
  try {
    await req("/admin/preferences", {
      method: "PATCH",
      body: JSON.stringify({ preferences: { [k]: v } }),
    });
  } catch (e) {
    console.warn(e);
  }
}
const labels = {
  timezone: "Часовий пояс",
  city: "Місто",
  latitude: "Широта",
  longitude: "Довгота",
  day_tariff: "Денний тариф",
  night_tariff: "Нічний тариф",
  day_start: "Початок дня",
  night_start: "Початок ночі",
  device_timeout_minutes: "Timeout датчика, хв",
  max_power_alert_watts: "Максимальна потужність, Вт",
  voltage_low_alert: "Низька напруга, В",
  voltage_high_alert: "Висока напруга, В",
  default_temp_low: "Мін. температура",
  default_temp_high: "Макс. температура",
  default_humidity_high: "Макс. вологість",
  rain_alert_probability: "Поріг дощу, %",
  ventilation_humidity_threshold: "Провітрювання від, %",
  telegram_enabled: "Telegram увімкнено",
};
function renderSettings(s) {
  $("settingsForm").innerHTML = Object.entries(labels)
    .map(
      ([k, l]) =>
        `<label class="field">${l}<input class="input setting" data-key="${k}" value="${esc(s[k] ?? "")}"></label>`,
    )
    .join("");
}
async function saveSettings() {
  const settings = Object.fromEntries(
    [...document.querySelectorAll(".setting")].map((x) => [
      x.dataset.key,
      x.value,
    ]),
  );
  await req("/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({ settings }),
  });
  state.energyTariffSettings = {
    day_start: settings.day_start || "07:00",
    night_start: settings.night_start || "23:00",
  };
  renderCharts();
  toast("Налаштування збережено");
}
async function loadAudit() {
  try {
    const j = await req("/admin/audit");
    $("auditList").innerHTML = (j.items || [])
      .map(
        (x) =>
          `<div class="item"><div class="row"><b>${esc(x.action)} · ${esc(x.entity_type)}</b><small>${esc(x.created_at)}</small></div><small>${esc(x.entity_id)}</small></div>`,
      )
      .join("");
  } catch (e) {
    toast(e.message);
  }
}

function initAssistantWidget() {
  const widget = $("assistantWidget");
  if (!widget) return;
  const toggle = $("assistantToggle"),
    panel = $("assistantPanel"),
    messagesNode = $("assistantMessages"),
    form = $("assistantForm"),
    input = $("assistantInput"),
    send = $("assistantSend"),
    templateList = $("assistantTemplateList"),
    templateTitle = $("assistantTemplateTitle"),
    templateBack = $("assistantTemplateBack"),
    storageKey = "hmAssistantConversation",
    messagesKey = "hmAssistantMessages";
  const templateCategories = [
    {
      title: "🚨 Алерти й сигнали",
      prompts: [
        "Які активні події та сповіщення зараз потребують уваги?",
        "Як працюють правила сповіщень, пороги та тихі години?",
      ],
    },
    {
      title: "🌡️ Температура й вологість",
      prompts: [
        "Які зараз температура та вологість у кімнатах?",
        "Порівняй мінімальну, середню й максимальну температуру та вологість у кімнатах за останні 24 години.",
        "У яких кімнатах зараз температура або вологість поза комфортними межами?",
      ],
    },
    {
      title: "⚡ Споживання й витрати",
      prompts: [
        "Скільки електроенергії спожито сьогодні та скільки це коштує?",
        "Порівняй споживання електрики поточної ночі й минулої ночі у кВт·год і відсотках.",
        "Який зараз діє тариф на електроенергію і коли він змінюється?",
      ],
    },
    {
      title: "🔌 Напруга й мережа",
      prompts: [
        "Яка зараз напруга в мережі та чи вона в межах норми?",
        "Покажи мінімальну, середню й максимальну напругу за останні 24 години.",
      ],
    },
    {
      title: "⚙️ Система й розрахунки",
      prompts: [
        "Чи всі активні пристрої передають актуальні дані? Покажи час останнього зв’язку.",
        "Що формує Home Score і які чинники зараз знижують оцінку?",
      ],
    },
    {
      title: "🌦️ Погода й прогноз",
      prompts: [
        "Який прогноз температури та ймовірності опадів на найближчі 24 години?",
        "Які погодні ризики очікуються найближчим часом і коли саме?",
      ],
    },
  ];
  let conversationId = localStorage.getItem(storageKey);
  if (!conversationId || !/^[a-f0-9-]{36}$/i.test(conversationId)) {
    conversationId = crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 3) | 8).toString(16);
        });
    localStorage.setItem(storageKey, conversationId);
  }
  let transcript = [];
  try {
    transcript = JSON.parse(localStorage.getItem(messagesKey) || "[]");
  } catch {
    transcript = [];
  }
  if (!Array.isArray(transcript)) transcript = [];
  if (!transcript.length)
    transcript.push({
      role: "assistant",
      text: "Вітаю! Запитай про показники дому або попроси пояснити, як вони формуються.",
    });

  const save = () => {
      try {
        localStorage.setItem(
          messagesKey,
          JSON.stringify(transcript.slice(-24)),
        );
      } catch {}
    },
    render = () => {
      messagesNode.replaceChildren();
      transcript.slice(-24).forEach((message) => {
        const bubble = document.createElement("div");
        bubble.className = `assistantMessage ${message.role === "user" ? "user" : "assistant"}${message.pending ? " pending" : ""}`;
        bubble.textContent = message.text;
        messagesNode.append(bubble);
      });
      messagesNode.scrollTop = messagesNode.scrollHeight;
    },
    setOpen = (open) => {
      widget.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      panel.setAttribute("aria-hidden", String(!open));
      toggle.setAttribute(
        "aria-label",
        open ? "Закрити AI-помічника" : "Відкрити AI-помічника",
      );
      if (open) setTimeout(() => input.focus(), 80);
    };

  const showTemplateCategories = () => {
      templateTitle.textContent = "Корисні запитання";
      templateBack.hidden = true;
      templateList.replaceChildren();
      templateCategories.forEach((category, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "assistantTemplateCategory";
        button.textContent = `${category.title} · ${category.prompts.length}`;
        button.setAttribute("aria-expanded", "false");
        button.addEventListener("click", () => showTemplatePrompts(index));
        templateList.append(button);
      });
    },
    showTemplatePrompts = (index) => {
      const category = templateCategories[index];
      if (!category) return showTemplateCategories();
      templateTitle.textContent = category.title;
      templateBack.hidden = false;
      templateList.replaceChildren();
      category.prompts.forEach((prompt) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "assistantTemplatePrompt";
        button.textContent = prompt;
        button.addEventListener("click", () => {
          input.value = prompt;
          form.requestSubmit();
        });
        templateList.append(button);
      });
    };

  showTemplateCategories();
  render();
  toggle.addEventListener("click", () =>
    setOpen(!widget.classList.contains("is-open")),
  );
  $("assistantClose").addEventListener("click", () => setOpen(false));
  $("assistantClear").addEventListener("click", async () => {
    try {
      const response = await fetch("/assistant/chat/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      if (!response.ok) throw new Error("Не вдалося очистити історію чату.");
      transcript = [{ role: "assistant", text: "Чат очищено. Чим допомогти?" }];
      save();
      render();
    } catch (error) {
      transcript.push({
        role: "assistant",
        text: error.message || "Не вдалося очистити чат.",
      });
      save();
      render();
    }
  });
  templateBack.addEventListener("click", showTemplateCategories);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || send.disabled) return;
    transcript.push({ role: "user", text: message });
    const pending = { role: "assistant", text: "Думаю…", pending: true };
    transcript.push(pending);
    input.value = "";
    send.disabled = true;
    save();
    render();
    try {
      const response = await fetch("/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || "Не вдалося отримати відповідь.");
      pending.text = String(result.answer || "Не отримав текстової відповіді.");
      delete pending.pending;
    } catch (error) {
      pending.text =
        error.message || "З’єднання з помічником перервано. Спробуй ще раз.";
      delete pending.pending;
    } finally {
      send.disabled = false;
      save();
      render();
      input.focus();
    }
  });
}

setupPeriods();
setupTimelineFilters();
setupSmartPeriods();
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) showView(go.dataset.go);
  const wm = e.target.closest("[data-wmetric]");
  if (wm) {
    state.weatherMetric = wm.dataset.wmetric;
    $("weatherMetric")
      .querySelectorAll("button")
      .forEach((x) => x.classList.toggle("active", x === wm));
    renderWeather48();
  }
});
const nowMonth = new Date().toISOString().slice(0, 7);
if ($("tariffMonth")) $("tariffMonth").value = nowMonth;
setTariffRangeMode("month");
document
  .querySelectorAll("[data-tariff-mode]")
  .forEach(
    (button) =>
      (button.onclick = () => setTariffRangeMode(button.dataset.tariffMode)),
  );
if ($("tariffApply")) $("tariffApply").onclick = loadTariffRange;
if ($("tariffMonth"))
  $("tariffMonth").onchange = () => {
    if ($("tariffFrom")) $("tariffFrom").value = "";
    if ($("tariffTo")) $("tariffTo").value = "";
    loadTariffRange();
  };
$("heroRefresh").onclick = () => loadAll(true);
if ($("detailClose"))
  $("detailClose").onclick = () => $("detailModal")?.classList.remove("show");
if ($("detailModal"))
  $("detailModal").onclick = (e) => {
    if (e.target === $("detailModal"))
      $("detailModal").classList.remove("show");
  };
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLogin();
});
checkSession();
schedule();
loadAll(true);
initAssistantWidget();
