const baseUrl = "https://services2.arcgis.com/WLyMuW006nKOfa5Z/arcgis/rest/services/NCC_Paths_and_Trails/FeatureServer/1/";

const onload = () => {
    addEventListener("zoomPanMap", getPathsNCC);
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
    svgMapGIStool.drawGeoJson(pathData.features, layerID, "blue", 0, "blue", "p0", "poi", "", parentElement, metaSchema);
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