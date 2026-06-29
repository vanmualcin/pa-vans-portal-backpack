# Pa Van's Portal Backpack

This Bedrock add-on adds a portal wand that toggles chest-like storage containers.

## How to use

1. Import `PaVansPortalBackpack_1.0.1.mcaddon` from the GitHub release into Minecraft Bedrock.
2. Activate both the behavior pack and resource pack on your world.
3. Turn on Beta APIs / scripting experiments if your Minecraft version asks for them.
4. Craft the Portal Wand at a crafting table, or run:

   ```mcfunction
   /give @s bp:wand
   ```

Use the Portal Wand to summon `Storage Chest Page 1`, then tap the chest to open the familiar inventory-style screen. Use the wand again to dismiss your page 1 chest. Sneak while using the wand to toggle `Storage Chest Page 2`. Each page has 27 slots, for 54 total.

Crafting uses only lapis lazuli, redstone, and sticks.

## Notes

- Each summoned storage chest is a real 27-slot entity container.
- The Portal Wand moves your matching storage chest out of sight instead of destroying it, so the stored items are not intentionally deleted.
- Dismissing only affects the chest tied to your wand and selected page.
