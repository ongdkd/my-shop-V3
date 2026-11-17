# Faye: art prompts, round 2

Round 1 is done: all 31 sheets in `faye/assets/` are in use and consistent. This round fixes what is still weak and adds what he can't do yet.

## Review of the current animations

**Good:**
- Every sheet matches: standing frames are 70 art pixels tall and 43 wide at the hair, and the feet sit on the same line.
- The outline, pixel size and palette are steady.
- The bag props, wake-up, reading and paper plane read well.

**Weak:**
1. **`carry-motion` draws a giant human hand** that is cut off at the cell edge. On the site his box already follows your finger, so the hand looks odd.
2. **Choppy two-frame loops.** These idles flip between only two drawings: vibe, hum, ponder, peek, snack, photo, ukulele, bubbles, rain, toe tap. They look choppy rather than moving.
3. **He can't walk.** He only teleports, or gets carried.
4. **Nothing about the shop.** He has no actions for a new order, an order shipped, a slip checked or money counted, even though those are what the admin page reacts to.
5. **Few feelings.** He has no sad, dizzy or annoyed pose, and no reaction when you tap him repeatedly.

## Breathing and in-between frames

I measured how many of his art pixels change between frames that play one after the other. He has about 2,200 pixels in total.

| Moment | Pixels changed | Verdict |
|---|---|---|
| Breathing (inhale ↔ exhale, every half second while resting) | 1,416 | **Bad.** The hair, face, hoodie and shoes are all redrawn, so he shimmers ("boils") instead of breathing. A breath should change about 50–150 pixels. |
| Rest → talking (first mouth frame) | 1,482 | **Bad.** His whole body swaps to another drawing the moment he speaks. |
| Talking (closed ↔ half ↔ wide) | 10–14 | **Good.** Only the mouth moves. |
| Blink | 77 | **Good.** |
| Eye rub in the wake-up | 328 | **Good.** |
| Rest → start of an activity (e.g. exhale → vibe) | 1,000–1,650 | **Hard cut.** He jumps straight into the new pose. |
| Sit ↔ stand (anticipate, hop, land, settle) | 1,570–1,780 each | **Fine.** These are big moves, so a redraw is expected. |
| Bag swap frames | 500–1,300 | **Fine.** |
| Wake-up: rise → settle | 1,881 | **Too big a jump** for one step. |

**Breathing and the talk pop are fixed, and are not art problems.** ChatGPT redraws the whole picture every time, so it can never make two frames that differ by one pixel. So `idle-breath.png` is now built from **one** drawing, his talking face (`talk`, frame 1):
- **Exhale:** that drawing as it is.
- **Inhale:** everything above the hoodie hem moved up one art pixel.
- **Weight shift:** the upper body moved one pixel sideways.
- **Toe tap:** one shoe lifted one pixel.

Resting and talking share the same body, so there's no pop and no shimmer. One breath takes 3.2 s (1.6 s in, 1.6 s out). Don't ask ChatGPT for breathing. If the `talk` sheet is ever redrawn, ask Claude to rebuild `idle-breath.png` from it.

**In-betweens for big moves are worth asking for**, using the template below with the two frames attached.

### In-between template

Attach **three** images: the reference, plus the two frames to bridge, which I'll export for you as `faye/ref/from.png` and `faye/ref/to.png`. Paste the style block, then:

```text
IN-BETWEEN FRAMES. Attached: FROM (first frame) and TO (last frame), plus the character reference.
Draw the frames that go BETWEEN them, so FROM → [your frames] → TO plays as one smooth movement.
- Frame 1 = FROM, copied exactly (do not change it).
- Frames 2 and 3 = the in-betweens: frame 2 is about one third of the way from FROM to TO, frame 3 about two thirds.
- Frame 4 = TO, copied exactly (do not change it).
- In frames 2 and 3, the hair shape, ahoge, face, sunglasses and outfit details are copied from FROM; only the parts that actually move (arms, legs, head angle, body height) change.
- The head stays exactly the same size in all four frames.
```

Bridges worth doing first:
1. **Wake-up:** `wakeRise` → `standSettle`, the biggest jump he has.
2. **Rest → vibe:** `exhale` → `vibeLeft`. He starts vibing often.
3. **Rest → humming:** `exhale` → `humOpen`.
4. **Rest → ponder:** `exhale` → `ponderLeft`. He starts thinking every time the page loads.

---

## How to use this with ChatGPT

1. Start a **new chat** for each sheet, so earlier images don't drift him.
2. Attach **`faye/ref/faye-reference-2x.png`**, the four poses he already has. It is the only reference.
3. Paste the **style block**, then **one sheet prompt** under it. One sheet per image.
4. Check the result with the **checklist** at the bottom. If it fails, paste the **redo message**.
5. Save it as `faye/new/<sheet-name>.png` and tell Claude. I cut the background, snap it to his pixel grid and palette, size it to match by head width, put the feet on the line, and wire it into `faye/faye.js`. Small size or colour drift is fine; **proportion and pose drift is not**, because I can't fix that.

---

### Style block (paste first, every time, unchanged)

```text
STRICT CHARACTER SHEET. Follow every rule exactly. Do not reinterpret, restyle or "improve" anything.

REFERENCE: The attached image shows the character "Faye" in four poses. Copy him exactly: same proportions, same pixel size, same outline, same colors, same outfit. Only the pose and expression may change.

CHARACTER: Faye, a chibi pixel-art boy. Huge messy orange-peach hair with spiky tufts and ONE tall curled ahoge on top. Round black sunglasses pushed up on his hair (never over his eyes). Cyan eyes, pink cheek blush, tiny orange earrings. Cream zip-up hoodie with pink sleeves and two small blue slash marks on the chest. Brown pants. White sneakers with one blue stripe each. A thin brown strap across his chest to a small cream bag at his left hip with a pink bunny face.

PROPORTIONS (measure against the reference; these are hard limits):
- Head including hair and ahoge = 61% of his standing height. The ahoge alone = about 19%.
- Hair width = 60% of his standing height (the hair is wider than the body).
- Collar to shoe soles = only 39% of his height. Torso width = about one third of his height.
- Short stubby arms: relaxed hands reach the hoodie hem, never lower.
- Short legs, chunky shoes. No neck visible.
- Seated or crouching poses keep the exact same head size; only the body gets shorter.
- Never: smaller head, longer legs, longer arms, slimmer body, realistic anatomy, older look.

PIXEL ART RULES: True low-resolution pixel art. The standing character is exactly 72 pixel-blocks tall. Every pixel is a hard square block of the same size as in the reference. Clean 1-block dark-brown outline (#34140C) around everything. Flat colors, 2-3 tones per material, no anti-aliasing, no gradients, no blur, no soft shading, no glow, no drop shadow, no texture noise. Use only these colors plus close shades: outline #34140C, hair #FC9C64 / #CC5C3C / #AC3C2C, skin #FCD4C4, blush #FC8C8C, hoodie #FCECD4 / #FCF4EC, sleeves #FC8C8C / #AC3C2C, pants #D49C74 / #AC846C, glasses #1C1C24, blue accents #1C54B4, eyes cyan.

LAYOUT:
- One image, a 2x2 grid of four equal cells, no visible grid lines, no borders.
- One pose per cell, centered horizontally, with clear empty space on every side.
- Nothing may touch or cross into another cell.
- The character is the SAME size in all four cells: a standing pose fills about 80% of the cell height.
- Every cell has the same floor line: the shoe soles touch the same height in every cell, except where a frame says he is jumping or lifted.
- Background: one flat solid color, pure green #00FF00, everywhere, with no floor, shadow, scenery or vignette.
- No text, letters, numbers, speech bubbles, arrows, motion lines or watermarks, unless a frame below asks for a small effect.
- Order: frame 1 top-left, frame 2 top-right, frame 3 bottom-left, frame 4 bottom-right.

Draw this sheet:
```

### Redo message (when something drifts)

```text
Redo the whole sheet. Problems: [say what, e.g. "head too small in frame 3", "legs too long", "sunglasses over his eyes", "props cross into the next cell"]. Match the attached reference exactly: head with hair = 61% of his height, hair wider than his body, short stubby arms and legs, same pixel-block size, 1-block dark outline, flat green #00FF00 background, all four frames the same size with feet on the same floor line.
```

---

## Priority 1: fix what's on screen most

### Sheet `carry`: replaces `carry-motion` (no hand)
Used when you drag him across the page.
```text
Four frames. No hand, no arm, no rope, nothing holding him: he hangs in the air on his own, as if lifted by the back of his hoodie collar (the collar is pulled up slightly behind his head).
1) Just picked up: body straight, legs together and dangling, arms stuck out to the sides, surprised face with a small "o" mouth, ahoge straight up.
2) Swinging: whole body tilted about 15 degrees with his feet toward the viewer's LEFT, arms limp, grumpy pout, eyes half closed.
3) Swinging back: whole body tilted about 15 degrees with his feet toward the viewer's RIGHT, legs kicking a little, eyes shut.
4) Landing: standing on the floor line, knees deeply bent, arms out for balance, two tiny dust puffs at his feet.
In frames 1-3 his shoe soles are about 6% of the cell height ABOVE the floor line.
```

### Sheet `music-2`: in-betweens for vibe and hum
```text
Four frames, all wearing blue over-ear headphones exactly like a small blue band over his hair:
1) Vibing, centered between left and right: head upright, eyes closed, fists at chest height, both knees slightly bent.
2) Vibing, head bobbing DOWN on the beat: chin lowered, shoulders up, open-mouth smile.
3) Humming, swaying toward the viewer's LEFT: eyes closed, small "o" mouth, one finger raised.
4) Humming, swaying toward the viewer's RIGHT: eyes closed, gentle closed-mouth smile, the other hand raised.
```

### Sheet `think-2`: in-betweens for pondering
```text
Four frames:
1) Pondering, eyes looking straight UP, hand on chin, mouth pushed to one side.
2) Pondering, eyes looking LEFT, finger tapping his chin, one eyebrow raised.
3) Pondering, eyes looking RIGHT, arms crossed, small frown.
4) "Hmm", eyes closed, head tilted, both hands behind his head.
```

### Sheet `look-2`: in-betweens for peek and stargaze
```text
Four frames:
1) Looking straight ahead, curious, leaning forward slightly, hands on his knees.
2) Peeking to the viewer's LEFT, one hand shading his eyes, standing on one foot.
3) Peeking to the viewer's RIGHT, one hand shading his eyes, standing on the other foot.
4) Looking up at the sky with wide sparkling eyes, mouth open in wonder, hands clasped at his chest.
```

---

## Priority 2: new things he can do

### Sheet `walk`: walking (he'll stroll along the bottom of the screen)
Draw only the leftward walk. I mirror it in code for walking right.
```text
Four frames of a walk cycle. He faces the viewer's LEFT in a three-quarter view: we see his face and the front of his hoodie, turned partly to the left. The head stays the same size and shape in all four; only the legs, arms and a small body bob change.
1) Contact: left foot forward with the heel down, right foot back on its toe, arms swinging opposite to the legs, body at normal height.
2) Passing: feet together under the body, one knee lifted a little, body 1 block HIGHER, ahoge bouncing back.
3) Contact: right foot forward with the heel down, left foot back, arms swapped.
4) Passing: feet together, the other knee lifted, body 1 block HIGHER.
Relaxed happy face, small smile, eyes open.
```

### Sheet `shop-order`: new order and order shipped
```text
Four frames:
1) New order: holding a small phone up with both hands, looking at it with an excited open-mouth smile, one sparkle above the phone.
2) Holding a cardboard parcel box (tan with a darker tan tape stripe) in both arms in front of his chest, proud smile.
3) Taping the parcel box shut on the floor in front of him, kneeling on one knee, tongue out in concentration.
4) Parcel under one arm, other hand giving a thumbs-up, wink.
The phone and the box are small, in proportion to his short arms.
```

### Sheet `shop-money`: slip checked and sales
```text
Four frames:
1) Holding up a small white bank slip (a plain paper rectangle with a tiny pink check mark) with both hands at face height, happy eyes ^^.
2) Examining the slip with his face close to it, eyes squinting, serious.
3) Counting money: fanning a small stack of green and blue bank notes in one hand, licking the thumb of the other hand.
4) Hugging a small pink piggy bank, eyes closed, big blush, content smile.
```

### Sheet `moods`: when something goes wrong
```text
Four frames:
1) Sad: shoulders drooping, head down, ahoge drooping forward, eyes teary with wobbly mouth, hands holding the bag strap.
2) Dizzy: spiral eyes, wobbly open mouth, head tilted, arms loose, the ahoge bent.
3) Annoyed pout: puffed cheeks, eyebrows down, arms crossed, looking to the side.
4) Relieved: hand wiping his forehead, eyes closed, big exhale smile.
```

### Sheet `poke`: when you tap him a few times
```text
Four frames:
1) Poked: flinching to the side, one eye shut, mouth "eep!", hands up.
2) Ticklish giggle: hunched, arms hugging himself, eyes ^^, laughing.
3) Covering his face with both hands, peeking between his fingers, blush.
4) Peace sign: one hand making a V sign beside his face, wink, tongue out.
```

---

## Suggested order

1. `carry`: fixes the only drawing that looks wrong today.
2. `walk`: the biggest new feeling of life.
3. `shop-order`, `shop-money`: these tie him to what the shop is doing.
4. `moods`, `poke`: personality.
5. `music-2`, `think-2`, `look-2`: smoother idles.

## Checklist before you save a sheet

Put it next to `faye/ref/faye-reference-2x.png` and check:

- [ ] **Head:** the head with hair is clearly more than half his height, and as wide as or wider than the reference.
- [ ] **Limbs:** arms and legs are as short as the reference, and the hands don't hang below the hoodie hem.
- [ ] **Pixels:** the pixel blocks are big and square like the reference, not small or smooth. The dark outline goes around everything.
- [ ] **Face and outfit:** the sunglasses sit on his hair, not his eyes. He has the bag and strap, the pink sleeves, and white shoes with a blue stripe.
- [ ] **Frames:** all four frames are the same size, the feet are on one line (except jumps or lifts), and nothing crosses into the next cell.
- [ ] **Background:** flat green, with no shadows, scenery or text.
