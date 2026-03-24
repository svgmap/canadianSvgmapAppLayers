const baseUrl = "https://services2.arcgis.com/WLyMuW006nKOfa5Z/arcgis/rest/services/NCC_Paths_and_Trails/FeatureServer/1/";

onload = () => { // Removed 'const' to make it globally accessible/mutable.
//    addEventListener("zoomPanMap", getPathsNCC); 
//    Commented out: The API endpoint doesn't seem to support spatial queries (like bounding boxes). 
//    Since we are fetching the entire dataset at once, there's no need to re-fetch on every zoom or pan.
    getPathsNCC();
}

async function getPathsNCC() {
    const queryUrl = buildQuery(); // Building the full url 
    const pathData = await getData(queryUrl); // Fetching the data from the NCC's Paths/Trails API
    if (pathData === undefined) return; // Exiting early if the API request has failed
    drawPaths(pathData); // Drawing the paths from the geoJson Data
}

function buildQuery() {
    const query = `${baseUrl}query?where=1%3D1&outFields=*&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelEnvelopeIntersects&outSR=4326&f=geojson`
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
        console.error(err);
    }
    return undefined;
}

function drawPaths(pathData) {
    const metaSchema = buildSchema(pathData.features);
    const parentElement = svgImage.getElementById("mapContents");
    removeChildren(parentElement);
    svgMapGIStool.drawGeoJson(cleanGeoJSON(pathData), layerID, "blue", 0, "blue", "p0", "poi", "", parentElement, metaSchema);
    // Fixed: The helper function (drawGeoJson) was crashing due to invalid GeoJSON records (e.g., null geometries) in pathData.
    // While the helper function's error handling should eventually be improved, I've implemented a workaround 
    // by using cleanGeoJSON() to filter out malformed records before processing.
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
    metaSchema = Object.keys(metaSchema);
    // moving the OBJECTID param to the end -- not useful for at-a-glance readability
    metaSchema.push(metaSchema.shift());
    svgImage.documentElement.setAttribute("property", metaSchema.join());
    return metaSchema;
}

function removeChildren(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
}


/**
 * Validates GeoJSON features and removes those with invalid geometries.
 * @param {Object} geojson - The input FeatureCollection.
 * @returns {Object} A cleaned FeatureCollection.
 */
function cleanGeoJSON(geojson) {
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    console.error("Invalid input: The provided object is not a valid GeoJSON FeatureCollection.");
    return geojson;
  }

  const invalidFeatures = [];
  const validTypes = [
    'Point', 'MultiPoint', 'LineString', 'MultiLineString', 
    'Polygon', 'MultiPolygon', 'GeometryCollection'
  ];

  const cleanedFeatures = geojson.features.filter((feature, index) => {
    const geometry = feature.geometry;

    // 1. Check if geometry exists
    if (!geometry) {
      invalidFeatures.push({ index, reason: "Geometry is null or undefined" });
      return false;
    }

    // 2. Validate Geometry Type
    if (!validTypes.includes(geometry.type)) {
      invalidFeatures.push({ index, reason: `Invalid type: "${geometry.type}"` });
      return false;
    }

    // 3. Validate Coordinates (for standard geometries)
    if (geometry.type !== 'GeometryCollection') {
      if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
        invalidFeatures.push({ index, reason: "Coordinates are missing or empty" });
        return false;
      }
    } else {
      // 4. Validate GeometryCollection sub-items
      if (!Array.isArray(geometry.geometries) || geometry.geometries.length === 0) {
        invalidFeatures.push({ index, reason: "GeometryCollection is empty" });
        return false;
      }
    }

    return true;
  });

  // Alert the user if any invalid features were found
  if (invalidFeatures.length > 0) {
    const report = invalidFeatures
      .map(item => `[Feature ${item.index}]: ${item.reason}`)
      .join('\n');
    console.warn("GeoJSON Cleanup Report:\n" + report);
  }

  return {
    ...geojson,
    features: cleanedFeatures
  };
}