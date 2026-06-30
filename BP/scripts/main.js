import { system, world } from "@minecraft/server";

const STORAGE_WAND_TYPE = "pv:storage_wand";
const FIRE_WAND_TYPE = "pv:fire_wand";
const RESTORATION_WAND_TYPE = "pv:restoration_wand";
const STORAGE_ID_PROPERTY = "pv:storage_wand_id";
const STORAGE_ENTITY = "pv:storage_container";
const STORAGE_TAG_PREFIX = "pv_storage_id_";
const STORAGE_PAGE_TAG_PREFIX = "pv_storage_page_";
const STORAGE_OPEN_TAG = "pv_storage_open";
const STORAGE_DISMISSED_TAG = "pv_storage_dismissed";
const HIDDEN_Y = -60;
const DIMENSIONS = ["overworld", "nether", "the_end"];
const FIRE_BLAST_RANGE = 36;
const FIRE_BLAST_RADIUS = 8;
const FIRE_BLAST_STEP = 1.5;
const FIRE_BLAST_COOLDOWN_TICKS = 20;
const FIRE_BLAST_DAMAGE = 1000;
const FIRE_DESTRUCTIVE_MIN_CHARGE_TICKS = 10;
const FIRE_DESTRUCTIVE_MAX_CHARGE_TICKS = 30;
const FIRE_DESTRUCTIVE_MIN_RADIUS = 3;
const FIRE_DESTRUCTIVE_MAX_RADIUS = 7;
const FIRE_DESTRUCTIVE_COOLDOWN_TICKS = 60;
const RESTORATION_RANGE = 8;
const RESTORATION_TARGET_RADIUS = 1.4;
const RESTORATION_COOLDOWN_TICKS = 40;
const canTrackFireWandCharge = Boolean(world.afterEvents.itemStartUse?.subscribe) &&
  Boolean(world.afterEvents.itemReleaseUse?.subscribe || world.afterEvents.itemStopUse?.subscribe);
const fireBlastCooldowns = new Map();
const fireWandChargeStarts = new Map();
const fireWandReleaseTicks = new Map();
const restorationCooldowns = new Map();

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId === STORAGE_WAND_TYPE) {
    system.run(() => toggleStorageContainer(source));
  } else if (itemStack?.typeId === FIRE_WAND_TYPE && !canTrackFireWandCharge) {
    system.run(() => fireBlast(source));
  } else if (itemStack?.typeId === RESTORATION_WAND_TYPE) {
    system.run(() => restoreZombieVillager(source));
  }
});

world.afterEvents.itemStartUse?.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId === FIRE_WAND_TYPE) {
    fireWandChargeStarts.set(getCooldownKey(source), system.currentTick ?? 0);
  }
});

world.afterEvents.itemReleaseUse?.subscribe((event) => {
  if (event.itemStack?.typeId === FIRE_WAND_TYPE) {
    system.run(() => releaseFireWand(event));
  }
});

world.afterEvents.itemStopUse?.subscribe((event) => {
  if (event.itemStack?.typeId === FIRE_WAND_TYPE) {
    system.run(() => releaseFireWand(event));
  }
});

function fireBlast(player) {
  if (!isEntityUsable(player)) return;

  if (!tryUseCooldown(player, fireBlastCooldowns, FIRE_BLAST_COOLDOWN_TICKS)) return;

  fireBlastAtImpact(player, false, FIRE_BLAST_RADIUS);
}

function releaseFireWand(event) {
  const player = event.source;
  if (!isEntityUsable(player)) return;

  const cooldownKey = getCooldownKey(player);
  const currentTick = system.currentTick ?? 0;
  if (fireWandReleaseTicks.get(cooldownKey) === currentTick) return;
  fireWandReleaseTicks.set(cooldownKey, currentTick);

  const heldTicks = getFireWandHeldTicks(event);
  fireWandChargeStarts.delete(cooldownKey);

  if (heldTicks < FIRE_DESTRUCTIVE_MIN_CHARGE_TICKS) {
    fireBlast(player);
    return;
  }

  if (!tryUseCooldown(player, fireBlastCooldowns, FIRE_DESTRUCTIVE_COOLDOWN_TICKS)) return;

  const charge = Math.min(
    1,
    (heldTicks - FIRE_DESTRUCTIVE_MIN_CHARGE_TICKS) /
      (FIRE_DESTRUCTIVE_MAX_CHARGE_TICKS - FIRE_DESTRUCTIVE_MIN_CHARGE_TICKS),
  );
  const radius = FIRE_DESTRUCTIVE_MIN_RADIUS +
    (FIRE_DESTRUCTIVE_MAX_RADIUS - FIRE_DESTRUCTIVE_MIN_RADIUS) * charge;

  fireBlastAtImpact(player, true, radius);
}

function getFireWandHeldTicks(event) {
  const player = event.source;
  const currentTick = system.currentTick ?? 0;
  const startTick = fireWandChargeStarts.get(getCooldownKey(player));
  if (typeof startTick === "number") return Math.max(0, currentTick - startTick);
  if (typeof event.useDuration === "number") return event.useDuration;
  return 0;
}

function fireBlastAtImpact(player, breaksBlocks, radius) {
  const direction = normalizeVector(getViewDirection(player));
  const origin = getEyeLocation(player);
  const impact = findFireBlastImpact(player.dimension, origin, direction);

  spawnFireBlastTrail(player.dimension, origin, direction, distanceBetween(origin, impact));
  detonateFireBlast(player, impact, breaksBlocks, radius);
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

function detonateFireBlast(player, location, breaksBlocks, radius) {
  if (breaksBlocks) {
    try {
      player.dimension.createExplosion(location, radius, {
        breaksBlocks: true,
        causesFire: true,
        source: player,
      });
      return;
    } catch (error) {
      console.warn(`Failed to create destructive fire blast: ${error}`);
    }
  }

  try {
    player.dimension.spawnParticle("minecraft:large_explosion", location);
  } catch {
    // The damage pulse still applies if the visual effect is unavailable.
  }

  killBlastMobs(player, location, radius);
}

function killBlastMobs(player, location, radius = FIRE_BLAST_RADIUS) {
  const entities = player.dimension.getEntities({
    location,
    maxDistance: radius,
    excludeTypes: ["minecraft:player"],
  });

  for (const entity of entities) {
    if (!isEntityUsable(entity) || entity.id === player.id) continue;
    if (entity.typeId === STORAGE_ENTITY) continue;
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

function getCooldownKey(entity) {
  return entity.id ?? entity.name;
}

function isCooldownReady(entity, cooldowns) {
  const cooldownKey = getCooldownKey(entity);
  const currentTick = system.currentTick ?? 0;
  const readyTick = cooldowns.get(cooldownKey) ?? 0;
  return currentTick >= readyTick;
}

function tryUseCooldown(entity, cooldowns, cooldownTicks) {
  const cooldownKey = getCooldownKey(entity);
  const currentTick = system.currentTick ?? 0;
  const readyTick = cooldowns.get(cooldownKey) ?? 0;
  if (currentTick < readyTick) return false;
  cooldowns.set(cooldownKey, currentTick + cooldownTicks);
  return true;
}

function restoreZombieVillager(player) {
  if (!isEntityUsable(player)) return;

  if (!isCooldownReady(player, restorationCooldowns)) return;

  const target = findTargetedZombieVillager(player);
  if (!target) {
    player.sendMessage(`Aim at a zombie villager within ${RESTORATION_RANGE} blocks.`);
    return;
  }

  tryUseCooldown(player, restorationCooldowns, RESTORATION_COOLDOWN_TICKS);

  const location = target.location;
  const nameTag = target.nameTag;

  try {
    const villager = player.dimension.spawnEntity("minecraft:villager_v2", location);
    if (nameTag) villager.nameTag = nameTag;
    removeEntity(target);
    spawnRestorationParticles(player.dimension, location);
    player.sendMessage("Zombie villager restored.");
  } catch (error) {
    console.warn(`Failed to restore zombie villager: ${error}`);
    player.sendMessage("Could not restore that zombie villager here.");
  }
}

function findTargetedZombieVillager(player) {
  const origin = getEyeLocation(player);
  const direction = normalizeVector(getViewDirection(player));
  const entities = player.dimension.getEntities({
    location: origin,
    maxDistance: RESTORATION_RANGE,
  });

  let closest;
  let closestProjection = RESTORATION_RANGE + 1;

  for (const entity of entities) {
    if (!isZombieVillager(entity)) continue;

    const targetLocation = getEntityCenter(entity);
    const offset = subtractVector(targetLocation, origin);
    const projection = dotVector(offset, direction);
    if (projection < 0 || projection > RESTORATION_RANGE) continue;

    const closestPoint = addVector(origin, multiplyVector(direction, projection));
    const missDistance = distanceBetween(targetLocation, closestPoint);
    if (missDistance > RESTORATION_TARGET_RADIUS) continue;
    if (!hasClearPath(player.dimension, origin, direction, projection)) continue;

    if (projection < closestProjection) {
      closest = entity;
      closestProjection = projection;
    }
  }

  return closest;
}

function isZombieVillager(entity) {
  return entity?.typeId === "minecraft:zombie_villager" || entity?.typeId === "minecraft:zombie_villager_v2";
}

function getEntityCenter(entity) {
  const location = entity.location;
  return {
    x: location.x,
    y: location.y + 1,
    z: location.z,
  };
}

function hasClearPath(dimension, origin, direction, range) {
  for (let distance = 0.75; distance < range; distance += 0.75) {
    const location = addVector(origin, multiplyVector(direction, distance));
    const block = getBlockAtLocation(dimension, location);
    if (block && !block.isAir && !block.isLiquid) return false;
  }

  return true;
}

function removeEntity(entity) {
  try {
    entity.remove();
  } catch {
    try {
      entity.kill();
    } catch {
      // The restored villager has already been spawned, so leave unavailable entities alone.
    }
  }
}

function spawnRestorationParticles(dimension, location) {
  for (const particle of ["minecraft:villager_happy", "minecraft:totem_particle"]) {
    try {
      dimension.spawnParticle(particle, {
        x: location.x,
        y: location.y + 1,
        z: location.z,
      });
      return;
    } catch {
      // The cure should still happen when a cosmetic particle is unavailable.
    }
  }
}

function toggleStorageContainer(player) {
  if (!isEntityUsable(player)) return;

  const held = getHeldStorageWand(player);
  if (!held) {
    player.sendMessage("Hold the Storage Wand and use it again.");
    return;
  }

  const storageId = ensureStorageId(player, held.item, held.slot);
  const page = player.isSneaking ? 2 : 1;
  const tag = getPageTag(storageId, page);
  const existingEntity = findStorageEntity(tag);

  if (existingEntity && isStoragePresent(existingEntity, player)) {
    if (dismissStorageEntity(existingEntity, player)) {
      player.sendMessage(`Storage Chest Page ${page} dismissed.`);
    } else {
      player.sendMessage("Could not dismiss the storage container here.");
    }
    return;
  }

  const storageEntity = existingEntity ?? createStorageEntity(player, storageId, page);
  if (!storageEntity) {
    player.sendMessage("Could not open the storage container here.");
    return;
  }

  moveEntityNearPlayer(storageEntity, player);
  storageEntity.addTag(STORAGE_OPEN_TAG);
  storageEntity.removeTag(STORAGE_DISMISSED_TAG);
  storageEntity.nameTag = `Storage Chest Page ${page}`;
  updateStorageWandLore(player, storageId);
  player.sendMessage(`Storage Chest Page ${page} summoned. Tap it to use those 27 slots.`);
}

function getHeldStorageWand(player) {
  const container = getInventory(player);
  if (!container) return undefined;

  const slot = player.selectedSlotIndex ?? 0;
  const item = container.getItem(slot);
  if (!item || item.typeId !== STORAGE_WAND_TYPE) return undefined;

  return { container, item, slot };
}

function ensureStorageId(player, item, slot) {
  const existingId = item.getDynamicProperty(STORAGE_ID_PROPERTY);
  if (typeof existingId === "string" && existingId.length > 0) return existingId;

  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000000).toString(36)}`;
  item.setDynamicProperty(STORAGE_ID_PROPERTY, id);
  item.setLore([
    "Summons storage chests.",
    "Use: toggle page 1. Sneak-use: toggle page 2.",
  ]);
  getInventory(player)?.setItem(slot, item);
  return id;
}

function createStorageEntity(player, storageId, page) {
  const tag = getPageTag(storageId, page);
  try {
    const entity = player.dimension.spawnEntity(STORAGE_ENTITY, getOpenLocation(player));
    entity.addTag("pv_storage_container");
    entity.addTag(`${STORAGE_TAG_PREFIX}${storageId}`);
    entity.addTag(tag);
    entity.nameTag = `Storage Chest Page ${page}`;
    return entity;
  } catch (error) {
    console.warn(`Failed to create storage container: ${error}`);
    return undefined;
  }
}

function isStoragePresent(entity, player) {
  if (!isEntityUsable(entity)) return false;
  if (entity.hasTag(STORAGE_DISMISSED_TAG)) return false;
  if (entity.hasTag(STORAGE_OPEN_TAG)) return true;
  if (isHiddenLocation(entity.location)) return false;

  try {
    return entity.dimension.id === player.dimension.id;
  } catch {
    return true;
  }
}

function dismissStorageEntity(entity, player) {
  try {
    entity.teleport(getHiddenLocation(player), {
      dimension: player.dimension,
      checkForBlocks: false,
    });
    entity.removeTag(STORAGE_OPEN_TAG);
    entity.addTag(STORAGE_DISMISSED_TAG);
    return true;
  } catch {
    try {
      entity.teleport(getHighHiddenLocation(player), {
        dimension: player.dimension,
        checkForBlocks: false,
      });
      entity.removeTag(STORAGE_OPEN_TAG);
      entity.addTag(STORAGE_DISMISSED_TAG);
      return true;
    } catch {
      return false;
    }
  }
}

function getPageTag(storageId, page) {
  return `${STORAGE_PAGE_TAG_PREFIX}${storageId}_${page}`;
}

function findStorageEntity(tag) {
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

function subtractVector(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function multiplyVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function dotVector(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distanceBetween(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function updateStorageWandLore(player, storageId) {
  const held = getHeldStorageWand(player);
  if (!held) return;

  held.item.setLore([
    "Summons storage chests.",
    `ID: ${storageId.slice(-6).toUpperCase()}`,
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
