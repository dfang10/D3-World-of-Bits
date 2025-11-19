// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./_leafletWorkaround.ts";
import luck from "./_luck.ts";

// Facade pattern
interface MovementController {
  start(): void;
  stop(): void;
  getCurrentPosition(): leaflet.LatLng | null;
  isAvailable(): boolean;
}

// Button movement
class ButtonMovementController implements MovementController {
  private currentPosition: leaflet.LatLng;

  constructor(initialPosition: leaflet.LatLng) {
    this.currentPosition = initialPosition;
  }

  start(): void {
    console.log("Button movement started");
  }

  stop(): void {
    console.log("Button movement stoped");
  }

  getCurrentPosition(): leaflet.LatLng {
    return this.currentPosition;
  }

  setCurrentPosition(position: leaflet.LatLng): void {
    this.currentPosition = position;
  }

  isAvailable(): boolean {
    return true;
  }
}

// Real world location
class GeolocationMovementController implements MovementController {
  private currentPosition: leaflet.LatLng | null = null;
  private watchId: number | null = null;

  constructor(initialPosition: leaflet.LatLng) {
    this.currentPosition = initialPosition;
  }

  start(): void {
    if (this.watchId !== null) return;

    if ("geolocation" in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          this.currentPosition = leaflet.latLng(
            position.coords.latitude,
            position.coords.longitude,
          );
          console.log("Geolocation updated:", this.currentPosition);
          map.setView(this.currentPosition);
          updateVisibleCells();
        },
        (error) => {
          console.error("Geolocation error:", error);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 1000,
          timeout: 5000,
        },
      );
    }
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  getCurrentPosition(): leaflet.LatLng | null {
    return this.currentPosition;
  }

  isAvailable(): boolean {
    return "geolocation" in navigator;
  }
}

interface SerializedToken {
  id: string;
  value: number;
  i: number;
  j: number;
}

interface CellState {
  hasBeenModified: boolean;
  baseTokens: SerializedToken[];
}

interface GameState {
  persistentCells: Array<[string, CellState]>;
  playerPosition: { lat: number; lng: number };
  heldToken: SerializedToken | null;
  movementType: "buttons" | "geolocation";
}

class GameStorage {
  private static readonly STORAGE_KEY = "tokenGameState";

  static saveGameState(state: GameState): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
      console.log("Game state saved");
    } catch (error) {
      console.error("Failed to save game state:", error);
    }
  }

  static loadGameState(): GameState | null {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error("Failed to load game state:", error);
    }
    return null;
  }

  static clearGameState(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      console.log("Game state cleared");
    } catch (error) {
      console.error("Failed to clear game state:", error);
    }
  }

  static hasSavedGame(): boolean {
    return localStorage.getItem(this.STORAGE_KEY) !== null;
  }
}

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

let heldToken: Token | null = null;

// Movement controller
let movementController: MovementController;
let currentMovementType: "buttons" | "geolocation" = "buttons";

// Persistent and active cell storage
const persistentCells = new Map<string, CellState>();
const activeCells = new Map<
  string,
  { tokens: Token[]; visualElements: leaflet.Rectangle[] }
>();

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

// MEMENTO: Save cell state to persistent storage
function saveCellState(cellKey: string, tokens: Token[]) {
  persistentCells.set(cellKey, {
    hasBeenModified: true,
    baseTokens: tokens.map((token) => {
      const { ...serializedToken } = token;
      return serializedToken;
    }),
  });
}

// MEMENTO: Load cell state from persistent storage
function loadCellState(cellKey: string): Token[] {
  const state = persistentCells.get(cellKey);
  if (!state) return [];

  return state.baseTokens.map((serializedToken) => ({
    ...serializedToken,
  }));
}

// MEMENTO: Check if cell has been modified by player
function cellModified(cellKey: string): boolean {
  return persistentCells.has(cellKey) &&
    persistentCells.get(cellKey)!.hasBeenModified;
}

// Function to spawn a token in the world
function spawnToken(token: Token, isPlayerModified: boolean = false) {
  const bounds = createBoundary({ i: token.i, j: token.j });
  const rect = leaflet.rectangle(bounds, {
    color: isPlayerModified ? "blue" : "red",
  }).addTo(map);
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
        handleTokenPickup(token);
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

  // Register token in active cell
  const cellKey = getCellKey({ i: token.i, j: token.j });
  if (!activeCells.has(cellKey)) {
    activeCells.set(cellKey, { tokens: [], visualElements: [] });
  }

  const cellData = activeCells.get(cellKey)!;
  cellData.tokens.push(token);
  cellData.visualElements.push(rect);
}

// Enhanced token pickup with persistence
function handleTokenPickup(token: Token) {
  const cellKey = getCellKey({ i: token.i, j: token.j });
  const cellData = activeCells.get(cellKey);

  if (cellData) {
    cellData.tokens = cellData.tokens.filter((t) => t.id !== token.id);
    if (token.rect) {
      map.removeLayer(token.rect);
      cellData.visualElements = cellData.visualElements.filter((rect) =>
        rect !== token.rect
      );
    }

    // MEMENTO: Save updated state to persistent storage
    saveCellState(cellKey, cellData.tokens);
  }

  heldToken = token;
  updateInventory();
  saveGameState();
}

// Calculate which cells should appear while player is there
function updateVisibleCells() {
  const position = movementController.getCurrentPosition();
  if (!position) return;

  const centerCell = convertLatLong(position.lat, position.lng);

  const newBounds = {
    iMin: centerCell.i - VISIBLE_RADIUS,
    iMax: centerCell.i + VISIBLE_RADIUS,
    jMin: centerCell.j - VISIBLE_RADIUS,
    jMax: centerCell.j + VISIBLE_RADIUS,
  };

  for (const [_cellKey, cellData] of activeCells.entries()) {
    cellData.visualElements.forEach((rect) => {
      map.removeLayer(rect);
    });
  }

  activeCells.clear();

  // Rebuild visible area from data
  for (let i = newBounds.iMin; i <= newBounds.iMax; i++) {
    for (let j = newBounds.jMin; j <= newBounds.jMax; j++) {
      const cellKey = getCellKey({ i, j });

      activeCells.set(cellKey, { tokens: [], visualElements: [] });

      if (cellModified(cellKey)) {
        // MEMENTO PATTERN: Restore from persistent storage
        const savedTokens = loadCellState(cellKey);

        savedTokens.forEach((token) => {
          const freshToken = {
            ...token,
            i,
            j,
            id: `${i},${j}-${Date.now()}`,
          };
          spawnToken(freshToken, true);
        });
      } else {
        // FLYWEIGHT PATTERN: Generate fresh cell
        if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
          const token = createToken(i, j);
          spawnToken(token, false);
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

  const position = movementController.getCurrentPosition();
  if (!position) return;

  const playerCell = convertLatLong(position.lat, position.lng);
  const droppedToken: Token = {
    ...heldToken,
    i: playerCell.i,
    j: playerCell.j,
    id: `${playerCell.i},${playerCell.j}-${Date.now()}`,
  };

  const cellKey = getCellKey(playerCell);

  // Add to active display
  spawnToken(droppedToken, true);

  // MEMENTO: Save to persistent storage
  const cellData = activeCells.get(cellKey)!;
  saveCellState(cellKey, cellData.tokens);

  heldToken = null;
  updateInventory();
  saveGameState();
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
  const cellKey = getCellKey({ i: target.i, j: target.j });

  const cellData = activeCells.get(cellKey);
  if (cellData) {
    cellData.tokens = cellData.tokens.filter((t) => t.id !== target.id);
    if (target.rect) {
      map.removeLayer(target.rect);
      cellData.visualElements = cellData.visualElements.filter((rect) =>
        rect !== target.rect
      );
    }
  }

  // Create combined token
  const combinedToken: Token = {
    ...target,
    value: combinedValue,
    id: `${target.i},${target.j}-${Date.now()}`,
  };

  spawnToken(combinedToken, true);

  // MEMENTO: Save updated state
  saveCellState(cellKey, activeCells.get(cellKey)!.tokens);

  heldToken = null;
  updateInventory();
  saveGameState();

  if (combinedValue >= 64) {
    alert(`🎉 You reached the maximum value: ${combinedValue}! You win!`);
  }
}

// Initialize movement based on URL parameter or default
function initializeMovementController() {
  const urlParams = new URLSearchParams(globalThis.location.search);
  const movementParam = urlParams.get("movement");

  if (movementParam === "geolocation") {
    currentMovementType = "geolocation";
  }

  if (currentMovementType === "geolocation") {
    movementController = new GeolocationMovementController(CLASSROOM_LATLNG);
  } else {
    movementController = new ButtonMovementController(CLASSROOM_LATLNG);
  }

  movementController.start();
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
      const currentPosition = movementController.getCurrentPosition();
      if (
        currentPosition &&
        movementController instanceof ButtonMovementController
      ) {
        const newPosition = leaflet.latLng(
          currentPosition.lat + dir.lat,
          currentPosition.lng + dir.lng,
        );
        (movementController as ButtonMovementController).setCurrentPosition(
          newPosition,
        );
        playerLocation.setLatLng(newPosition);
        map.setView(newPosition);
        updateVisibleCells();
        saveGameState();
      }
    };
    buttonContainer.appendChild(button);
  });

  // Add movement type switcher
  const switchButton = document.createElement("button");
  switchButton.textContent = `Switch to ${
    currentMovementType === "buttons" ? "Geolocation" : "Buttons"
  }`;
  switchButton.style.margin = "5px";
  switchButton.onclick = switchMovementType;
  buttonContainer.appendChild(switchButton);

  // Add new game button
  const newGameButton = document.createElement("button");
  newGameButton.textContent = "New Game";
  newGameButton.style.margin = "5px";
  newGameButton.onclick = startNewGame;
  buttonContainer.appendChild(newGameButton);

  document.body.appendChild(buttonContainer);
  updateMovementUI();
}

// Switch between movement types
function switchMovementType(): void {
  movementController.stop();

  if (currentMovementType === "buttons") {
    currentMovementType = "geolocation";
    movementController = new GeolocationMovementController(
      movementController.getCurrentPosition() || CLASSROOM_LATLNG,
    );
  } else {
    currentMovementType = "buttons";
    movementController = new ButtonMovementController(
      movementController.getCurrentPosition() || CLASSROOM_LATLNG,
    );
  }

  movementController.start();
  updateMovementUI();
  saveGameState();
}

// Update movement UI
function updateMovementUI(): void {
  const buttons = document.querySelectorAll("#movementButtons button");
  const switchButton = buttons[buttons.length - 2] as HTMLButtonElement;
  if (switchButton) {
    switchButton.textContent = `Switch to ${
      currentMovementType === "buttons" ? "Geolocation" : "Buttons"
    }`;
  }

  // Show/hide directional buttons based on movement type
  const directionButtons = document.querySelectorAll(
    "#movementButtons button:not(:last-child):not(:nth-last-child(2))",
  );
  directionButtons.forEach((button) => {
    (button as HTMLElement).style.display = currentMovementType === "buttons"
      ? "inline-block"
      : "none";
  });
}

// Save game state
function saveGameState(): void {
  const position = movementController.getCurrentPosition();
  const gameState: GameState = {
    persistentCells: Array.from(persistentCells.entries()),
    playerPosition: position
      ? { lat: position.lat, lng: position.lng }
      : { lat: CLASSROOM_LATLNG.lat, lng: CLASSROOM_LATLNG.lng },
    heldToken: heldToken
      ? {
        id: heldToken.id,
        value: heldToken.value,
        i: heldToken.i,
        j: heldToken.j,
      }
      : null,
    movementType: currentMovementType,
  };

  GameStorage.saveGameState(gameState);
}

// Load game state
function loadGameState(): boolean {
  const savedState = GameStorage.loadGameState();
  if (!savedState) return false;

  // Restore persistent cells
  persistentCells.clear();
  savedState.persistentCells.forEach(([key, state]) => {
    persistentCells.set(key, state);
  });

  // Restore player position
  if (savedState.playerPosition) {
    const position = leaflet.latLng(
      savedState.playerPosition.lat,
      savedState.playerPosition.lng,
    );
    if (movementController instanceof ButtonMovementController) {
      movementController.setCurrentPosition(position);
    }
    playerLocation.setLatLng(position);
    map.setView(position);
  }

  // Restore held token
  heldToken = savedState.heldToken;

  // Restore movement type
  currentMovementType = savedState.movementType;

  updateInventory();
  updateVisibleCells();
  updateMovementUI();

  console.log("Game state loaded");
  return true;
}

// Start new game
function startNewGame(): void {
  if (
    confirm(
      "Are you sure you want to start a new game? All progress will be lost.",
    )
  ) {
    // Clear persistent state
    persistentCells.clear();
    heldToken = null;

    // Reset position
    const position = CLASSROOM_LATLNG;
    if (movementController instanceof ButtonMovementController) {
      movementController.setCurrentPosition(position);
    }
    playerLocation.setLatLng(position);
    map.setView(position);

    // Clear storage
    GameStorage.clearGameState();

    // Reset UI
    updateInventory();
    updateVisibleCells();

    console.log("New game started");
  }
}

// Initialize the game
function initializeGame() {
  createMovementButtons();
  initializeMovementController();

  // Try to load saved game, otherwise start fresh
  if (!loadGameState()) {
    updateVisibleCells();
  }

  updateInventory();

  // Auto-save every 30 seconds
  setInterval(saveGameState, 30000);
}

initializeGame();

// Save game state when page is about to close
globalThis.addEventListener("beforeunload", saveGameState);

// Update map when movement ends (for button movement)
map.on("moveend", () => {
  if (currentMovementType === "buttons") {
    updateVisibleCells();
    saveGameState();
  }
});
