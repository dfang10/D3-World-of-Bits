// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
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
const VISIBLE_RADIUS = 25;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Token data
type Token = {
  id: string;
  value: number;
  i: number;
  j: number;
  rect?: leaflet.Rectangle;
};

// For getting lat and long
interface GridCell {
  i: number;
  j: number;
}

interface CellData {
  tokens: Token[];
  lastVisited?: number;
}

let heldToken: Token | null = null;

// Keeps track of cells that are loaded
const activeCells = new Map<string, CellData>();
const visibleBounds = {
  iMin: 0,
  iMax: 0,
  jMin: 0,
  jMax: 0,
};

// Create the map
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

// Function to convert world coords to grid coords
function convertLatLong(lat: number, lng: number): GridCell {
  const origin = CLASSROOM_LATLNG;
  return {
    i: Math.floor((lat - origin.lat) / TILE_DEGREES),
    j: Math.floor((lng - origin.lng) / TILE_DEGREES),
  };
}

function createBoundary(cell: GridCell): leaflet.LatLngBounds {
  const origin = CLASSROOM_LATLNG;
  return leaflet.latLngBounds([
    [origin.lat + cell.i * TILE_DEGREES, origin.lng + cell.j * TILE_DEGREES],
    [
      origin.lat + (cell.i + 1) * TILE_DEGREES,
      origin.lng + (cell.j + 1) * TILE_DEGREES,
    ],
  ]);
}

// Identify each grid
function getCellKey(cell: GridCell): string {
  return `${cell.i},${cell.j}`;
}

// Function to create tokens
function createToken(i: number, j: number): Token {
  const value = Math.random() < 0.5 ? 2 : 4;
  return { id: `${i},${j}-${Date.now()}`, value, i, j };
}

// Function to spawn a token in the world
function spawnToken(token: Token) {
  const bounds = createBoundary({ i: token.i, j: token.j });
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
        const cellKey = getCellKey({ i: token.i, j: token.j });
        const cellData = activeCells.get(cellKey);
        if (cellData) {
          cellData.tokens = cellData.tokens.filter((t) => t.id !== token.id);
        }
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

  // Respawn tokens when player moves away
  const cellKey = getCellKey({ i: token.i, j: token.j });
  if (!activeCells.has(cellKey)) {
    activeCells.set(cellKey, { tokens: [] });
  }
  activeCells.get(cellKey)!.tokens.push(token);
}

// Calculate which cells should appear while player is there
function updateVisibleCells() {
  const centerCell = convertLatLong(map.getCenter().lat, map.getCenter().lng);

  const newBounds = {
    iMin: centerCell.i - VISIBLE_RADIUS,
    iMax: centerCell.i + VISIBLE_RADIUS,
    jMin: centerCell.j - VISIBLE_RADIUS,
    jMax: centerCell.j + VISIBLE_RADIUS,
  };

  // Remove cells that are no longer visible
  for (const [cellKey, cellData] of activeCells.entries()) {
    const [i, j] = cellKey.split(",").map(Number);
    if (
      i < newBounds.iMin || i > newBounds.iMax || j < newBounds.jMin ||
      j > newBounds.jMax
    ) {
      cellData.tokens.forEach((token) => {
        if (token.rect) {
          map.removeLayer(token.rect);
        }
      });
      activeCells.delete(cellKey);
    }
  }

  // Add new cells that are now visible
  for (let i = newBounds.iMin; i <= newBounds.iMax; i++) {
    for (let j = newBounds.jMin; j <= newBounds.jMax; j++) {
      const cellKey = getCellKey({ i, j });

      if (!activeCells.has(cellKey)) {
        activeCells.set(cellKey, { tokens: [] });

        if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
          const token = createToken(i, j);
          spawnToken(token);
        }
      }
    }
  }

  visibleBounds.iMin = newBounds.iMin;
  visibleBounds.iMax = newBounds.iMax;
  visibleBounds.jMin = newBounds.jMin;
  visibleBounds.jMax = newBounds.jMax;
}

// Function for when the player drops token
function dropToken() {
  if (!heldToken) return;

  const playerCell = convertLatLong(map.getCenter().lat, map.getCenter().lng);
  const dropToken: Token = {
    ...heldToken,
    i: playerCell.i,
    j: playerCell.j,
    id: `${playerCell.i},${playerCell.j}-${Date.now()}`,
  };

  spawnToken(dropToken);
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

// Function for combining tokens
function combineTokens(target: Token) {
  if (!heldToken || heldToken.value !== target.value) return;
  const combinedValue = target.value * 2;

  if (target.rect) {
    map.removeLayer(target.rect);
  }

  const cellKey = getCellKey({ i: target.i, j: target.j });
  const cellData = activeCells.get(cellKey);
  if (cellData) {
    cellData.tokens = cellData.tokens.filter((t) => t.id !== target.id);
  }

  const combinedToken: Token = {
    ...target,
    value: combinedValue,
    id: `${target.i},${target.j}-${Date.now()}`,
  };

  spawnToken(combinedToken);
  heldToken = null;
  updateInventory();

  if (combinedValue >= 16) {
    alert(`🎉 You reached the maximum value: ${combinedValue}! You win!`);
  }
}

// Movement buttons
function createMovementButtons() {
  const buttonContainer = document.createElement("div");
  buttonContainer.id = "movementButtons";
  buttonContainer.style.position = "absolute";
  buttonContainer.style.top = "10px";
  buttonContainer.style.right = "10px";
  buttonContainer.style.zIndex = "1000";

  const directions = [
    { name: "North", lat: TILE_DEGREES, lng: 0 },
    { name: "South", lat: -TILE_DEGREES, lng: 0 },
    { name: "East", lat: 0, lng: TILE_DEGREES },
    { name: "West", lat: 0, lng: -TILE_DEGREES },
  ];

  directions.forEach((dir) => {
    const button = document.createElement("button");
    button.textContent = dir.name;
    button.style.margin = "5px";
    button.onclick = () => {
      const currentCenter = map.getCenter();
      map.setView([currentCenter.lat + dir.lat, currentCenter.lng + dir.lng]);
    };
    buttonContainer.appendChild(button);
  });

  document.body.appendChild(buttonContainer);
}

createMovementButtons();
updateVisibleCells();
updateInventory();

map.on("moveend", updateVisibleCells);
