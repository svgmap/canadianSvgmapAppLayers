// Description:
// TTC GTFS-Realtime for svgmapjs LaWA (Direct Fetch / English Version)
//
// License: (MPL v2)
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

"use strict";

const REFRESH_INTERVAL = 30 * 1000;
const STALE_VEHICLE_SECONDS = 5 * 60;
const MAX_TRAIL_LENGTH = 7;
const APP_START_TIME = Date.now();

const VEHICLE_PROPERTIES = [
  "Entity ID",
  "Vehicle ID",
  "Vehicle Label",
  "License Plate",
  "Type",
  "Route ID",
  "Trip ID",
  "Direction ID",
  "Start Time",
  "Operating Date",
  "Next Stop ID",
  "Stop Sequence",
  "Current Status",
  "Congestion Level",
  "Occupancy",
  "Wheelchair Accessible",
  "Latitude",
  "Longitude",
  "Bearing",
  "Speed (km/h)",
  "Vehicle Data Time",
];

const TTC_DATA_SOURCES = {
  vehicle: {
    endpoint: "https://gtfsrt.ttc.ca/vehicles/position?format=binary",
    label: "Vehicle Positions",
    countLabel: "Vehicles",
    unit: " vehicles",
    emptyMessage: "No vehicles with location data found.",
  },
  trip: {
    endpoint: "https://gtfsrt.ttc.ca/trips/update?format=binary",
    label: "Trip Updates",
    countLabel: "Trips",
    unit: " trips",
    emptyMessage: "No trip updates currently available.",
  },
  alert: {
    endpoint: "https://gtfsrt.ttc.ca/alerts/all?format=binary",
    label: "Service Alerts",
    countLabel: "Alerts",
    unit: " alerts",
    emptyMessage: "No service alerts currently available.",
  },
};

let countdownTimer = null;
let timeRemaining = REFRESH_INTERVAL / 1000;
let isUpdating = false; // 二重実行防止フラグ
let currentRequest = null;
let requestSerial = 0;

let activeTripUpdates = [];
let activeAlerts = [];
let vehicleElementsById = new Map();
let selectedVehicleId = "";
let selectedVehicleElement = null;
let selectedVehicleHighlightElement = null;

let busHistory = {};

window.addEventListener("layerWebAppReady", initializeLayer);
window.addEventListener("beforeunload", shutdownLayer);

async function initializeLayer() {
  initializePoiDialog();
  document
    .getElementById("dataTypeSelect")
    .addEventListener("change", handleDataTypeChange);
  document
    .getElementById("refreshButton")
    .addEventListener("click", () => {
      timeRemaining = 0; 
      refreshSelectedData();
    });
  document
    .getElementById("resultFilter")
    .addEventListener("input", filterResultCards);
  document
    .getElementById("resultList")
    .addEventListener("toggle", handleResultToggle, true);

  if (!countdownTimer) {
    countdownTimer = setInterval(tick, 1000);
  }

  // Initial fetch
  await refreshSelectedData();
}

function initializePoiDialog() {
  if (typeof svgMap !== "undefined" && typeof layerID !== "undefined") {
    svgMap.setShowPoiProperty(showVehicleDialog, layerID);
  }
  if (typeof svgImageProps !== "undefined") {
    svgImageProps.isClickable = { value: true, hilightStrokeStyle: {} };
  }
}

function isStreetcarRoute(routeId) {
  if (!routeId) return false;
  const r = String(routeId).trim();
  return /^5\d{2}/.test(r) || ["301", "304", "306", "310"].includes(r);
}

function tick() {
  if (isUpdating) {
    return;
  }
  timeRemaining--;
  setText("countdown", Math.max(0, timeRemaining));

  if (timeRemaining <= 0) {
    refreshSelectedData();
  }

  const elapsedSec = Math.floor((Date.now() - APP_START_TIME) / 1000);
  const trailSec = Math.min(elapsedSec, 180);
  const m = Math.floor(trailSec / 60);
  const s = trailSec % 60;
  setText("trailTime", `${m}m ${s}s`);
}

async function refreshSelectedData() {
  if (currentRequest) {
    abortCurrentRequest();
  }
  isUpdating = true;

  const requestId = ++requestSerial;
  const dataType = getSelectedDataType();
  const vehicleSource = TTC_DATA_SOURCES.vehicle;
  const selectedSource = dataType === "vehicle" ? null : TTC_DATA_SOURCES[dataType];

  setLoadingState(true);
  setStatus(selectedSource ? `Fetching ${selectedSource.label}...` : "Fetching vehicle positions...", false);

  try {
    currentRequest = new AbortController();

    const vehiclePromise = fetchRealtimeFeed(
      vehicleSource.endpoint,
      currentRequest.signal
    );
    const selectedPromise =
      selectedSource && selectedSource.endpoint
        ? fetchRealtimeFeed(selectedSource.endpoint, currentRequest.signal)
        : Promise.resolve(null);
    const results = await Promise.allSettled([vehiclePromise, selectedPromise]);

    if (requestId !== requestSerial) return;

    const messages = [];
    const errors = [];
    const vehicleResult = results[0];

    if (vehicleResult.status === "fulfilled") {
      const vehicleFeed = vehicleResult.value;
      const vehicleEntities = (vehicleFeed.entities || []).filter((entity) =>
        Boolean(entity.vehicle)
      );
      const vehicleCount = drawVehicles(vehicleEntities);
      const vehicleTimestamp = getDataTimestamp(vehicleFeed);
      setText("vehicleMapCount", vehicleCount);
      setText(
        "vehicleDataTimestamp",
        vehicleTimestamp ? formatDateTime(vehicleTimestamp) : "Unknown"
      );
      if (!vehicleCount) {
        messages.push(vehicleSource.emptyMessage);
      }
    } else if (vehicleResult.reason.name !== "AbortError") {
      console.error(vehicleResult.reason);
      errors.push(
        "Failed to fetch vehicle positions: " + vehicleResult.reason.message
      );
    }

    if (selectedSource && selectedSource.endpoint) {
      const selectedResult = results[1];
      if (selectedResult && selectedResult.status === "fulfilled") {
        const displayedCount = displaySelectedFeed(
          dataType,
          selectedResult.value
        );
        const dataTimestamp = getDataTimestamp(selectedResult.value);
        setText("countValue", displayedCount + selectedSource.unit);
        setText(
          "dataTimestamp",
          dataTimestamp ? formatDateTime(dataTimestamp) : "Unknown"
        );
        if (!displayedCount) {
          messages.push(selectedSource.emptyMessage);
        }
      } else if (
        selectedResult &&
        selectedResult.reason.name !== "AbortError"
      ) {
        console.error(selectedResult.reason);
        errors.push(
          `Failed to fetch ${selectedSource.label}: ` +
            selectedResult.reason.message
        );
      }
    } else {
      clearResultList();
    }

    setText("lastFetched", formatDateTime(Date.now() / 1000));
    setStatus(
      errors.concat(messages).join(" / ") || "Updated successfully.",
      errors.length > 0
    );
  } catch (error) {
    if (error.name !== "AbortError" && requestId === requestSerial) {
      console.error(error);
      setStatus(
        "Failed to fetch real-time data: " + error.message,
        true
      );
    }
  } finally {
    if (requestId === requestSerial) {
      currentRequest = null;
      setLoadingState(false);
      timeRemaining = REFRESH_INTERVAL / 1000;
      setText("countdown", timeRemaining);
      isUpdating = false;
    }
  }
}

async function fetchRealtimeFeed(endpoint, signal) {
  const response = await fetch(svgMap.getCORSURL(endpoint), { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(response.status + " " + response.statusText);
  }
  return GtfsRealtimeDecoder.decodeFeedMessage(await response.arrayBuffer());
}

function displaySelectedFeed(dataType, feed) {
  if (!feed) return 0;
  if (dataType === "trip") {
    const tripEntities = (feed.entities || []).filter((entity) =>
      Boolean(entity.tripUpdate)
    );
    renderTripUpdates(tripEntities);
    return tripEntities.length;
  }

  const alertEntities = (feed.entities || []).filter((entity) =>
    Boolean(entity.alert)
  );
  renderAlerts(alertEntities);
  return alertEntities.length;
}

function drawVehicles(entities) {
  // 1. 位置情報が有効なエンティティのみ抽出
  const validEntities = entities.filter((entity) => {
    return isValidPosition((entity.vehicle && entity.vehicle.position) || {});
  });

  // ★ 2. 車両IDごとに重複排除（Deduplication）
  const vehicleMap = new Map();

  for (const entity of validEntities) {
    const vid = getPrimaryVehicleId(entity);
    if (!vid) continue;

    if (!vehicleMap.has(vid)) {
      vehicleMap.set(vid, entity);
    } else {
      // 既に同じ車両IDが存在する場合、より詳細な情報を持っている方を優先
      const existing = vehicleMap.get(vid);
      const existingHasRoute = Boolean(existing.vehicle?.trip?.routeId);
      const currentHasRoute = Boolean(entity.vehicle?.trip?.routeId);

      // 既存にRouteがなく、今回あるなら差し替え
      if (!existingHasRoute && currentHasRoute) {
        vehicleMap.set(vid, entity);
      } else if (existingHasRoute === currentHasRoute) {
        // 両方ある/両方ない場合は、タイムスタンプが新しい方を優先
        const existingTs = existing.vehicle?.timestamp || 0;
        const currentTs = entity.vehicle?.timestamp || 0;
        if (currentTs > existingTs) {
          vehicleMap.set(vid, entity);
        }
      }
    }
  }

  // 重複排除済みの配列を作成
  const drawableEntities = Array.from(vehicleMap.values());

  vehicleElementsById = new Map();
  selectedVehicleElement = null;
  selectedVehicleHighlightElement = null;

  if (typeof svgImage === "undefined" || typeof svgMap === "undefined") {
    return drawableEntities.length;
  }

  const parentElement = svgImage.getElementById("mapContents");
  removeChildren(parentElement);
  svgImage.documentElement.setAttribute(
    "property",
    VEHICLE_PROPERTIES.join(",")
  );

  const trailGroup = svgImage.getElementById("trails");
  if (trailGroup) {
    removeChildren(trailGroup);
  }

  // 3. 軌跡履歴更新
  for (const vid in busHistory) {
    busHistory[vid].coords.unshift(null);
    if (busHistory[vid].coords.length > MAX_TRAIL_LENGTH) {
      busHistory[vid].coords.pop();
    }
  }

  for (const entity of drawableEntities) {
    const vid = getPrimaryVehicleId(entity);
    if (!vid) continue;
    const position = entity.vehicle.position;
    const coord = [position.longitude, position.latitude];

    if (!busHistory[vid]) {
      busHistory[vid] = { coords: [null] };
    }
    busHistory[vid].coords[0] = coord;
  }

  // 4. 軌跡GeoJSON描画
  if (
    trailGroup &&
    typeof svgMapGIStool !== "undefined" &&
    typeof layerID !== "undefined"
  ) {
    const trailFeatures = [];

    for (const vid in busHistory) {
      const validCoords = busHistory[vid].coords.filter((c) => c !== null);
      if (validCoords.length < 2) continue;

      trailFeatures.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: validCoords,
        },
        properties: {
          vehicle_id: vid,
        },
      });
    }

    if (trailFeatures.length > 0) {
      const trailGeoJson = {
        type: "FeatureCollection",
        features: trailFeatures,
      };

      svgMapGIStool.drawGeoJson(
        trailGeoJson,
        layerID,
        "#da291c",
        1.6,
        "none",
        "p0",
        null,
        null,
        trailGroup,
        ["vehicle_id"]
      );
    }
  }

  // 5. 車両アイコン配置
  for (const entity of drawableEntities) {
    const vehiclePosition = entity.vehicle || {};
    const position = vehiclePosition.position || {};
    const trip = vehiclePosition.trip || {};
    const isStreetcar = isStreetcarRoute(trip.routeId);
    const title = getVehicleTitle(entity, isStreetcar);

    const useElement = svgImage.createElement("use");
    useElement.setAttribute("xlink:href", getVehicleSymbol(vehiclePosition, isStreetcar));
    useElement.setAttribute("x", 0);
    useElement.setAttribute("y", 0);
    useElement.setAttribute(
      "transform",
      "ref(svg," + position.longitude + "," + -position.latitude + ")"
    );
    useElement.setAttribute(
      "content",
      getCsvContent(getVehicleProperties(entity, isStreetcar))
    );
    useElement.setAttribute("xlink:title", title);
    useElement.setAttribute("data-title", title);
    const vehicleId = getPrimaryVehicleId(entity);
    if (vehicleId) {
      useElement.setAttribute("data-vehicle-id", vehicleId);
    }
    parentElement.appendChild(useElement);
    registerVehicleElement(entity, useElement);
  }

  applySelectedVehicleHighlight(false);
  svgMap.refreshScreen();
  return drawableEntities.length;
}

function clearMapContents() {
  if (typeof svgImage === "undefined") {
    return;
  }
  removeChildren(svgImage.getElementById("mapContents"));
  const trailGroup = svgImage.getElementById("trails");
  if (trailGroup) {
    removeChildren(trailGroup);
  }

  vehicleElementsById = new Map();
  selectedVehicleElement = null;
  selectedVehicleHighlightElement = null;
  svgImage.documentElement.setAttribute("property", "");
  if (typeof svgMap !== "undefined") {
    svgMap.refreshScreen();
  }
}

function registerVehicleElement(entity, element) {
  for (const vehicleId of getVehicleLookupIds(entity)) {
    if (!vehicleElementsById.has(vehicleId)) {
      vehicleElementsById.set(vehicleId, element);
    }
  }
}

function getVehicleLookupIds(entity) {
  const vehiclePosition = entity.vehicle || {};
  const descriptor = vehiclePosition.vehicle || {};
  const ids = [descriptor.id, descriptor.label, entity.id]
    .filter(Boolean)
    .map(String);
  return Array.from(new Set(ids));
}

function getPrimaryVehicleId(entity) {
  const vehiclePosition = entity.vehicle || {};
  const descriptor = vehiclePosition.vehicle || {};
  return valueOrEmpty(descriptor.id || descriptor.label || entity.id);
}

function selectVehicleForTrip(entity, content) {
  const update = (entity && entity.tripUpdate) || {};
  const vehicleId = valueOrEmpty(update.vehicle && update.vehicle.id);
  const message = content.querySelector(".vehicle-selection-message");
  if (!vehicleId) {
    if (message) {
      message.textContent = "No vehicle ID found for this trip.";
      message.classList.add("error");
    }
    return;
  }

  selectedVehicleId = vehicleId;
  const selected = applySelectedVehicleHighlight(true);
  if (message) {
    message.textContent = selected
      ? "Vehicle " + vehicleId + " selected on map."
      : "Vehicle " + vehicleId + " is not in the current vehicle positions.";
    message.classList.toggle("error", !selected);
  }
}

function applySelectedVehicleHighlight(showDetails) {
  if (
    !selectedVehicleId ||
    typeof svgImage === "undefined" ||
    typeof svgMap === "undefined"
  ) {
    return false;
  }
  const target = vehicleElementsById.get(String(selectedVehicleId));
  if (!target) {
    return false;
  }

  removeVehicleHighlight();
  selectedVehicleElement = target;
  target.setAttribute("data-selected", "true");

  const highlight = svgImage.createElement("use");
  highlight.setAttribute("id", "selectedVehicleHighlight");
  highlight.setAttribute("xlink:href", "#vehicleSelection");
  highlight.setAttribute("x", 0);
  highlight.setAttribute("y", 0);
  highlight.setAttribute("transform", target.getAttribute("transform"));
  highlight.setAttribute("pointer-events", "none");
  svgImage.getElementById("mapContents").appendChild(highlight);
  selectedVehicleHighlightElement = highlight;

  if (showDetails) {
    svgMap.refreshScreen();
    showVehicleDialog(target);
  }
  return true;
}

function clearVehicleSelection() {
  selectedVehicleId = "";
  removeVehicleHighlight();
  if (typeof svgMap !== "undefined") {
    svgMap.refreshScreen();
  }
}

function removeVehicleHighlight() {
  if (
    selectedVehicleElement &&
    typeof selectedVehicleElement.removeAttribute === "function"
  ) {
    selectedVehicleElement.removeAttribute("data-selected");
  }
  if (
    selectedVehicleHighlightElement &&
    selectedVehicleHighlightElement.parentNode
  ) {
    selectedVehicleHighlightElement.parentNode.removeChild(
      selectedVehicleHighlightElement
    );
  }
  selectedVehicleElement = null;
  selectedVehicleHighlightElement = null;
}

function renderTripUpdates(entities) {
  activeAlerts = [];
  activeTripUpdates = entities.slice().sort(compareTripUpdates);
  const resultList = document.getElementById("resultList");
  if (!activeTripUpdates.length) {
    resultList.innerHTML =
      '<p class="empty-state">No trip updates currently available.</p>';
    updateFilterCount(0, 0);
    return;
  }

  resultList.innerHTML = activeTripUpdates
    .map((entity, index) => {
      const update = entity.tripUpdate || {};
      const trip = update.trip || {};
      const vehicle = update.vehicle || {};
      const isStreetcar = isStreetcarRoute(trip.routeId);
      const routeTypeLabel = isStreetcar ? "Streetcar" : "Bus";
      const routeLabel = trip.routeId ? `${routeTypeLabel} ${trip.routeId}` : "Unknown Route";
      const tripLabel = trip.tripId || entity.id || "Unknown Trip ID";
      const delay = getLargestAbsoluteDelay(update);
      const status = formatTripScheduleRelationship(trip.scheduleRelationship);
      const searchText = [
        routeLabel,
        tripLabel,
        trip.startTime,
        vehicle.id,
        status,
      ].join(" ");
      return (
        '<details class="data-card" data-kind="trip" data-index="' +
        index +
        '" data-search="' +
        escapeHtml(searchText.toLowerCase()) +
        '">' +
        '<summary><span class="route-badge ' + (isStreetcar ? 'streetcar' : '') + '">' +
        escapeHtml(routeLabel) +
        "</span> " +
        '<span class="summary-main">' +
        escapeHtml(trip.startTime || "Unknown Time") +
        " / " +
        escapeHtml(tripLabel) +
        "</span> " +
        '<span class="delay-badge ' +
        getDelayClass(delay) +
        '">' +
        escapeHtml(formatDelay(delay)) +
        "</span></summary>" +
        '<div class="detail-content"></div></details>'
      );
    })
    .join("");
  filterResultCards();
}

function renderAlerts(entities) {
  activeTripUpdates = [];
  activeAlerts = entities.slice();
  const resultList = document.getElementById("resultList");
  if (!activeAlerts.length) {
    resultList.innerHTML =
      '<p class="empty-state">No service alerts currently available.</p>';
    updateFilterCount(0, 0);
    return;
  }

  resultList.innerHTML = activeAlerts
    .map((entity, index) => {
      const alert = entity.alert || {};
      const title =
        getTranslatedText(alert.headerText) || "Alert " + (index + 1);
      const description = getTranslatedText(alert.descriptionText);
      const targets = formatAlertTargets(alert.informedEntities);
      const searchText = [
        title,
        description,
        targets,
        formatAlertCause(alert.cause),
        formatAlertEffect(alert.effect),
      ].join(" ");
      return (
        '<details class="data-card alert-card" data-kind="alert" data-index="' +
        index +
        '" data-search="' +
        escapeHtml(searchText.toLowerCase()) +
        '">' +
        '<summary><span class="alert-severity severity-' +
        valueOrEmpty(alert.severityLevel) +
        '">' +
        escapeHtml(formatAlertSeverity(alert.severityLevel)) +
        "</span> " +
        '<span class="summary-main">' +
        escapeHtml(title) +
        "</span></summary>" +
        '<div class="detail-content"></div></details>'
      );
    })
    .join("");
  filterResultCards();
}

function handleResultToggle(event) {
  const details = event.target;
  if (!details.open || !details.classList.contains("data-card")) {
    return;
  }
  const content = details.querySelector(".detail-content");
  const index = Number(details.dataset.index);
  if (content.dataset.loaded !== "true") {
    content.innerHTML =
      details.dataset.kind === "trip"
        ? buildTripUpdateDetails(activeTripUpdates[index])
        : buildAlertDetails(activeAlerts[index]);
    content.dataset.loaded = "true";
  }
  if (details.dataset.kind === "trip") {
    selectVehicleForTrip(activeTripUpdates[index], content);
  }
}

function buildTripUpdateDetails(entity) {
  const update = entity.tripUpdate || {};
  const trip = update.trip || {};
  const vehicle = update.vehicle || {};
  const isStreetcar = isStreetcarRoute(trip.routeId);
  const rows = [
    ["Type", isStreetcar ? "Streetcar" : "Bus"],
    ["Route ID", trip.routeId],
    ["Trip ID", trip.tripId],
    ["Direction ID", valueOrEmpty(trip.directionId)],
    [
      "Start",
      [formatStartDate(trip.startDate), trip.startTime]
        .filter(Boolean)
        .join(" "),
    ],
    ["Status", formatTripScheduleRelationship(trip.scheduleRelationship)],
    ["Vehicle ID", vehicle.id],
    ["Max Delay", formatDelay(getLargestAbsoluteDelay(update))],
    ["Data Time", formatDateTime(update.timestamp)],
  ];
  const stopTimeUpdates = update.stopTimeUpdates || [];
  let html =
    '<p class="vehicle-selection-message">Checking target vehicle...</p>' +
    buildMetadataTable(rows);
  if (!stopTimeUpdates.length) {
    return html + '<p class="empty-state">No stop time updates available.</p>';
  }

  html +=
    '<div class="table-scroll"><table class="stop-table"><thead><tr>' +
    "<th>Seq</th><th>Stop ID</th><th>Est. Arrival</th><th>Est. Departure</th><th>Status</th></tr></thead><tbody>";
  for (const stop of stopTimeUpdates) {
    const assignedStopId =
      stop.stopTimeProperties && stop.stopTimeProperties.assignedStopId;
    const stopId = assignedStopId || stop.stopId || "";
    html +=
      "<tr><td>" +
      escapeHtml(valueOrEmpty(stop.stopSequence)) +
      "</td>" +
      "<td>" +
      escapeHtml(stopId) +
      "</td>" +
      "<td>" +
      escapeHtml(formatStopTimeEvent(stop.arrival)) +
      "</td>" +
      "<td>" +
      escapeHtml(formatStopTimeEvent(stop.departure)) +
      "</td>" +
      "<td>" +
      escapeHtml(formatStopScheduleRelationship(stop.scheduleRelationship)) +
      "</td></tr>";
  }
  return html + "</tbody></table></div>";
}

function buildAlertDetails(entity) {
  const alert = entity.alert || {};
  const description = getTranslatedText(alert.descriptionText);
  const rows = [
    ["Active Periods", formatAlertPeriods(alert.activePeriods)],
    ["Targets", formatAlertTargets(alert.informedEntities)],
    ["Cause", formatAlertCause(alert.cause)],
    ["Effect", formatAlertEffect(alert.effect)],
    ["Severity", formatAlertSeverity(alert.severityLevel)],
  ];
  let html = buildMetadataTable(rows);
  if (description) {
    html +=
      '<div class="alert-description">' + escapeHtml(description) + "</div>";
  }

  const urlText = getTranslatedText(alert.url);
  const safeUrl = getSafeHttpUrl(urlText);
  if (safeUrl) {
    html +=
      '<p><a href="' +
      escapeHtml(safeUrl) +
      '" target="_blank" rel="noopener">Open details</a></p>';
  }
  return html;
}

function buildMetadataTable(rows) {
  return (
    '<table class="metadata-table"><tbody>' +
    rows
      .filter((row) => {
        return row[1] !== undefined && row[1] !== null && row[1] !== "";
      })
      .map((row) => {
        return (
          "<tr><th>" +
          escapeHtml(row[0]) +
          "</th><td>" +
          escapeHtml(row[1]) +
          "</td></tr>"
        );
      })
      .join("") +
    "</tbody></table>"
  );
}

function filterResultCards() {
  const query = document
    .getElementById("resultFilter")
    .value.trim()
    .toLowerCase();
  const cards = document.querySelectorAll("#resultList .data-card");
  let visibleCount = 0;
  for (const card of cards) {
    const visible =
      !query || (card.getAttribute("data-search") || "").includes(query);
    card.hidden = !visible;
    if (visible) {
      visibleCount++;
    }
  }
  updateFilterCount(visibleCount, cards.length);
}

function updateFilterCount(visibleCount, totalCount) {
  setText(
    "filterCount",
    totalCount ? visibleCount + " / " + totalCount + " items" : "0 items"
  );
}

function compareTripUpdates(a, b) {
  const aTrip = (a.tripUpdate && a.tripUpdate.trip) || {};
  const bTrip = (b.tripUpdate && b.tripUpdate.trip) || {};
  const aKey = [
    aTrip.routeId || "",
    aTrip.startTime || "",
    aTrip.tripId || "",
  ].join("|");
  const bKey = [
    bTrip.routeId || "",
    bTrip.startTime || "",
    bTrip.tripId || "",
  ].join("|");
  return aKey.localeCompare(bKey, "en", { numeric: true });
}

function getLargestAbsoluteDelay(update) {
  const delays = [];
  if (Number.isFinite(update.delay)) {
    delays.push(update.delay);
  }
  for (const stop of update.stopTimeUpdates || []) {
    for (const event of [stop.arrival, stop.departure]) {
      if (event && Number.isFinite(event.delay)) {
        delays.push(event.delay);
      }
    }
  }
  if (!delays.length) {
    return null;
  }
  return delays.reduce((result, delay) => {
    return Math.abs(delay) > Math.abs(result) ? delay : result;
  }, delays[0]);
}

function getDelayClass(delay) {
  if (!Number.isFinite(delay) || delay === 0) {
    return "delay-normal";
  }
  return delay > 0 ? "delay-late" : "delay-early";
}

function formatDelay(delay) {
  if (!Number.isFinite(delay)) {
    return "Unknown";
  }
  if (delay === 0) {
    return "On time";
  }
  const absolute = Math.abs(Math.round(delay));
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute % 60;
  const duration =
    (minutes ? minutes + "m " : "") + (seconds ? seconds + "s" : "");
  return (delay > 0 ? "+" : "-") + duration.trim();
}

function formatStopTimeEvent(event) {
  if (!event) {
    return "";
  }
  const time = formatTimeOnly(event.time);
  const delay = Number.isFinite(event.delay) ? formatDelay(event.delay) : "";
  return [time, delay ? "(" + delay + ")" : ""].filter(Boolean).join(" ");
}

function formatTripScheduleRelationship(value) {
  return (
    {
      0: "Scheduled",
      1: "Added",
      2: "Unscheduled",
      3: "Canceled",
      5: "Duplicated",
      6: "Deleted",
    }[value] || "Unknown"
  );
}

function formatStopScheduleRelationship(value) {
  return { 0: "Scheduled", 1: "Skipped", 2: "No data", 3: "Unscheduled" }[value] || "Unknown";
}

function getTranslatedText(translatedString) {
  const translations =
    (translatedString && translatedString.translations) || [];
  if (!translations.length) {
    return "";
  }
  return translations[0].text || "";
}

function formatAlertPeriods(periods) {
  if (!periods || !periods.length) {
    return "No specified period";
  }
  return periods
    .map((period) => {
      const start = formatDateTime(period.start) || "Unknown start";
      const end = formatDateTime(period.end) || "Unknown end";
      return start + " - " + end;
    })
    .join(" / ");
}

function formatAlertTargets(selectors) {
  if (!selectors || !selectors.length) {
    return "All";
  }
  return selectors
    .map((selector) => {
      const trip = selector.trip || {};
      const parts = [];
      if (selector.agencyId) parts.push("Agency " + selector.agencyId);
      if (selector.routeId) parts.push("Route " + selector.routeId);
      if (trip.tripId) parts.push("Trip " + trip.tripId);
      if (selector.stopId) parts.push("Stop " + selector.stopId);
      if (selector.directionId !== undefined)
        parts.push("Direction " + selector.directionId);
      return parts.join(" / ") || "No target specified";
    })
    .join(", ");
}

function formatAlertCause(value) {
  return (
    {
      1: "Unknown",
      2: "Other",
      3: "Technical problem",
      4: "Strike",
      5: "Demonstration",
      6: "Accident",
      7: "Holiday",
      8: "Weather",
      9: "Maintenance",
      10: "Construction",
      11: "Police activity",
      12: "Medical emergency",
    }[value] || "Unknown"
  );
}

function formatAlertEffect(value) {
  return (
    {
      1: "No service",
      2: "Reduced service",
      3: "Significant delays",
      4: "Detour",
      5: "Additional service",
      6: "Modified service",
      7: "Other",
      8: "Unknown effect",
      9: "Stop moved",
      10: "No effect",
      11: "Accessibility issue",
    }[value] || "Unknown"
  );
}

function formatAlertSeverity(value) {
  return { 1: "Unknown", 2: "Info", 3: "Warning", 4: "Severe" }[value] || "Unknown";
}

function getSafeHttpUrl(value) {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : "";
  } catch (error) {
    return "";
  }
}

function isValidPosition(position) {
  return (
    Number.isFinite(position.latitude) &&
    Number.isFinite(position.longitude) &&
    position.latitude >= -90 &&
    position.latitude <= 90 &&
    position.longitude >= -180 &&
    position.longitude <= 180
  );
}

function getVehicleProperties(entity, isStreetcar) {
  const vehiclePosition = entity.vehicle || {};
  const descriptor = vehiclePosition.vehicle || {};
  const trip = vehiclePosition.trip || {};
  const position = vehiclePosition.position || {};
  return [
    entity.id,
    descriptor.id,
    descriptor.label,
    descriptor.licensePlate,
    isStreetcar ? "Streetcar" : "Bus",
    trip.routeId,
    trip.tripId,
    valueOrEmpty(trip.directionId),
    trip.startTime,
    formatStartDate(trip.startDate),
    vehiclePosition.stopId,
    valueOrEmpty(vehiclePosition.currentStopSequence),
    formatVehicleStatus(vehiclePosition.currentStatus),
    formatCongestionLevel(vehiclePosition.congestionLevel),
    formatOccupancy(
      vehiclePosition.occupancyStatus,
      vehiclePosition.occupancyPercentage
    ),
    formatWheelchairAccessible(descriptor.wheelchairAccessible),
    position.latitude.toFixed(6),
    position.longitude.toFixed(6),
    formatNumber(position.bearing, 1, "°"),
    Number.isFinite(position.speed) ? (position.speed * 3.6).toFixed(1) : "",
    formatDateTime(vehiclePosition.timestamp),
  ];
}

function getVehicleTitle(entity, isStreetcar) {
  const vehiclePosition = entity.vehicle || {};
  const descriptor = vehiclePosition.vehicle || {};
  const trip = vehiclePosition.trip || {};
  const modeName = isStreetcar ? "Streetcar" : "Bus";
  const vehicleName = descriptor.label || descriptor.id || entity.id || `${modeName} Vehicle`;
  return trip.routeId
    ? `TTC ${modeName} ${vehicleName} (Route ${trip.routeId})`
    : `TTC ${modeName} ${vehicleName}`;
}

function getVehicleSymbol(vehiclePosition, isStreetcar) {
  if (
    vehiclePosition.timestamp &&
    Date.now() / 1000 - vehiclePosition.timestamp > STALE_VEHICLE_SECONDS
  ) {
    return "#vehicleStale";
  }
  const isStopped = vehiclePosition.currentStatus === 1;
  if (isStreetcar) {
    return isStopped ? "#streetcarStopped" : "#streetcarMoving";
  }
  return isStopped ? "#busStopped" : "#busMoving";
}

function getDataTimestamp(feed) {
  if (feed && feed.header && Number.isFinite(feed.header.timestamp)) {
    return feed.header.timestamp;
  }
  let latestTimestamp = 0;
  for (const entity of (feed && feed.entities) || []) {
    const timestamp =
      (entity.vehicle && entity.vehicle.timestamp) ||
      (entity.tripUpdate && entity.tripUpdate.timestamp);
    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  }
  return latestTimestamp;
}

function showVehicleDialog(target) {
  const metaData = target.getAttribute("content")
    ? svgMap.parseEscapedCsvLine(target.getAttribute("content"))
    : [];
  const title =
    target.getAttribute("data-title") ||
    target.getAttribute("xlink:title") ||
    "TTC Vehicle";
  let message =
    "<table border='1' style='word-break:break-all;table-layout:fixed;width:100%;border-collapse:collapse;font-size:12px'>";
  message += "<tr><th style='width:45%'>Property</th><th>Value</th></tr>";
  message += "<tr><td>Name</td><td>" + escapeHtml(title) + "</td></tr>";

  for (let i = 0; i < VEHICLE_PROPERTIES.length; i++) {
    if (!metaData[i]) {
      continue;
    }
    message +=
      "<tr><td>" +
      escapeHtml(VEHICLE_PROPERTIES[i]) +
      "</td><td>" +
      escapeHtml(metaData[i]) +
      "</td></tr>";
  }

  message += "</table>";
  svgMap.showModal(message, 420, 620);
}

async function handleDataTypeChange() {
  if (currentRequest) {
    abortCurrentRequest();
  }
  isUpdating = false;
  
  clearVehicleSelection();
  clearResultList();
  document.getElementById("resultFilter").value = "";
  setText("countValue", "-");
  setText("dataTimestamp", "-");
  
  updateDataTypeUi();
  
  const resultList = document.getElementById("resultList");
  if (resultList && !resultList.hidden) {
    resultList.innerHTML = '<p class="empty-state">Loading data...</p>';
  }

  await refreshSelectedData();
}

function updateDataTypeUi() {
  const dataType = getSelectedDataType();
  const source = TTC_DATA_SOURCES[dataType] || {};
  const isVehicle = dataType === "vehicle";
  
  setText("countLabel", source.countLabel || "Items");
  document.getElementById("selectedCountRow").hidden = isVehicle;
  document.getElementById("selectedDataTimestampRow").hidden = isVehicle;
  document.getElementById("listTools").hidden = isVehicle;
  document.getElementById("resultList").hidden = isVehicle;
  document.getElementById("resultFilter").placeholder =
    dataType === "trip"
      ? "Filter by Route, Trip, or Vehicle ID"
      : "Filter alerts...";
}

function getSelectedDataType() {
  const value = document.getElementById("dataTypeSelect").value;
  return TTC_DATA_SOURCES[value] ? value : "vehicle";
}

function abortCurrentRequest() {
  if (currentRequest) {
    currentRequest.abort();
    currentRequest = null;
  }
}

function shutdownLayer() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  abortCurrentRequest();
}

function clearResultList() {
  activeTripUpdates = [];
  activeAlerts = [];
  const resultList = document.getElementById("resultList");
  if (resultList) {
    resultList.innerHTML = "";
  }
  updateFilterCount(0, 0);
}

function setLoadingState(isLoading) {
  const refreshBtn = document.getElementById("refreshButton");
  if (refreshBtn) refreshBtn.disabled = isLoading;
}

function setStatus(message, isError) {
  const element = document.getElementById("statusMessage");
  if (element) {
    element.textContent = message;
    element.classList.toggle("error", isError);
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getCsvContent(values) {
  return values.map(escapeCsvField).join(",");
}

function escapeCsvField(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character];
  });
}

function removeChildren(element) {
  while (element && element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function valueOrEmpty(value) {
  return value === undefined || value === null ? "" : String(value);
}

function formatNumber(value, digits, suffix) {
  return Number.isFinite(value) ? value.toFixed(digits) + suffix : "";
}

function formatStartDate(value) {
  if (typeof value === "string" && /^\d{8}$/.test(value)) {
    return (
      value.slice(0, 4) + "/" + value.slice(4, 6) + "/" + value.slice(6, 8)
    );
  }
  return value || "";
}

function formatDateTime(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  return new Date(timestamp * 1000).toLocaleString("en-CA");
}

function formatTimeOnly(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  return new Date(timestamp * 1000).toLocaleTimeString("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatVehicleStatus(status) {
  return (
    { 0: "Incoming at", 1: "Stopped at", 2: "In transit to" }[status] ||
    "Unknown"
  );
}

function formatCongestionLevel(level) {
  return (
    {
      0: "Unknown",
      1: "Smooth",
      2: "Stop and go",
      3: "Congested",
      4: "Severe congestion",
    }[level] || "Unknown"
  );
}

function formatOccupancy(status, percentage) {
  const label = {
    0: "Empty",
    1: "Many seats available",
    2: "Few seats available",
    3: "Standing room only",
    4: "Crushed standing room only",
    5: "Full",
    6: "Not accepting passengers",
    7: "No data",
    8: "Not boardable",
  }[status];
  if (Number.isFinite(percentage)) {
    return (label ? label + " / " : "") + percentage + "%";
  }
  return label || "Unknown";
}

function formatWheelchairAccessible(status) {
  return { 0: "No data", 1: "Accessible", 2: "Not accessible" }[status] || "No data";
}