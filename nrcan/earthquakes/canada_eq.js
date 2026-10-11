// Description:
// Earthquakes Canada LaWA from  https://www.earthquakescanada.nrcan.gc.ca/
//
// License: (MPL v2)
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Earthquakes Canada QuakeML API URI
const APIURI =
	"https://www.earthquakescanada.nrcan.gc.ca/cache/earthquakes/canada.xml";

// Event listener for when LaWA layer is ready
addEventListener("layerWebAppReady", function () {
	const reloadBtn = document.getElementById("reloadBtn");
	if (reloadBtn) {
		reloadBtn.addEventListener("click", fetchAndDrawEqData);
	}

	// Register dialog callback
	if (typeof svgMap == "object") {
		svgMap.setShowPoiProperty(customDialog, layerID);
	}

	// Initial data load
	fetchAndDrawEqData();
});

// Handle POI (earthquake icon) clicks
function customDialog(target) {
	var metaData = target.getAttribute("content").split(",");
	var metaSchema = target.ownerDocument.firstChild
		.getAttribute("property")
		.split(",");

	var message =
		"<table border='1' style='word-break: break-all; table-layout:fixed; width:100%; border:solid orange; border-collapse: collapse'>";

	if (metaSchema && metaSchema.length == metaData.length) {
		for (var i = 0; i < metaSchema.length; i++) {
			var data = metaData[i] || "--";
			message +=
				"<tr><td style='background:#ffebcd; width:40%; padding:4px; font-weight:bold; font-size:11px;'>" +
				metaSchema[i] +
				"</td><td style='padding:4px; font-size:11px;'>" +
				data +
				"</td></tr>";
		}
	} else {
		message += "<tr><td>Data loading error (item count mismatch)</td></tr>";
	}
	message += "</table>";

	if (typeof svgMap == "object") {
		svgMap.showModal(message, 320, 260);
	}
}

// Fetch data and draw
async function fetchAndDrawEqData() {
	showMessage("Fetching XML data...");

	try {
		const fetchUrl =
			typeof svgMap == "object" ? svgMap.getCORSURL(APIURI) : APIURI;
		const res = await fetch(fetchUrl);
		const xmlText = await res.text();

		const parser = new DOMParser();
		const xmlDoc = parser.parseFromString(xmlText, "application/xml");
		const events = xmlDoc.getElementsByTagName("event");

		drawQuakes(events);
		showMessage(`Displayed ${events.length} recent earthquakes.`);
	} catch (e) {
		console.error(e);
		showMessage("Failed to fetch data.");
	}
}

// Draw earthquakes on SVG layer
function drawQuakes(events) {
	if (typeof window.svgImage !== "object") return;

	const qksGroup = window.svgImage.getElementById("quakes");
	removeChildren(qksGroup);

	for (let i = 0; i < events.length; i++) {
		const ev = events[i];

		// 1. Event ID
		const rawId = ev.getAttribute("publicID") || "";
		const eventId = rawId.split("/").pop() || "N/A";

		// 2. Event Type
		const typeCert = ev.querySelector("typeCertainty")?.textContent || "";
		const typeName = ev.querySelector("type")?.textContent || "";
		const eventType = `${typeCert} ${typeName}`.trim() || "N/A";

		// 3. Date/Time (UTC)
		const rawTime =
			ev.querySelector("origin > time > value")?.textContent || "N/A";
		const dateTime = rawTime.replace("T", " ").substring(0, 19);

		// 4. Magnitude
		const mag = parseFloat(
			ev.querySelector("magnitude > mag > value")?.textContent || 0
		);
		const magType = ev.querySelector("magnitude > type")?.textContent || "";
		const magnitude = isNaN(mag) ? "N/A" : `${mag} ${magType}`.trim();

		// 5. Coordinates
		const lat = parseFloat(
			ev.querySelector("origin > latitude > value")?.textContent || 0
		);
		const lon = parseFloat(
			ev.querySelector("origin > longitude > value")?.textContent || 0
		);
		const latStr = lat >= 0 ? `${lat}N` : `${Math.abs(lat)}S`;
		const lonStr = lon >= 0 ? `${lon}E` : `${Math.abs(lon)}W`;
		const coordinates = `${latStr}， ${lonStr}`;

		// 6. Depth (km)
		const depth =
			ev.querySelector("origin > depth > value")?.textContent || "N/A";

		// 7. Description (replace half-width commas with full-width commas to avoid split issues)
		const rawDesc =
			ev.querySelector("description > text")?.textContent || "N/A";
		const desc = rawDesc.replace(/,/g, "，");

		if (isNaN(lat) || isNaN(lon)) continue;

		const cr = window.svgImage.createElement("circle");

		cr.setAttribute("transform", `ref(svg, ${lon * 100}, ${-lat * 100})`);
		cr.setAttribute("cy", 0);
		cr.setAttribute("cx", 0);

		// Custom formula for radius size
		cr.setAttribute("r", Math.max(Math.pow(mag, 1.6), 2));

		cr.setAttribute("fill", getMagColor(mag));
		cr.setAttribute("stroke", "#333");
		cr.setAttribute("stroke-width", "0.5");
		cr.setAttribute(
			"xlink:title",
			`${eventId} : Mag.${isNaN(mag) ? "N/A" : mag}`
		);

		// Set data for dialog popup
		cr.setAttribute(
			"content",
			`${eventId},${eventType},${dateTime},${magnitude},${coordinates},${depth},${desc}`
		);

		qksGroup.appendChild(cr);
	}

	if (typeof svgMap == "object") {
		svgMap.refreshScreen();
	}
}

// Get color based on magnitude
function getMagColor(mag) {
	if (mag >= 5.0) return "#ff2800"; // Red (Large)
	if (mag >= 3.0) return "#ffe600"; // Yellow (Medium)
	if (mag >= 1.0) return "#00aaff"; // Light Blue (Small)
	return "#f2f2ff"; // Very Small
}

// UI message utility
function showMessage(msg) {
	const statusMsg = document.getElementById("statusMsg");
	if (statusMsg) {
		statusMsg.innerText = msg;
	}
}

// Remove child nodes utility
function removeChildren(ele) {
	if (!ele) return;
	while (ele.firstChild) {
		ele.removeChild(ele.firstChild);
	}
}
