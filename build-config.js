const fs = require("fs");
const path = require("path");

const apiKey = process.env.GOOGLE_MAPS_API_KEY;

if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
}

const config = `
window.CHAKRAVAAT_CONFIG = {
    googleMapsApiKey: ${JSON.stringify(apiKey)}
};
`;

const outputPath = path.join(
    __dirname,
    "js",
    "config.local.js"
);

fs.writeFileSync(outputPath, config, "utf8");

console.log("Generated js/config.local.js successfully.");