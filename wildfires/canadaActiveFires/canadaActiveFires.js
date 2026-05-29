const baseUrl = "https://geoserver.cwfif.nrcan.gc.ca/geoserver/wfs?service=WFS&version=2.0.1&request=GetFeature&outputFormat=application/json&typeNames=public:cwfif_national_activefires&sortBy=agency_code+A,record_start+D&CQL_FILTER=now()%3E=record_start%20AND%20now()%3C=record_end";
const refreshInterval = 600000; // Every 10 minutes

// Sort thresholds in descending order for efficient lookup
const scaleMap = new Map([
  [1000, 10],
  [100, 7],
  [0, 5]
]);

const colorMap = new Map([
  ['OC', 'oklch(0.627 0.22 32)'],
  ['BH', 'oklch(0.943 0.201 106)'],
  ['UC', 'oklch(0.689 0.175 245)'],
  ['EX', 'oklch(0.936 0.003 17)']
]);

let mapLayer;
let cachedSchema = null;

onload = () => {
  mapLayer = svgImage.getElementById('mapLayer');
  renderFireData();

  const interval = setInterval(renderFireData, refreshInterval);
  addEventListener("closeFrame", () => clearInterval(interval));
};

const fetchFireData = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Response status: ${res.status}`);
    return res.json();
  } catch (error) {
    console.error(`Error fetching map render: ${error}`);
    return null;
  }
};

const getScale = (fireSize) => {
  for (const threshold of scaleMap.keys()) {
    if (fireSize >= threshold) return scaleMap.get(threshold);
  }
  return scaleMap.get(0);
};

const renderFireData = async () => {
  const fireData = await fetchFireData(baseUrl);
  if (!fireData?.features?.length) return;

  while (mapLayer.firstChild) mapLayer.removeChild(mapLayer.firstChild);

  const schema = cachedSchema || buildSchema(fireData.features);
  svgImage.documentElement.setAttribute("property", schema);

  for (const feature of fireData.features) {
    const props = feature.properties;
    const lat = Number(props?.latitude);
    const lng = Number(props?.longitude);
    
    if (isNaN(lat) || isNaN(lng)) continue;

    const fireSize = Number(props?.fire_size) || 0;
    const scale = getScale(fireSize);
    const color = colorMap.get(props?.stage_of_control_status) || "black";

    const circle = svgImage.createElement("circle");
    circle.setAttribute("content", Object.values(props).join());
    circle.setAttribute("r", scale);
    circle.setAttribute("stroke", "black");
    circle.setAttribute("fill", color);
    circle.setAttribute("transform", `ref(svg,${lng},${-lat})`);
    mapLayer.appendChild(circle);
  }

  svgMap.refreshScreen();
};

function buildSchema(features) {
  const metaSchema = new Set();
  for (const feature of features) {
    Object.keys(feature.properties).forEach(key => metaSchema.add(key));
  }
  return Array.from(metaSchema).join();
}