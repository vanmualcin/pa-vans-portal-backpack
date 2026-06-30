# Pa Van's Wand Collection

This Bedrock add-on adds craftable magic wands with utility and combat effects.

## How to use

1. Import `PaVansWandCollection_1.0.4.mcaddon` from the GitHub release into Minecraft Bedrock.
2. Activate both the behavior pack and resource pack on your world.
3. Turn on Beta APIs / scripting experiments if your Minecraft version asks for them.
4. Craft the wands at a crafting table, or run:

   ```mcfunction
   /give @s pv:storage_wand
   /give @s pv:fire_wand
   /give @s pv:restoration_wand
   ```

## Wands

### Storage Wand

Use the Storage Wand to summon `Storage Chest Page 1`, then tap the chest to open the familiar inventory-style screen. Use the wand again to dismiss your page 1 chest. Sneak while using the wand to toggle `Storage Chest Page 2`. Each page has 27 slots, for 54 total.

Crafting uses lapis lazuli, redstone, and a stick.

### Fire Blast Wand

Click the Fire Blast Wand to launch the current Ghast-like blast in the direction you are looking. Hold use, like drawing a bow, then release to launch a destructive blast that breaks blocks with a larger radius at full charge.

Crafting uses a ghast tear, blaze powder, and a stick.

### Restoration Wand

Use the Restoration Wand while aiming at a zombie villager within 8 blocks to instantly cure it into a villager.

Crafting uses a golden apple, fermented spider eye, and a stick.

## Notes

- Each summoned storage chest is a real 27-slot entity container.
- The Storage Wand moves your matching storage chest out of sight instead of destroying it, so the stored items are not intentionally deleted.
- Dismissing only affects the chest tied to your wand and selected page.
- The Fire Blast Wand's click blast damages non-player entities without intentionally breaking blocks. Its charged blast is destructive.
- The Restoration Wand needs a clear line of sight to the zombie villager.
