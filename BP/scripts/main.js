import { system, world } from "@minecraft/server";

const BACKPACK_TYPE = "bp:wand";
const DISMISS_TYPE = "bp:dismiss";
const BACKPACK_ID_PROPERTY = "mcbackpack:id";
const BACKPACK_ENTITY = "mcbackpack:backpack_container";
const BACKPACK_TAG_PREFIX = "mcbackpack_id_";
const BACKPACK_PAGE_TAG_PREFIX = "mcbackpack_page_";
const HIDDEN_Y = -60;
const DIMENSIONS = ["overworld", "nether", "the_end"];

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId === BACKPACK_TYPE) {
    system.run(() => openBackpackContainer(source));
  } else if (itemStack?.typeId === DISMISS_TYPE) {
    system.run(() => dismissNearbyContainers(source));
  }
});

function openBackpackContainer(player) {
  if (!isEntityUsable(player)) return;

  const held = getHeldBackpack(player);
  if (!held) {
    player.sendMessage("Hold the Portal Wand and use it again.");
    return;
  }

  const backpackId = ensureBackpackId(player, held.item, held.slot);
  const page = player.isSneaking ? 2 : 1;
  const backpackEntity = findOrCreateBackpackEntity(player, backpackId, page);
  if (!backpackEntity) {
    player.sendMessage("Could not open the backpack container here.");
    return;
  }

  moveEntityNearPlayer(backpackEntity, player);
  backpackEntity.nameTag = `Storage Chest Page ${page}`;
  updateBackpackLore(player, backpackId);
  player.sendMessage(`Storage Chest Page ${page} summoned. Tap it to use those 27 slots.`);
}

function dismissNearbyContainers(player) {
  if (!isEntityUsable(player)) return;

  const nearbyContainers = player.dimension.getEntities({
    tags: ["mcbackpack_container"],
    location: player.location,
    maxDistance: 16,
  });

  if (nearbyContainers.length === 0) {
    player.sendMessage("No storage chests nearby to dismiss.");
    return;
  }

  let moved = 0;
  for (const entity of nearbyContainers) {
    try {
      entity.teleport(getHiddenLocation(player), {
        dimension: player.dimension,
        checkForBlocks: false,
      });
      moved++;
    } catch {
      try {
        entity.teleport(getHighHiddenLocation(player), {
          dimension: player.dimension,
          checkForBlocks: false,
        });
        moved++;
      } catch {
        // Leave any container we cannot move exactly where it is.
      }
    }
  }

  player.sendMessage(`Dismissed ${moved} storage chest${moved === 1 ? "" : "s"}.`);
}

function getHeldBackpack(player) {
  const container = getInventory(player);
  if (!container) return undefined;

  const slot = player.selectedSlotIndex ?? 0;
  const item = container.getItem(slot);
  if (!item || item.typeId !== BACKPACK_TYPE) return undefined;

  return { container, item, slot };
}

function ensureBackpackId(player, item, slot) {
  const existingId = item.getDynamicProperty(BACKPACK_ID_PROPERTY);
  if (typeof existingId === "string" && existingId.length > 0) return existingId;

  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000000).toString(36)}`;
  item.setDynamicProperty(BACKPACK_ID_PROPERTY, id);
  item.setLore([
    "Summons storage chests.",
    "Use: page 1. Sneak-use: page 2.",
  ]);
  getInventory(player)?.setItem(slot, item);
  return id;
}

function findOrCreateBackpackEntity(player, backpackId, page) {
  const tag = getPageTag(backpackId, page);
  const existing = findBackpackEntity(tag);
  if (existing) return existing;

  try {
    const entity = player.dimension.spawnEntity(BACKPACK_ENTITY, getOpenLocation(player));
    entity.addTag("mcbackpack_container");
    entity.addTag(`${BACKPACK_TAG_PREFIX}${backpackId}`);
    entity.addTag(tag);
    entity.nameTag = `Storage Chest Page ${page}`;
    return entity;
  } catch (error) {
    console.warn(`Failed to create backpack container: ${error}`);
    return undefined;
  }
}

function getPageTag(backpackId, page) {
  return `${BACKPACK_PAGE_TAG_PREFIX}${backpackId}_${page}`;
}

function findBackpackEntity(tag) {
  for (const dimensionId of DIMENSIONS) {
    try {
      const dimension = world.getDimension(dimensionId);
      const matches = dimension.getEntities({ tags: [tag] });
      if (matches.length > 0) return matches[0];
    } catch {
      // Dimensions or unloaded entity indexes may be unavailable during startup.
    }
  }

  return undefined;
}

function moveEntityNearPlayer(entity, player) {
  try {
    entity.teleport(getOpenLocation(player), {
      dimension: player.dimension,
      checkForBlocks: false,
    });
  } catch {
    try {
      entity.teleport(getOpenLocation(player), player.dimension);
    } catch {
      // If teleport fails, the entity still exists wherever it last was.
    }
  }
}

function getOpenLocation(player) {
  const direction = getViewDirection(player);
  const location = player.location;
  return {
    x: location.x + direction.x * 1.5,
    y: location.y + 0.1,
    z: location.z + direction.z * 1.5,
  };
}

function getHiddenLocation(player) {
  return {
    x: Math.floor(player.location.x),
    y: HIDDEN_Y,
    z: Math.floor(player.location.z),
  };
}

function getHighHiddenLocation(player) {
  return {
    x: Math.floor(player.location.x),
    y: Math.floor(player.location.y) + 96,
    z: Math.floor(player.location.z),
  };
}

function getViewDirection(player) {
  try {
    return player.getViewDirection();
  } catch {
    return { x: 0, y: 0, z: 1 };
  }
}

function updateBackpackLore(player, backpackId) {
  const held = getHeldBackpack(player);
  if (!held) return;

  held.item.setLore([
    "Summons storage chests.",
    `ID: ${backpackId.slice(-6).toUpperCase()}`,
    "Use: page 1. Sneak-use: page 2.",
  ]);
  held.container.setItem(held.slot, held.item);
}

function getInventory(player) {
  try {
    if (!isEntityUsable(player)) return undefined;
    return player.getComponent("minecraft:inventory")?.container;
  } catch {
    return undefined;
  }
}

function isEntityUsable(entity) {
  if (!entity) return false;
  if (typeof entity.isValid === "function") return entity.isValid();
  return entity.isValid !== false;
}
