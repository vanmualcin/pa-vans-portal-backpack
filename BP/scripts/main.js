import { system, world } from "@minecraft/server";

const BACKPACK_TYPE = "bp:wand";
const FIRE_WAND_TYPE = "bp:fire_wand";
const BACKPACK_ID_PROPERTY = "mcbackpack:id";
const BACKPACK_ENTITY = "mcbackpack:backpack_container";
const BACKPACK_TAG_PREFIX = "mcbackpack_id_";
const BACKPACK_PAGE_TAG_PREFIX = "mcbackpack_page_";
const BACKPACK_OPEN_TAG = "mcbackpack_open";
const BACKPACK_DISMISSED_TAG = "mcbackpack_dismissed";
const HIDDEN_Y = -60;
const DIMENSIONS = ["overworld", "nether", "the_end"];
const FIRE_BLAST_RANGE = 36;
const FIRE_BLAST_RADIUS = 8;
const FIRE_BLAST_STEP = 1.5;
const FIRE_BLAST_COOLDOWN_TICKS = 20;
const FIRE_BLAST_DAMAGE = 1000;
const fireBlastCooldowns = new Map();

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId === BACKPACK_TYPE) {
    system.run(() => toggleBackpackContainer(source));
  } else if (itemStack?.typeId === FIRE_WAND_TYPE) {
    system.run(() => fireBlast(source));
  }
});

function fireBlast(player) {
  if (!isEntityUsable(player)) return;

  const cooldownKey = player.id ?? player.name;
  const currentTick = system.currentTick ?? 0;
  const readyTick = fireBlastCooldowns.get(cooldownKey) ?? 0;
  if (currentTick < readyTick) return;
  fireBlastCooldowns.set(cooldownKey, currentTick + FIRE_BLAST_COOLDOWN_TICKS);

  const direction = normalizeVector(getViewDirection(player));
  const origin = getEyeLocation(player);
  const impact = findFireBlastImpact(player.dimension, origin, direction);

  spawnFireBlastTrail(player.dimension, origin, direction, distanceBetween(origin, impact));
  detonateFireBlast(player, impact);
}

function findFireBlastImpact(dimension, origin, direction) {
  let previousLocation = origin;

  for (let distance = FIRE_BLAST_STEP; distance <= FIRE_BLAST_RANGE; distance += FIRE_BLAST_STEP) {
    const location = addVector(origin, multiplyVector(direction, distance));
    const block = getBlockAtLocation(dimension, location);
    if (block && !block.isAir && !block.isLiquid) return previousLocation;
    previousLocation = location;
  }

  return addVector(origin, multiplyVector(direction, FIRE_BLAST_RANGE));
}

function spawnFireBlastTrail(dimension, origin, direction, range) {
  for (let distance = 1; distance <= range; distance += 2) {
    const location = addVector(origin, multiplyVector(direction, distance));
    try {
      dimension.spawnParticle("minecraft:basic_flame_particle", location);
    } catch {
      // Particles are cosmetic; the blast should still work if they are unavailable.
    }
  }
}

function detonateFireBlast(player, location) {
  try {
    player.dimension.createExplosion(location, FIRE_BLAST_RADIUS, {
      breaksBlocks: true,
      causesFire: true,
      source: player,
    });
  } catch {
    try {
      player.dimension.createExplosion(location, FIRE_BLAST_RADIUS);
    } catch {
      player.sendMessage("The fire blast fizzled out.");
      return;
    }
  }

  killBlastMobs(player, location);
}

function killBlastMobs(player, location) {
  const entities = player.dimension.getEntities({
    location,
    maxDistance: FIRE_BLAST_RADIUS,
    excludeTypes: ["minecraft:player"],
  });

  for (const entity of entities) {
    if (!isEntityUsable(entity) || entity.id === player.id) continue;
    if (!hasHealth(entity)) continue;

    try {
      entity.applyDamage(FIRE_BLAST_DAMAGE, {
        damagingEntity: player,
        cause: "entityExplosion",
      });
    } catch {
      try {
        entity.kill();
      } catch {
        // Some entities may be immune or unavailable by the time damage is applied.
      }
    }
  }
}

function hasHealth(entity) {
  try {
    return Boolean(entity.getComponent("minecraft:health"));
  } catch {
    return false;
  }
}

function toggleBackpackContainer(player) {
  if (!isEntityUsable(player)) return;

  const held = getHeldBackpack(player);
  if (!held) {
    player.sendMessage("Hold the Portal Wand and use it again.");
    return;
  }

  const backpackId = ensureBackpackId(player, held.item, held.slot);
  const page = player.isSneaking ? 2 : 1;
  const tag = getPageTag(backpackId, page);
  const existingEntity = findBackpackEntity(tag);

  if (existingEntity && isBackpackPresent(existingEntity, player)) {
    if (dismissBackpackEntity(existingEntity, player)) {
      player.sendMessage(`Storage Chest Page ${page} dismissed.`);
    } else {
      player.sendMessage("Could not dismiss the backpack container here.");
    }
    return;
  }

  const backpackEntity = existingEntity ?? createBackpackEntity(player, backpackId, page);
  if (!backpackEntity) {
    player.sendMessage("Could not open the backpack container here.");
    return;
  }

  moveEntityNearPlayer(backpackEntity, player);
  backpackEntity.addTag(BACKPACK_OPEN_TAG);
  backpackEntity.removeTag(BACKPACK_DISMISSED_TAG);
  backpackEntity.nameTag = `Storage Chest Page ${page}`;
  updateBackpackLore(player, backpackId);
  player.sendMessage(`Storage Chest Page ${page} summoned. Tap it to use those 27 slots.`);
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
    "Use: toggle page 1. Sneak-use: toggle page 2.",
  ]);
  getInventory(player)?.setItem(slot, item);
  return id;
}

function createBackpackEntity(player, backpackId, page) {
  const tag = getPageTag(backpackId, page);
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

function isBackpackPresent(entity, player) {
  if (!isEntityUsable(entity)) return false;
  if (entity.hasTag(BACKPACK_DISMISSED_TAG)) return false;
  if (entity.hasTag(BACKPACK_OPEN_TAG)) return true;
  if (isHiddenLocation(entity.location)) return false;

  try {
    return entity.dimension.id === player.dimension.id;
  } catch {
    return true;
  }
}

function dismissBackpackEntity(entity, player) {
  try {
    entity.teleport(getHiddenLocation(player), {
      dimension: player.dimension,
      checkForBlocks: false,
    });
    entity.removeTag(BACKPACK_OPEN_TAG);
    entity.addTag(BACKPACK_DISMISSED_TAG);
    return true;
  } catch {
    try {
      entity.teleport(getHighHiddenLocation(player), {
        dimension: player.dimension,
        checkForBlocks: false,
      });
      entity.removeTag(BACKPACK_OPEN_TAG);
      entity.addTag(BACKPACK_DISMISSED_TAG);
      return true;
    } catch {
      return false;
    }
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

function isHiddenLocation(location) {
  return location.y <= HIDDEN_Y + 1;
}

function getViewDirection(player) {
  try {
    return player.getViewDirection();
  } catch {
    return { x: 0, y: 0, z: 1 };
  }
}

function getEyeLocation(player) {
  const location = player.location;
  return {
    x: location.x,
    y: location.y + 1.6,
    z: location.z,
  };
}

function getBlockAtLocation(dimension, location) {
  try {
    return dimension.getBlock({
      x: Math.floor(location.x),
      y: Math.floor(location.y),
      z: Math.floor(location.z),
    });
  } catch {
    return undefined;
  }
}

function normalizeVector(vector) {
  const length = Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
  if (length === 0) return { x: 0, y: 0, z: 1 };
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function addVector(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function multiplyVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function distanceBetween(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function updateBackpackLore(player, backpackId) {
  const held = getHeldBackpack(player);
  if (!held) return;

  held.item.setLore([
    "Summons storage chests.",
    `ID: ${backpackId.slice(-6).toUpperCase()}`,
    "Use: toggle page 1. Sneak-use: toggle page 2.",
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
