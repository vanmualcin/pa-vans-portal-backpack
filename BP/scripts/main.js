import { system, world } from "@minecraft/server";

const STORAGE_WAND_TYPE = "pv:storage_wand";
const FIRE_WAND_TYPE = "pv:fire_wand";
const ICE_WAND_TYPE = "pv:ice_wand";
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
const FIRE_CHARGE_FEEDBACK_INTERVAL_TICKS = 4;
const ICE_FREEZE_RANGE = 28;
const ICE_FREEZE_STEP = 0.75;
const ICE_FREEZE_TARGET_RADIUS = 1.25;
const ICE_FREEZE_WATER_RADIUS = 2;
const ICE_FREEZE_COOLDOWN_TICKS = 30;
const ICE_FREEZE_MIN_CHARGE_TICKS = 8;
const ICE_FREEZE_MAX_CHARGE_TICKS = 24;
const ICE_CHARGE_FEEDBACK_INTERVAL_TICKS = 4;
const ICE_FREEZE_EFFECT_TICKS = 100;
const RESTORATION_RANGE = 8;
const RESTORATION_TARGET_RADIUS = 1.4;
const RESTORATION_COOLDOWN_TICKS = 40;
const canTrackFireWandCharge = Boolean(world.afterEvents.itemStartUse?.subscribe) &&
  Boolean(world.afterEvents.itemReleaseUse?.subscribe || world.afterEvents.itemStopUse?.subscribe);
const canTrackIceWandCharge = Boolean(world.afterEvents.itemStartUse?.subscribe) &&
  Boolean(world.afterEvents.itemReleaseUse?.subscribe || world.afterEvents.itemStopUse?.subscribe);
const fireBlastCooldowns = new Map();
const fireWandChargeStarts = new Map();
const fireWandReleaseTicks = new Map();
const fireWandFullChargeNotified = new Set();
const iceWandCooldowns = new Map();
const iceWandChargeStarts = new Map();
const iceWandReleaseTicks = new Map();
const iceWandFullChargeNotified = new Set();
const restorationCooldowns = new Map();

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId === STORAGE_WAND_TYPE) {
    system.run(() => toggleStorageContainer(source));
  } else if (itemStack?.typeId === FIRE_WAND_TYPE && !canTrackFireWandCharge) {
    system.run(() => fireBlast(source));
  } else if (itemStack?.typeId === ICE_WAND_TYPE && !canTrackIceWandCharge) {
    system.run(() => freezeTarget(source));
  } else if (itemStack?.typeId === RESTORATION_WAND_TYPE) {
    system.run(() => restoreZombieVillager(source));
  }
});

world.afterEvents.itemStartUse?.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId === FIRE_WAND_TYPE) {
    startFireWandCharge(source);
  } else if (itemStack?.typeId === ICE_WAND_TYPE) {
    startIceWandCharge(source);
  }
});

world.afterEvents.itemReleaseUse?.subscribe((event) => {
  if (event.itemStack?.typeId === FIRE_WAND_TYPE) {
    system.run(() => releaseFireWand(event));
  } else if (event.itemStack?.typeId === ICE_WAND_TYPE) {
    system.run(() => releaseIceWand(event));
  }
});

world.afterEvents.itemStopUse?.subscribe((event) => {
  if (event.itemStack?.typeId === FIRE_WAND_TYPE) {
    system.run(() => releaseFireWand(event));
  } else if (event.itemStack?.typeId === ICE_WAND_TYPE) {
    system.run(() => releaseIceWand(event));
  }
});

world.afterEvents.entityHitBlock?.subscribe((event) => {
  system.run(() => {
    const entity = event.damagingEntity ?? event.entity ?? event.source;
    flickHeldFireWand(entity);
    flickHeldIceWand(entity);
  });
});

world.afterEvents.entityHitEntity?.subscribe((event) => {
  system.run(() => {
    const entity = event.damagingEntity ?? event.entity ?? event.source;
    flickHeldFireWand(entity);
    flickHeldIceWand(entity);
  });
});

system.runInterval(updateFireWandChargeFeedback, FIRE_CHARGE_FEEDBACK_INTERVAL_TICKS);
system.runInterval(updateIceWandChargeFeedback, ICE_CHARGE_FEEDBACK_INTERVAL_TICKS);

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
  stopFireWandCharge(player);

  if (heldTicks < FIRE_DESTRUCTIVE_MIN_CHARGE_TICKS) {
    fireBlast(player);
    return;
  }

  if (!tryUseCooldown(player, fireBlastCooldowns, FIRE_DESTRUCTIVE_COOLDOWN_TICKS)) return;

  const charge = getFireWandCharge(heldTicks);
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

  spawnFireWandFlick(player, breaksBlocks);
  playFireWandReleaseSound(player, breaksBlocks);
  spawnFireBlastTrail(player.dimension, origin, direction, distanceBetween(origin, impact));
  detonateFireBlast(player, impact, breaksBlocks, radius);
}

function startFireWandCharge(player) {
  if (!isEntityUsable(player)) return;

  const cooldownKey = getCooldownKey(player);
  fireWandChargeStarts.set(cooldownKey, system.currentTick ?? 0);
  fireWandFullChargeNotified.delete(cooldownKey);
  playSound(player, "fire.ignite", 0.25, 1.4);
}

function stopFireWandCharge(player) {
  const cooldownKey = getCooldownKey(player);
  fireWandChargeStarts.delete(cooldownKey);
  fireWandFullChargeNotified.delete(cooldownKey);
}

function updateFireWandChargeFeedback() {
  const currentTick = system.currentTick ?? 0;

  for (const player of world.getPlayers()) {
    if (!isEntityUsable(player)) continue;

    const cooldownKey = getCooldownKey(player);
    const startTick = fireWandChargeStarts.get(cooldownKey);
    if (typeof startTick !== "number") continue;

    if (!isHoldingItem(player, FIRE_WAND_TYPE)) {
      stopFireWandCharge(player);
      continue;
    }

    const heldTicks = Math.max(0, currentTick - startTick);
    const charge = getFireWandCharge(heldTicks);
    spawnFireWandChargeParticles(player, charge);

    if (heldTicks >= FIRE_DESTRUCTIVE_MIN_CHARGE_TICKS && currentTick % 12 === 0) {
      playSound(player, "random.fizz", 0.12 + charge * 0.18, 0.8 + charge * 0.8);
    }

    if (charge >= 1 && !fireWandFullChargeNotified.has(cooldownKey)) {
      fireWandFullChargeNotified.add(cooldownKey);
      spawnFireWandFullChargeBurst(player);
      playSound(player, "random.orb", 0.55, 1.6);
    }
  }
}

function getFireWandCharge(heldTicks) {
  return Math.min(
    1,
    Math.max(
      0,
      (heldTicks - FIRE_DESTRUCTIVE_MIN_CHARGE_TICKS) /
        (FIRE_DESTRUCTIVE_MAX_CHARGE_TICKS - FIRE_DESTRUCTIVE_MIN_CHARGE_TICKS),
    ),
  );
}

function spawnFireWandChargeParticles(player, charge) {
  const location = getWandTipLocation(player);
  const count = 1 + Math.floor(charge * 3);

  for (let i = 0; i < count; i++) {
    const offset = (i - count / 2) * 0.06;
    spawnParticle(player.dimension, "minecraft:basic_flame_particle", {
      x: location.x + offset,
      y: location.y + Math.random() * 0.12,
      z: location.z - offset,
    });
  }

  if (charge >= 0.7) {
    spawnParticle(player.dimension, "minecraft:lava_particle", location);
  }
}

function spawnFireWandFullChargeBurst(player) {
  const location = getWandTipLocation(player);

  for (let i = 0; i < 8; i++) {
    spawnParticle(player.dimension, "minecraft:basic_flame_particle", {
      x: location.x + (Math.random() - 0.5) * 0.6,
      y: location.y + Math.random() * 0.5,
      z: location.z + (Math.random() - 0.5) * 0.6,
    });
  }
}

function spawnFireWandFlick(player, isCharged) {
  const direction = normalizeVector(getViewDirection(player));
  const origin = getWandTipLocation(player);
  const particleCount = isCharged ? 10 : 5;

  for (let i = 0; i < particleCount; i++) {
    const distance = 0.25 + i * 0.18;
    const location = addVector(origin, multiplyVector(direction, distance));
    spawnParticle(player.dimension, "minecraft:basic_flame_particle", location);
  }

  if (isCharged) {
    spawnParticle(player.dimension, "minecraft:large_explosion", addVector(origin, multiplyVector(direction, 1.2)));
  }
}

function flickHeldFireWand(entity) {
  if (!isEntityUsable(entity) || !isHoldingItem(entity, FIRE_WAND_TYPE)) return;

  spawnFireWandFlick(entity, false);
  playSound(entity, "fire.ignite", 0.2, 1.8);
}

function playFireWandReleaseSound(player, isCharged) {
  if (isCharged) {
    playSound(player, "random.explode", 0.45, 1.4);
    return;
  }

  playSound(player, "fire.ignite", 0.35, 1.7);
}

function freezeTarget(player, charge = 0) {
  if (!isEntityUsable(player)) return;

  if (!tryUseCooldown(player, iceWandCooldowns, ICE_FREEZE_COOLDOWN_TICKS)) return;

  const direction = normalizeVector(getViewDirection(player));
  const origin = getEyeLocation(player);
  const target = findIceWandTarget(player, origin, direction);
  const impact = target?.location ?? addVector(origin, multiplyVector(direction, ICE_FREEZE_RANGE));
  const range = Math.min(ICE_FREEZE_RANGE, distanceBetween(origin, impact));

  spawnIceWandFlick(player, charge >= 1);
  playIceWandReleaseSound(player, Boolean(target?.entity), charge);
  spawnIceTrail(player.dimension, origin, direction, range);

  if (target?.entity) {
    freezeEntity(player, target.entity, charge);
  }

  const waterRadius = ICE_FREEZE_WATER_RADIUS + Math.floor(charge * 2);
  freezeWaterNear(player.dimension, impact, waterRadius);
  spawnIceImpactParticles(player.dimension, impact, charge);
}

function releaseIceWand(event) {
  const player = event.source;
  if (!isEntityUsable(player)) return;

  const cooldownKey = getCooldownKey(player);
  const currentTick = system.currentTick ?? 0;
  if (iceWandReleaseTicks.get(cooldownKey) === currentTick) return;
  iceWandReleaseTicks.set(cooldownKey, currentTick);

  const heldTicks = getIceWandHeldTicks(event);
  stopIceWandCharge(player);
  freezeTarget(player, getIceWandCharge(heldTicks));
}

function getIceWandHeldTicks(event) {
  const player = event.source;
  const currentTick = system.currentTick ?? 0;
  const startTick = iceWandChargeStarts.get(getCooldownKey(player));
  if (typeof startTick === "number") return Math.max(0, currentTick - startTick);
  if (typeof event.useDuration === "number") return event.useDuration;
  return 0;
}

function startIceWandCharge(player) {
  if (!isEntityUsable(player)) return;

  const cooldownKey = getCooldownKey(player);
  iceWandChargeStarts.set(cooldownKey, system.currentTick ?? 0);
  iceWandFullChargeNotified.delete(cooldownKey);
  playSound(player, "random.glass", 0.25, 1.6);
}

function stopIceWandCharge(player) {
  const cooldownKey = getCooldownKey(player);
  iceWandChargeStarts.delete(cooldownKey);
  iceWandFullChargeNotified.delete(cooldownKey);
}

function updateIceWandChargeFeedback() {
  const currentTick = system.currentTick ?? 0;

  for (const player of world.getPlayers()) {
    if (!isEntityUsable(player)) continue;

    const cooldownKey = getCooldownKey(player);
    const startTick = iceWandChargeStarts.get(cooldownKey);
    if (typeof startTick !== "number") continue;

    if (!isHoldingItem(player, ICE_WAND_TYPE)) {
      stopIceWandCharge(player);
      continue;
    }

    const heldTicks = Math.max(0, currentTick - startTick);
    const charge = getIceWandCharge(heldTicks);
    spawnIceWandChargeParticles(player, charge);

    if (heldTicks >= ICE_FREEZE_MIN_CHARGE_TICKS && currentTick % 12 === 0) {
      playSound(player, "random.glass", 0.08 + charge * 0.12, 1.2 + charge * 0.5);
    }

    if (charge >= 1 && !iceWandFullChargeNotified.has(cooldownKey)) {
      iceWandFullChargeNotified.add(cooldownKey);
      spawnIceWandFullChargeBurst(player);
      playSound(player, "random.orb", 0.45, 1.9);
    }
  }
}

function getIceWandCharge(heldTicks) {
  return Math.min(
    1,
    Math.max(
      0,
      (heldTicks - ICE_FREEZE_MIN_CHARGE_TICKS) /
        (ICE_FREEZE_MAX_CHARGE_TICKS - ICE_FREEZE_MIN_CHARGE_TICKS),
    ),
  );
}

function findIceWandTarget(player, origin, direction) {
  const entityTarget = findTargetedFreezableEntity(player, origin, direction);
  let previousLocation = origin;

  for (let distance = ICE_FREEZE_STEP; distance <= ICE_FREEZE_RANGE; distance += ICE_FREEZE_STEP) {
    const location = addVector(origin, multiplyVector(direction, distance));

    if (entityTarget && entityTarget.projection <= distance) {
      return { entity: entityTarget.entity, location: entityTarget.location };
    }

    const block = getBlockAtLocation(player.dimension, location);
    if (block && !block.isAir) {
      if (isWaterBlock(block)) return { block, location };
      if (!block.isLiquid) return { block, location: previousLocation };
    }

    previousLocation = location;
  }

  if (entityTarget) return { entity: entityTarget.entity, location: entityTarget.location };
  return undefined;
}

function findTargetedFreezableEntity(player, origin, direction) {
  const entities = player.dimension.getEntities({
    location: origin,
    maxDistance: ICE_FREEZE_RANGE,
    excludeTypes: ["minecraft:player"],
  });

  let closest;
  let closestProjection = ICE_FREEZE_RANGE + 1;

  for (const entity of entities) {
    if (!isFreezableEntity(player, entity)) continue;

    const targetLocation = getEntityCenter(entity);
    const offset = subtractVector(targetLocation, origin);
    const projection = dotVector(offset, direction);
    if (projection < 0 || projection > ICE_FREEZE_RANGE) continue;

    const closestPoint = addVector(origin, multiplyVector(direction, projection));
    const missDistance = distanceBetween(targetLocation, closestPoint);
    if (missDistance > ICE_FREEZE_TARGET_RADIUS) continue;
    if (!hasClearPath(player.dimension, origin, direction, projection)) continue;

    if (projection < closestProjection) {
      closest = { entity, location: targetLocation, projection };
      closestProjection = projection;
    }
  }

  return closest;
}

function isFreezableEntity(player, entity) {
  if (!isEntityUsable(entity) || entity.id === player.id) return false;
  if (entity.typeId === STORAGE_ENTITY) return false;
  return hasHealth(entity);
}

function freezeEntity(player, entity, charge) {
  const duration = Math.floor(ICE_FREEZE_EFFECT_TICKS + charge * 100);
  const amplifier = charge >= 1 ? 8 : 5;

  try {
    entity.addEffect("slowness", duration, {
      amplifier,
      showParticles: true,
    });
  } catch {
    // Some runtimes or entities may reject effects; water freezing still works.
  }

  try {
    entity.applyDamage(1, {
      damagingEntity: player,
      cause: "freezing",
    });
  } catch {
    // The freeze effect is the primary behavior; damage is only a light cue.
  }
}

function freezeWaterNear(dimension, location, radius) {
  const center = {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };

  for (let x = -radius; x <= radius; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -radius; z <= radius; z++) {
        if (x * x + z * z > radius * radius) continue;

        const block = getBlockAtLocation(dimension, {
          x: center.x + x,
          y: center.y + y,
          z: center.z + z,
        });
        if (!block || !isWaterBlock(block)) continue;

        try {
          block.setType("minecraft:ice");
        } catch {
          // Some dimensions or water states may refuse replacement.
        }
      }
    }
  }
}

function isWaterBlock(block) {
  return block?.typeId === "minecraft:water";
}

function spawnIceWandChargeParticles(player, charge) {
  const location = getWandTipLocation(player);
  const count = 1 + Math.floor(charge * 3);

  for (let i = 0; i < count; i++) {
    const offset = (i - count / 2) * 0.06;
    spawnIceParticle(player.dimension, {
      x: location.x + offset,
      y: location.y + Math.random() * 0.12,
      z: location.z - offset,
    });
  }
}

function spawnIceWandFullChargeBurst(player) {
  const location = getWandTipLocation(player);

  for (let i = 0; i < 10; i++) {
    spawnIceParticle(player.dimension, {
      x: location.x + (Math.random() - 0.5) * 0.6,
      y: location.y + Math.random() * 0.5,
      z: location.z + (Math.random() - 0.5) * 0.6,
    });
  }
}

function spawnIceWandFlick(player, isCharged) {
  const direction = normalizeVector(getViewDirection(player));
  const origin = getWandTipLocation(player);
  const particleCount = isCharged ? 12 : 6;

  for (let i = 0; i < particleCount; i++) {
    const distance = 0.25 + i * 0.18;
    spawnIceParticle(player.dimension, addVector(origin, multiplyVector(direction, distance)));
  }
}

function flickHeldIceWand(entity) {
  if (!isEntityUsable(entity) || !isHoldingItem(entity, ICE_WAND_TYPE)) return;

  spawnIceWandFlick(entity, false);
  playSound(entity, "random.glass", 0.18, 1.7);
}

function spawnIceTrail(dimension, origin, direction, range) {
  for (let distance = 1; distance <= range; distance += 1.5) {
    spawnIceParticle(dimension, addVector(origin, multiplyVector(direction, distance)));
  }
}

function spawnIceImpactParticles(dimension, location, charge) {
  const count = 8 + Math.floor(charge * 8);

  for (let i = 0; i < count; i++) {
    spawnIceParticle(dimension, {
      x: location.x + (Math.random() - 0.5) * 0.8,
      y: location.y + Math.random() * 0.8,
      z: location.z + (Math.random() - 0.5) * 0.8,
    });
  }
}

function spawnIceParticle(dimension, location) {
  return spawnFirstAvailableParticle(dimension, [
    "minecraft:blue_flame_particle",
    "minecraft:snowflake_particle",
    "minecraft:basic_crit_particle",
  ], location);
}

function playIceWandReleaseSound(player, hitEntity, charge) {
  if (hitEntity) {
    playSound(player, "random.glass", 0.45 + charge * 0.15, 1.4);
    return;
  }

  playSound(player, "random.fizz", 0.28 + charge * 0.18, 1.8);
}

function getWandTipLocation(player) {
  const direction = normalizeVector(getViewDirection(player));
  const eye = getEyeLocation(player);

  return {
    x: eye.x + direction.x * 0.85,
    y: eye.y - 0.35 + direction.y * 0.35,
    z: eye.z + direction.z * 0.85,
  };
}

function isHoldingItem(player, typeId) {
  const container = getInventory(player);
  if (!container) return false;

  const slot = player.selectedSlotIndex ?? 0;
  const item = container.getItem(slot);
  return item?.typeId === typeId;
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
    spawnParticle(dimension, "minecraft:basic_flame_particle", location);
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
  } catch (error) {
    console.warn(`Failed to restore zombie villager: ${error}`);
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
    if (spawnParticle(dimension, particle, {
      x: location.x,
      y: location.y + 1,
      z: location.z,
    })) {
      return;
    }
  }
}

function toggleStorageContainer(player) {
  if (!isEntityUsable(player)) return;

  const held = getHeldStorageWand(player);
  if (!held) {
    return;
  }

  const storageId = ensureStorageId(player, held.item, held.slot);
  const page = player.isSneaking ? 2 : 1;
  const tag = getPageTag(storageId, page);
  const existingEntity = findStorageEntity(tag);

  if (existingEntity && isStoragePresent(existingEntity, player)) {
    dismissStorageEntity(existingEntity, player);
    return;
  }

  const storageEntity = existingEntity ?? createStorageEntity(player, storageId, page);
  if (!storageEntity) {
    return;
  }

  moveEntityNearPlayer(storageEntity, player);
  storageEntity.addTag(STORAGE_OPEN_TAG);
  storageEntity.removeTag(STORAGE_DISMISSED_TAG);
  storageEntity.nameTag = `Storage Chest Page ${page}`;
  updateStorageWandLore(player, storageId);
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

function spawnParticle(dimension, particle, location) {
  try {
    dimension.spawnParticle(particle, location);
    return true;
  } catch {
    // Visual feedback is optional; wand behavior should continue without it.
    return false;
  }
}

function spawnFirstAvailableParticle(dimension, particles, location) {
  for (const particle of particles) {
    if (spawnParticle(dimension, particle, location)) return true;
  }

  return false;
}

function playSound(player, sound, volume = 0.4, pitch = 1) {
  try {
    player.playSound(sound, { volume, pitch });
    return true;
  } catch {
    try {
      player.dimension.playSound(sound, player.location, { volume, pitch });
      return true;
    } catch {
      // Sound identifiers can vary by runtime; ignore unavailable cues.
      return false;
    }
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
