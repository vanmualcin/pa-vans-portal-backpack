# Pa Van's Portal Backpack

This Bedrock add-on adds portal wands that summon chest-like storage containers.

## How to use

1. Import `dist/PaVansPortalBackpack_1.0.0.mcaddon` into Minecraft Bedrock.
2. Activate both the behavior pack and resource pack on your world.
3. Turn on Beta APIs / scripting experiments if your Minecraft version asks for them.
4. Craft the wands at a crafting table, or run:

   ```mcfunction
   /give @s bp:wand
   /give @s bp:dismiss
   ```

Use the storage wand to summon `Storage Chest Page 1`, then tap the chest to open the familiar inventory-style screen. Sneak while using the wand to summon `Storage Chest Page 2`. Each page has 27 slots, for 54 total.

Use the dismiss wand to move both storage chest pages out of sight. It shares the same wand ID, so keep the matching pair together.

Crafting uses only lapis lazuli, redstone, and sticks.

## Notes

- Each summoned storage chest is a real 27-slot entity container.
- The dismiss wand moves nearby storage chests out of sight instead of destroying them, so the stored items are not intentionally deleted.
- Use the storage wand again to bring a page back in front of you.
