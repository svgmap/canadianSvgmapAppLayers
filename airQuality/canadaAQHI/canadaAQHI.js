const baseUrl = "https://api.weather.gc.ca/collections/aqhi-observations-realtime/items?f=json";
const refreshInterval = 60000; // one minute refresh timer
const limit = 4000; // max num of items in API call
const timeOffsetUpdate = new Event("timeOffsetUpdate");
let currentTimeOffset = 0;
let lastRefreshTime = Date.now();
let timeOffsetDisplay = undefined;

onload = () => {
  timeOffsetDisplay = document.getElementById("timeOffsetDisplay");
  addEventListener("timeOffsetUpdate", getAQHI);
  setInterval(async () => checkIfUpdateNeeded(getAQHI), refreshInterval);
  getAQHI();
}

async function getAQHI() {
  const queryUrl = buildQuery()
  const airQuailtyData = await getData(queryUrl); // Fetching AQHI data
  if (airQuailtyData === undefined) return; // Exiting early if the API request has failed
  // Updating lastRefreshTime
  if (airQuailtyData.timeStamp) lastRefreshTime = airQuailtyData.timeStamp;
  const validTimes = await getAvailableTimes(airQuailtyData.features);
  if (!validTimes) return;
  drawPoints(airQuailtyData, validTimes[currentTimeOffset]);
}

// Wrapper function to only data if interval has been exceeded
async function checkIfUpdateNeeded(refreshDataFn) {
  if (!lastRefreshTime) return;
  if (Date.now() - new Date(lastRefreshTime) < refreshInterval) return;
  refreshDataFn();
}

async function selectTime(timeIndex) {
  currentTimeOffset = 24 - timeIndex;
  if (timeOffsetDisplay) {
    timeOffsetDisplay.innerHTML = currentTimeOffset !== 0
      ? `Offset: ${currentTimeOffset} hour${currentTimeOffset === 1 ? '' : 's'} ago`
      : "Current data";
  }
  dispatchEvent(timeOffsetUpdate);
}

async function getAvailableTimes(features) {
  if (!features) {
    console.warn("No features found for getAvailableDates()");
    return;
  }

  let times = {};
  for (const feature of features) {
    if (!times[feature.properties.observation_datetime]) {
      times[feature.properties.observation_datetime] = true;
    }
  }

  const parsedTimes = Object.keys(times).sort().reverse();
  return parsedTimes;
}

function buildQuery() {
  const range = `&datetime=${new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()}/${new Date(Date.now()).toISOString()}`;
  const query = `${baseUrl}${range}&limit=${limit}`
  return (query);
}

async function getData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }
    const body = JSON.parse(await response.text());
    return body;
  } catch (err) {
    console.error(`Error fetching AQHI data: ${err}`);
  }
  return undefined;
}

function drawPoints(pointData, selectedTime) {
  removeUses();
  if (pointData.type !== "FeatureCollection" || !pointData.features) return;
  const schema = buildSchema(pointData.features);
  svgImage.documentElement.setAttribute("property", schema);
  for (const feature of pointData.features) {
    if (feature.type === "Feature") {
      if (feature.properties.observation_datetime !== selectedTime
        && currentTimeOffset !== 0) continue;
      if (currentTimeOffset === 0 && !feature.properties.latest) continue;
      if (feature.geometry) {
        const meta = orderBySchema(feature.properties, schema);
        const lat = Number(feature.geometry.coordinates[1]);
        const lng = Number(feature.geometry.coordinates[0]);
        const use = svgImage.createElement("use");
        use.setAttribute("xlink:href", "#p0");
        use.setAttribute("content", meta);
        use.setAttribute("x", 0);
        use.setAttribute("y", 0);
        if (feature.properties.aqhi) {
          const hsl = valToColor(feature.properties.aqhi);
          use.setAttribute("fill", `${hsl}`);
        }
        use.setAttribute("transform", `ref(svg,${lng},${-lat})`);
        svgImage.documentElement.appendChild(use);
      } else {
        console.warn("No geometry found");
      }
    } else {
      console.warn("Unexpected entry in features")
    }
  }
  svgMap.refreshScreen();
}

function buildSchema(features) {
  // Generates a normalized schema from the property names of geojson features
  let metaSchema = {};
  for (const feature of features) {
    for (const propName in feature.properties) {
      if (!metaSchema[propName]) {
        metaSchema[propName] = true;
      }
    }
  }
  metaSchema = Object.keys(metaSchema).toSorted();
  return metaSchema;
}

function removeUses() {
  const uses = svgImage.getElementsByTagName("use");
  for (let i = uses.length - 1; i >= 0; i--) {
    uses[i].remove();
  }
}

function orderBySchema(metaData, schema) {
  const mapped = [];
  for (const entry of schema) {
    mapped.push(metaData[entry]);
  }
  return mapped;
}

function valToColor(aqhiNum) {
  const rounded = Math.round(aqhiNum);
  const colourMap = [
    "hsl(0 0% 50%)", // 0 not possible with AQHI -- returning invalid colour visualization
    "hsl(192 100% 50%)",
    "hsl(195 100% 40%)",
    "hsl(200 100% 30%)",
    "hsl(60 100% 50%)",
    "hsl(48 100% 50%)",
    "hsl(30 100% 60%)",
    "hsl(0 100% 50%)",
    "hsl(0 100% 40%)",
    "hsl(0 100% 30%)",
    "hsl(0 100% 20%)",
  ];
  if (rounded > colourMap.length - 1) return colourMap[0]; //fallback val
  return colourMap[rounded];
}