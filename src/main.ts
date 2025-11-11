// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./_leafletWorkaround.ts";

import luck from "./_luck.ts";

// Create basic UI elements

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
document.body.append(statusPanelDiv);

// Our classroom location
const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Token data
type Token = {
  id: string;
  value: number;
  i: number;
  j: number;
  rect?: leaflet.Rectangle; //
};

let heldToken: Token | null = null;

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(mapDiv, {
  center: CLASSROOM_LATLNG,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Player location
const playerLocation = leaflet.marker(CLASSROOM_LATLNG);
playerLocation.bindTooltip("You are here.");
playerLocation.addTo(map);

// Function to create tokens around map
function createToken(i: number, j: number): Token {
  const value = Math.random() < 0.5 ? 2 : 4;
  return { id: `${i},${j}`, value, i, j };
}

// Function for when the player drops token
function dropToken() {
  if (!heldToken) return;
  spawnToken(heldToken);
  heldToken = null;
  updateInventory();
}

// Function to update the inventory of player
function updateInventory() {
  statusPanelDiv.innerHTML = "";

  if (heldToken) {
    const tokenHeld = document.createElement("div");
    tokenHeld.textContent = `Token: ${heldToken.value}`;
    statusPanelDiv.appendChild(tokenHeld);

    const dropButton = document.createElement("button");
    dropButton.textContent = "Drop token";
    dropButton.onclick = () => dropToken();
    statusPanelDiv.appendChild(dropButton);
  } else {
    const emptyLabel = document.createElement("div");
    emptyLabel.textContent = "Nothing in inventory.";
    statusPanelDiv.appendChild(emptyLabel);
  }
}

// Function to spawn tokens
function spawnToken(token: Token) {
  const origin = CLASSROOM_LATLNG;
  const bounds = leaflet.latLngBounds([
    [origin.lat + token.i * TILE_DEGREES, origin.lng + token.j * TILE_DEGREES],
    [
      origin.lat + (token.i + 1) * TILE_DEGREES,
      origin.lng + (token.j + 1) * TILE_DEGREES,
    ],
  ]);

  const rect = leaflet.rectangle(bounds, { color: "red" }).addTo(map);
  token.rect = rect;

  rect.bindPopup(() => {
    const div = document.createElement("div");

    if (!heldToken) {
      const tokenInfo = document.createElement("div");
      tokenInfo.textContent = `Token value: ${token.value}`;
      div.appendChild(tokenInfo);

      const pickupButton = document.createElement("button");
      pickupButton.textContent = "Pick up";
      pickupButton.onclick = () => {
        heldToken = token;
        map.removeLayer(rect);
        updateInventory();
      };
      div.appendChild(pickupButton);
    } else if (heldToken.value === token.value) {
      const combineInfo = document.createElement("div");
      combineInfo.textContent =
        `Combine ${heldToken.value} with ${token.value}?`;
      div.appendChild(combineInfo);

      const combineButton = document.createElement("button");
      combineButton.textContent = "Combine";
      combineButton.onclick = () => combineTokens(token);
      div.appendChild(combineButton);
    } else {
      const notMatch = document.createElement("div");
      notMatch.textContent =
        `Cannot combine ${token.value} with ${heldToken.value}.`;
      div.appendChild(notMatch);
    }
    return div;
  });
}

// Function for combining tokens
function combineTokens(target: Token) {
  if (!heldToken || heldToken.value !== target.value) return;
  const combinedValue = target.value * 2;

  if (target.rect) {
    map.removeLayer(target.rect);
  }
  const combinedToken: Token = { //
    ...target,
    value: combinedValue,
  };

  spawnToken(combinedToken);

  heldToken = null;
  updateInventory();

  if (combinedValue >= 16) {
    alert(`🎉 You reached the maximum value: ${combinedValue}! You win!`);
  }
}

for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
      const token = createToken(i, j);
      spawnToken(token);
    }
  }
}

updateInventory();
