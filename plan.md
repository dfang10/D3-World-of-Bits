# D3: World of bits

# Game Design Vision

Game where you collect different items around campus. Combining duplicate items result in higher tiers.

# Technologies

- TypeScript for most game code, little to no explicit HTML, and all CSS collected in common `style.css` file
- Deno and Vite for building
- GitHub Actions + GitHub Pages for deployment automation

# Assignments

## D3.a: Core mechanics (token collection and crafting)

Key technical challenge: Can you assemble a map-based user interface using the Leaflet mapping framework?
Key gameplay challenge: Can players collect and craft tokens from nearby locations to finally make one of sufficiently high value?

### Steps

- [x] create plan.md file
- [x] copy main.ts to reference.ts for future reference
- [x] delete everything in main.ts
- [x] put a basic leaflet map on the screen
- [x] draw the player's location on the map
- [x] spawn items around the map
- [x] inventory system
- [x] crafting system

## D3.b: Global spanning gameplay (player movement and token spawning)

- [x] create buttons for player movement
- [x] create token popups on edge of map as player moves and despawn them when the player is out of view
- [x] memoryless cells

## D3.c: Object persistence

- [x] implement flyweight pattern to cells so cells that haven't been interacted with don't require memory to store them
- [x] implement modifying cells states staying if they aren't on the screen

## D4.d: Gameplay Across Real-world Space and Time

- [x] implement geolocation API, player moves based off real world movement
- [x] use the facade pattern to implement geolocation movement
- [x] use localStorage API to save the game when closed and refreshed
- [x] add a way for the player to restart their progress
- [x] add buttons so the player can choose which types of movement they want

### 
