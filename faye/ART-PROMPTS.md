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

---

# Round 3: food, drinks and more variations

Use the same workflow as above: a new chat per sheet, attach `faye/ref/faye-reference-2x.png`, paste the **style block**, then the **line-art lock** below, then **one** sheet prompt. Save the result as `faye/new/<sheet-name>.png`.

Food and drink sheets are where ChatGPT drifts most. It shrinks the head to make room for a big bowl, lengthens the arms to reach the mouth, and redraws the hair in a new style. The lock below forbids all three.

### Line-art lock (paste right after the style block, every time, unchanged)

```text
LINE-ART LOCK. These rules come before anything in the frame descriptions. If a pose conflicts with them, change the pose, never the character.

1. THE HEAD IS COPIED, NOT REDRAWN. Copy the head (hair, ahoge, sunglasses, face shape, earrings) from reference frame 1 (top-left) pixel-block for pixel-block: the same hair outline, the same number and positions of spiky tufts on each side, the same curl direction of the ahoge (it curls to the viewer's RIGHT), and the same width and height. Only these may change inside the head: the eyes, eyebrows, mouth and blush. The head may tilt or turn only if a frame asks for it, and then it keeps the same size and silhouette.
2. ONE OUTLINE. Every outline, including lines between overlapping parts (arm over the body, hand over a prop), is exactly 1 pixel-block thick and dark brown #34140C. No 2-block lines, no thin lines, no colored lines, no missing outline segments, no sketchy or broken lines.
3. SAME PIXEL GRID. Every frame uses the same block size as the reference. Standing he is 72 blocks tall; seated he keeps the same head size and is shorter only in the body. Never mix big and small blocks in one image.
4. SHORT ARMS ONLY. Shoulder to fingertips is no longer than his torso (collar to hoodie hem). He reaches his mouth by bending his elbow and bringing the hand up to the chin, like the reference poses. Never stretch an arm to reach something. If food is far away, he leans in or lifts it; his arms do not grow.
5. SAME FACE. Eyes are the same size, shape and cyan color as the reference in every open-eyed frame. Closed eyes are short curved lines in the same place. The mouth stays small; even "wide open" or "chewing" mouths fit between the cheeks.
6. OUTFIT LOCK. Cream hoodie with pink sleeves and the two blue chest marks, the brown strap across his chest, the cream bunny bag at his left hip, brown pants, white sneakers with one blue stripe. Never remove, recolor or move any of these, even when a prop covers part of them.
7. PROPS ARE SMALL AND SIMPLE. Props use the same pixel-block size, the same 1-block #34140C outline and flat 2-3 tone colors as he does. A prop held in his hands is never wider than his torso, and never covers his face except where the frame asks for it. No brand names, logos, readable text or labels on any prop.
8. CONSISTENT PROP. Within one sheet, the prop has the same size, shape and colors in every frame (only how full or bitten it is may change).

Before finishing, compare each of the four frames with reference frame 1 side by side: if the hair outline, head size, arm length or outline thickness differs, redraw that frame.
```

### Redo message for line-art drift

```text
Redo the whole sheet. Problems: [say what, e.g. "hair redrawn with different spikes in frame 2", "outline thicker in frame 4", "arm too long reaching the mouth in frame 3", "bowl is wider than his body", "head smaller than the reference"]. Follow the LINE-ART LOCK exactly: copy the head from reference frame 1 block for block, 1-block #34140C outline everywhere, same block size, short arms that bend to reach the mouth, props never wider than his torso.
```

## Eating

Each sheet is one food with a full little loop: look, bite, chew, happy reaction. In code each plays as its own idle, and the prop comes out of his bag first, like the others.

### Sheet `eat-ramen`: ramen
```text
Four frames, sitting cross-legged on the floor exactly like reference frame 4, holding a small round ramen bowl (white bowl with a red rim band, no steam) in one hand at chest height and chopsticks in the other. The bowl is no wider than his torso. Inside: pale yellow noodles, one round pink-and-white fish cake slice, one half egg (white with an orange yolk), a small green onion sprinkle.
1) Looking down into the bowl, excited sparkle eyes, mouth open "ooh".
2) Lifting a few noodles with the chopsticks up to his mouth, slurping: lips pursed in a small "o", eyes closed, noodles hanging from the chopsticks to the bowl.
3) Chewing with cheeks puffed, eyes ^^ happy arcs, chopsticks resting on the bowl rim.
4) Tipping the bowl toward his mouth with both hands to drink the soup, eyes closed, the bowl hiding only his mouth and chin (not his eyes).
```

### Sheet `eat-rice`: bowl of rice
```text
Four frames, standing, holding a small rice bowl (light blue bowl with a white rim, white rice in a neat mound with one red pickled plum on top) in one hand at chest height and chopsticks in the other. The bowl is no wider than his torso.
1) Holding the bowl up proudly, eyes closed, big smile.
2) Bringing a small clump of rice to his mouth with the chopsticks, mouth open.
3) Chewing with puffed cheeks, eyes ^^, one grain of rice on his cheek.
4) Bowl now empty (only a few grains), holding it out toward the viewer, satisfied grin, tiny blush.
```

### Sheet `eat-onigiri`: rice ball
```text
Four frames, standing, holding one onigiri (white rice triangle with a dark green seaweed strip wrapped around the bottom) in both hands. The onigiri is about the size of both his fists together.
1) Holding the onigiri up at face height, admiring it with sparkle eyes.
2) Taking a big bite of the top corner, eyes closed, cheeks puffed.
3) Chewing, eyes ^^, the onigiri now with a bite missing from the top corner (the bite shape stays the same in frames 3 and 4).
4) Looking at the bitten onigiri, surprised happy face with a small "o" mouth; a little pink filling shows where he bit.
```

### Sheet `eat-sticks`: chocolate biscuit sticks
```text
Four frames, standing, holding a small slim red snack box (plain, no text or logo) in one hand and thin biscuit sticks (pale biscuit handle, chocolate-coated top half) with the other. Each stick is about as long as his forearm.
1) Pulling one stick out of the box, curious face.
2) "Cool" pose: one stick held between his lips pointing slightly up, smug half-closed eyes, the other hand on his hip, sunglasses still on his hair.
3) Crunching: the stick now half as long, cheeks puffed, eyes ^^.
4) Offering a stick toward the viewer with a bent (still short) arm, wink, open-mouth grin.
```

### Sheet `eat-sweets`: taiyaki and ice cream (optional extra)
```text
Four frames, standing:
1) Holding a fish-shaped taiyaki (golden brown, fish tail and fin pattern, simple outline) in both hands, eyes sparkling.
2) Biting the taiyaki's head, eyes closed, cheeks puffed; a bite missing from the head end.
3) Holding a small ice cream cone (tan cone, one pink scoop) in one hand, licking it with his tongue out, eyes closed.
4) The ice cream melting a little (one small drip down the cone), panicked happy face, licking the drip.
```

## Drinking

### Sheet `drink-cola`: soda can
```text
Four frames, standing, holding one small red soda can with a plain white stripe around the middle (no logo or text). The can is about as tall as his hand plus one third.
1) Opening the can: one finger on the tab, the can held away from his body, a tiny burst of three white fizz dots at the top, eyes wide.
2) Drinking: can tilted up to his mouth, head tilted back slightly, eyes closed.
3) After the gulp: can lowered to chest height, eyes squeezed shut, mouth wide in a satisfied "ahh", one small bubble near his mouth.
4) Small burp: hand over his mouth, embarrassed blush, eyes looking to the side, one tiny bubble above his head.
```

### Sheet `drink-boba`: bubble tea
```text
Four frames, standing, holding a clear plastic cup of milk tea (light brown tea, dark brown tapioca pearls at the bottom, a flat lid, one thick pink straw). The cup is about the size of both his fists together.
1) Holding the cup up at face height with both hands, sparkle eyes, mouth open in delight.
2) Sipping through the straw, cheeks pulled in, eyes closed.
3) Chewing a pearl, one cheek puffed, eyes ^^.
4) Shaking the cup next to his ear, listening to the pearls, curious face, the pearls shifted to one side.
```

### Sheet `drink-milk`: strawberry milk and ramune (two drinks, two frames each)
```text
Four frames, standing:
1) Holding a small pink milk carton (gable-top shape, plain, no text) with a straw, sipping, eyes closed, little blush.
2) Same carton, squeezing it so the sides dent in to finish the last drop, eyes squeezed, cheeks pulled in.
3) Holding a small light-blue glass soda bottle with a pinched neck and a clear marble in it, pressing the marble down with his thumb, eyes wide, three white fizz dots at the top.
4) Drinking from that bottle, head tilted back slightly, eyes closed, the marble visible in the neck.
```

## Variations of existing animations

These give the idle cycle more than one way to do each thing, so he doesn't repeat the same loop every time. They are new poses, separate from the round-2 in-betweens (`music-2`, `think-2`).

### Sheet `think-3`: different ways of thinking
```text
Four frames, standing:
1) Counting on his fingers: one hand raised showing three fingers, the other hand touching them, eyes looking up, lips moving.
2) Hand on his temple, eyes closed tight, eyebrows scrunched, concentrating hard.
3) Tapping a pencil against his chin, eyes looking to the viewer's LEFT, small sideways mouth.
4) Arms folded, head tilted, one eye closed, one eyebrow raised, skeptical "hmm" mouth.
```

### Sheet `vibe-2`: dancing to music
```text
Four frames, all wearing blue over-ear headphones (a small blue band over the top of his hair, ear cups at the sides of his head, the sunglasses still on his hair):
1) Side step: stepping to the viewer's LEFT, arms swinging, eyes closed, smile.
2) Side step: stepping to the viewer's RIGHT, arms swinging the other way, open-mouth smile.
3) Air guitar: knees bent, one hand "strumming" at his hip, the other hand up at chest height on an invisible guitar neck, eyes shut, mouth open singing.
4) Finger point: one finger pointing up beside his head (short arm, hand no higher than the top of his hair), hip popped to the side, wink.
```

### Sheet `vibe-3`: chill music
```text
Four frames, the same headphones as vibe-2:
1) Swaying gently with his hands in his hoodie pockets, eyes closed, calm smile, head tilted LEFT.
2) Same, head tilted RIGHT.
3) Snapping his fingers at shoulder height, one foot tapping (toe up), eyes half closed.
4) Holding one ear cup with one hand, eyes closed, mouth open singing a high note.
```

### Sheet `idle-fun`: small things he does when bored
```text
Four frames, standing:
1) Spinning his sunglasses on one finger at chest height (the sunglasses are OFF his hair only in this frame; the hair shape stays exactly the same without them), bored half-closed eyes.
2) Blowing a small pink bubblegum bubble (no wider than his face), eyes crossed looking at it.
3) Bubble popped: pink gum stuck on his cheeks and nose, surprised eyes, ahoge straight up.
4) Balancing on one foot with arms out for balance, tongue out in concentration.
```

### Suggested order for round 3

1. `eat-onigiri`, `drink-cola`: one simple prop each, a good test of whether ChatGPT keeps to the lock.
2. `eat-ramen`, `eat-rice`, `eat-sticks`, `drink-boba`.
3. `vibe-2`, `think-3`.
4. `drink-milk`, `vibe-3`, `idle-fun`, `eat-sweets`.

### Extra checks for round 3

Along with the checklist above:
- [ ] **Hair:** lay the frame over reference frame 1. The hair outline and tufts match, and the ahoge curls to the right.
- [ ] **Outline:** every line is the same 1-block dark brown, including where the hand overlaps the prop.
- [ ] **Hand to mouth:** the elbow bends, and the arm is no longer than in the reference.
- [ ] **Prop size:** the bowl, cup or can is no wider than his torso, and stays the same size in all four frames.
- [ ] **No text:** no brand, logo or letters on any can, box or carton.

# Round 4: Christmas specials (Dec 1 – Jan 6 only)

Paste the prompt below to ChatGPT (the agent that works in `Documents/Codex/2026-11-13/i-w/work`). It draws the sheets and wires them in, but only stages the result; Claude installs it.

```
CHRISTMAS SPECIAL ANIMATIONS FOR FAYE

Faye already has a Christmas outfit (work/faye-christmas, installed in D:\myapp\faye\assets\christmas\). From Dec 1 to Jan 6 faye.js loads that folder instead of faye\assets\. Now give him Christmas-only activities, and during the season swap out the summer ones that don't fit.

━━ 1. SEASONAL SWAP (Christmas season only; the rest of the year nothing changes) ━━
Stop these idle activities during the season (keep their art, just don't pick them):
  cola, ramune, iceCream, strawberryMilk, rain, bubble
Add these new activities instead, one 2x2 sheet (4 frames) each (the tree has two sheets):

  xmas-cocoa     Hot cocoa: a small white mug with a red stripe, cocoa with 2 marshmallows, 3 thin steam curls.
                 1) holding the mug in both hands at chest, eyes closed, smelling the steam  2) blowing on it, cheeks puffed
                 3) sipping, eyes ^^  4) cocoa mustache on his upper lip, surprised, small "o" mouth
  xmas-gift      A small present: red box, gold ribbon and bow, no wider than his torso.
                 1) holding it up beside his ear, shaking it, curious  2) hugging it, blush, eyes closed
                 3) pulling the ribbon, tongue out  4) lid open, sparkle eyes, tiny gold sparkles above the box (nothing inside visible)
  xmas-tree-pull The tree comes out of his bunny bag (a cartoon "bottomless bag" gag: the bag stays its normal small size).
                 The tree is a potted pine as big as Faye: pot on the floor line (y=300), tip level with the top of his hair
                 (about y=70; his ahoge may stick up above it), a slim cone no more than 100 px wide, centred near x=235 in
                 the cell so it stands just BEHIND him to the viewer's right (his body and hair cover its left part, its
                 right edge stays at least 4 px inside the cell). BARE (no baubles, no star yet), in a small red pot.
                 1) one hand deep in the bag up to the elbow, rummaging, tongue out, looking at the bag
                 2) tugging with both hands, leaning back, the pine's green tip poking out of the bag, eyes squeezed shut
                 3) the whole tree popping out of the bag, lifted in both arms in front of his chest, surprised "o" mouth,
                    2 tiny sparkle specks at the bag flap
                 4) setting the tree down on the floor beside him (viewer's right), pot on the floor line, proud smile
  xmas-tree      The same tree from xmas-tree-pull (same size, pot and position on the floor beside him), now decorated step by step.
                 1) reaching up to hang a red bauble, on tiptoe (1 bauble on the tree)
                 2) stepping back, hand on chin, admiring (3 red and gold baubles)
                 3) placing a gold star on top, both arms up (arms stay short; he stands on tiptoe)
                 4) thumbs-up at the finished tree (baubles + star), wink
                 The tree must be identical between the two sheets except for the decorations being added.
  xmas-snow      Snowflakes (small white 3x3-block flakes, 5–7 of them), no other scenery.
                 1) looking up, mouth open, catching a flake on his tongue  2) holding out both hands, a flake landing on a mitten-less palm
                 3) shivering, hugging himself, teeth chattering ("> <" eyes)  4) pulling the scarf up over his nose, eyes smiling
  xmas-snowman   Crouching. A tiny snowman (two snowballs, twig arms, orange carrot nose, no hat) no taller than his knees.
                 1) rolling a snowball on the floor  2) stacking the head on top
                 3) pushing in the carrot nose with one finger  4) crouched beside it, peace sign, big smile
  xmas-cookie    A gingerbread man cookie with white icing lines (no face text), no wider than his hand.
                 1) holding it up to look at it, sparkle eyes  2) biting off the head, eyes closed
                 3) chewing, eyes ^^, cookie now headless  4) offering the rest toward the viewer, blush

Also one Christmas reaction, used instead of "celebrate" during the season:
  xmas-cheer     1) holding a small jingle bell up, ringing it (2 tiny motion marks)  2) both arms up, eyes ^^, 3 confetti specks
                 3) little jump, feet just off the floor line  4) landing, peace sign, wink

And fix one existing Christmas frame:
  idle-fun frame 1 (Christmas sheet only): he used to spin his sunglasses, now he waves an empty fist. Redraw it: he twirls his
  Santa hat on one finger above his head (hat off, hair fully visible, same hair outline as reference), 2 small motion marks.

━━ 1b. IN-BETWEENS (so nothing jumps) ━━
An in-between is drawn exactly halfway between two key frames: limbs, head tilt and prop halfway between their two
positions, the prop the same size, the body the same size, feet on the same floor line (unless the two key frames are
both in the air). Expression: a neutral or half-way face (eyes half open, small mouth), never a new expression.
Each sheet below is 2x2; frame order top-left, top-right, bottom-left, bottom-right.

  xmas-tree-between   in-betweens inside the tree activity (tree identical to the key frames, same spot)
                 1) pull 1 → 2: the arm coming back out of the bag to the wrist, other hand grabbing the bag flap
                 2) pull 3 → 4: the tree lowered halfway toward the floor, knees bent, looking down at the pot
                 3) pull 4 → decorate 1: stepping toward the bare tree, one red bauble in his raised hand
                 4) decorate 3 → 4: coming down off tiptoe, arms halfway down, star already on the tree
  xmas-treats-between in-betweens inside the bag props (same mug, cookie and present as their sheets)
                 1) cocoa 2 → 3: the mug rising from chest to chin, eyes half closed
                 2) cookie 1 → 2: the cookie moving from eye level to his open mouth
                 3) gift 2 → 3: hands sliding from hugging the box to the ribbon
                 4) cheer 3 → 4: coming down from the jump, feet 1 block above the floor line, knees bending
  xmas-snow-bridge    from standing into the snow activity (bridge sheet, like bridge-hum)
                 1) FROM: copy Christmas idle-breath frame 1 exactly  2) a first flake falling past his face, eyes following it
                 3) chin lifting, hands rising to chest  4) TO: copy xmas-snow frame 1 exactly
  xmas-snowman-bridge from standing down into the crouch
                 1) FROM: copy Christmas idle-breath frame 1 exactly  2) knees bending, looking down at the floor
                 3) halfway down on one knee, both hands reaching to the floor  4) TO: copy xmas-snowman frame 1 exactly
  The FROM and TO frames of the bridges must be pixel copies of those frames (they are joins, not new poses).

━━ 2. ART RULES (strict, same as every round) ━━
Reference: the Christmas idle-breath sheet, frame 1 (faye\assets\christmas\idle-breath.png), plus work/faye-christmas/character-sheet.png
for the outfit. Copy him exactly; only the pose, expression and prop change.
- Use the STYLE block and the LINE-ART LOCK from faye/ART-PROMPTS.md (rounds 2 and 3) word for word in every generation.
- Outfit: red duffle coat with cream trim and toggle buttons, blue scarf, small Santa hat tilted on his hair (ahoge stays
  above the hat, curling to the viewer's right), brown strap to the cream bunny bag with the gold star charm, brown pants,
  white sneakers. No sunglasses.
- Same grid as every sheet: 576x656 PNG, 2x2 cells of 288x328, standing pose 280 px tall (72 blocks), shoe soles on y=300,
  head (hair width) about 92 px, 1-block #34140C outline, flat colours, no anti-aliasing, transparent background.
- Props: same block size and outline as him, never wider than his torso, no text, logos or labels.
- Cut out on #00FF00, then: zero green pixels touching transparency, zero semi-transparent pixels.
- Crouching/sitting frames keep the same head size; only the body is shorter.

━━ 3. WIRING (in D:\myapp, NOT in an old copy) ━━
IMPORTANT: start from the CURRENT D:\myapp\faye\faye.js, js\faye-voice.js and js\admin.js. Last time the staged faye.js was
built from an older copy and would have undone newer features (random idle with routines, finish-waking-first). Do not
copy any file from work/faye-christmas or work/faye-rounds over the repo files; make small edits to the current ones.
- faye.js already has `christmas` (true from Dec 1 to Jan 6, or with ?fayeOutfit=christmas) and `artDir`.
- New sheets go in faye\assets\christmas\ only. Add them to `authored` and their actions to the idle list / `clips`,
  but load them ONLY when christmas is true (outside the season the normal folder has no such files: skip them, no 404s).
- Idle during the season: remove the six summer ids above from the pool and add the six new ones. Add three Christmas
  routines to `routines` (season only): ['xmas-cocoa','xmas-cookie'] and ['xmas-snow','xmas-snowman'], plus
  ['xmasTree','xmas-gift']. Keep the existing weights, recent-repeat rule and routineChance.
- Tree: xmas-tree-pull and xmas-tree are ONE activity ('xmasTree' in the idle pool): the 4 pull frames, then the 4
  decorating frames, about 6 s in all, with the tree staying exactly in place between them (no bag hand-off for it;
  the pull frames ARE the hand-off). Only xmasTree is in the pool; the routine is ['xmasTree','xmas-gift'].
- Props from the bag: cocoa mug, present and cookie come out of the bunny bag like the other props (add them to `props`,
  `bagPoses` and the Christmas `foodInBag` with crop + mask, the same way as the existing Christmas entries). The tree,
  snow and snowman need no bag hand-off; the tree pulls itself out (see Tree above).
- Reaction: during the season, play('celebrate') shows xmas-cheer.
- In-betweens: put each in-between in its clip between the two key frames it joins, and hold it shorter than a key
  frame (about 120–160 ms; key frames keep their normal timing), e.g. tree: pull1, between1, pull2, pull3, between2,
  pull4, between3, deco1, deco2, deco3, between4, deco4. Bridges: add xmas-snow and xmas-snowman to `actionBridges`
  (season only) with their two middle frames, the same way as vibe/hum/ponder, so they play when he starts from standing.
- js\faye-voice.js: add 2 lines per new activity under `activity`, in Faye's current flirty, playful voice (Thai, calls
  the owner บอส, sweet and clean). Example tone: cocoa → 'โกโก้ร้อน ๆ หวานเหมือนบอสเลย'.
- Don't change admin.js unless something truly needs it.

━━ 4. CHECKS, THEN STAGE (don't install) ━━
- Per frame: height, foot line y=300, head width, green-edge count (0), semi-alpha count (0). Print the table.
- node --check on every edited JS file, and `node scripts/check-faye.mjs` in D:\myapp passes.
- In a browser: the admin page with ?fayeOutfit=christmas plays every new action with no console errors; with
  ?fayeOutfit=normal none of them can be picked and no christmas-only sheet is requested.
- Stage everything in work/faye-christmas-special/stage/ (same folder layout as D:\myapp), plus a diff of each
  edited file against the current repo file, and a contact sheet with reference frame 1 beside every new sheet.
  Then stop; Claude reviews and installs.
```

## Round 4, tree revision 3: wide tree, decorating from behind

```
TREE REDESIGN (replaces the current tree frames; keep every other sheet and fix as is)
If the 3 cleanups from the last review (stray lines, second bag, cape coat) aren't done yet, do them too.

━━ THE TREE ━━
- No pot. A wide, full pine standing straight on the floor line (a short brown trunk stub, base on y=300).
- Wide: about 200 px across at the bottom (roughly x 44–244 in the 288 px cell), a classic layered cone.
- Tall: its tip sits about 1–2 blocks above the top of his hair (around y=56), never closer than 4 px to the cell top.
- Once it's standing, it is centred in the cell (x≈144) BEHIND Faye: the same tree pixels and the same spot in every
  frame; only the decorations are added. Nothing crosses the cell edges.

━━ PULLING IT OUT (xmas-tree-pull, redraw frames 2–4; frame 1 stays) ━━
  2) tugging with both hands, leaning back, the pine's green tip poking up out of the bag
  3) the tree sliding up out of the bag on a slant, both hands on the trunk, surprised "o" mouth, 2 sparkle specks
     (the bag stays its small size: the "bottomless bag" gag)
  4) the tree standing upright, centred behind him, bare; he faces the viewer, dusting his hands, proud smile

━━ DECORATING FROM BEHIND (two new sheets, 8 frames, replacing xmas-tree) ━━
He turns around and decorates with his BACK to the viewer, wiggling his hips and stepping side to side around the
tree. Back view: copy the back figure in work/faye-christmas/character-sheet.png (hair from behind, Santa hat, ahoge,
coat back, bag strap and bag at his hip, shoes). Same height, head size, outline and floor line as every frame.
Decorations: a gold tinsel garland (a wavy 1–2 block strip of gold and pale yellow) swooping across the branches,
plus red and gold baubles. Each frame keeps everything from the frame before and adds a little more.

  xmas-tree-deco-a
  1) back view, centred, a coil of gold garland in both hands held up at chest height, head tilted
  2) shifted about 20 px to the viewer's LEFT, hips wiggling left, draping the first garland swoop on the left side
  3) shifted about 20 px to the viewer's RIGHT, hips wiggling right, the garland swooping across to the right side
  4) back in the centre, little bounce, a second garland swoop lower down across the whole tree
  xmas-tree-deco-b
  1) shifted left, hanging a red bauble at shoulder height, other hand on his hip, hip popped out
  2) shifted right, hanging a gold bauble, wiggle the other way
  3) centred, hopping up (both feet 1–2 blocks off the floor), both short arms up, placing a gold star on the tip;
     the star must be fully visible beside his ahoge, not hidden behind it
  4) turned back to face the viewer, standing in front of the finished tree (garland, baubles, star), thumbs-up, wink

Arms stay short in every frame: when something is out of reach he steps sideways or hops, his arms never grow.
Shifts left and right keep him at least 4 px inside the cell.

━━ IN-BETWEENS (redraw xmas-tree-between) ━━
  1) pull 1 → 2: unchanged
  2) pull 3 → 4: the tree halfway from the slant to upright, behind him
  3) pull 4 → deco-a 1: turning around, three-quarter back view, garland coil in hand
  4) deco-b 3 → 4: landing from the hop and turning halfway back to the front (three-quarter view), arms coming down

━━ WIRING (faye.js, current staged copy) ━━
xmasTree becomes about 9 s: pull1, between1, pull2, pull3, between2, pull4, between3, deco-a 1, deco-a 2, deco-a 3,
deco-a 2, deco-a 3 (the wiggle plays twice, about 260 ms per wiggle frame), deco-a 4, deco-b 1, deco-b 2, deco-b 3,
between4, deco-b 4 (hold the last frame about 900 ms). Remove the old xmas-tree sheet from `authored`; keep the
season-only loading and everything else as is.

━━ CHECKS ━━
Same audit as before (heights, floor line, green edge 0, semi-alpha 0, stray-line check, nothing within 4 px of a
cell edge), plus: the standing tree's own pixels are identical in every frame from pull 4 to the end except where
decorations are added or Faye covers it. Update the contact sheet, stage again, don't install.
```

## Round 4, tree revision 4: he steps left, tree on the right

```
TREE REVISION 4 (replaces the revision-3 tree frames; keep every other sheet, the cleanups and the code as they are)

Revision 3 failed: a wide tree centred behind Faye is almost completely hidden by his 172 px hair, so it read as a
green skirt and the star floated in the air. Fix: while decorating, Faye stands at the LEFT of his cell and the tree
stands on the RIGHT, so most of the tree is visible.

━━ LAYOUT (cell 288 x 328, floor y=300) ━━
- Faye "left spot": exactly his normal drawing moved 56 px left, so he spans about x 4–176 (ahoge about x 44–131).
  Same size, same floor line; just moved.
- The tree: no pot, a short brown trunk stub on the floor (base y=300). A full layered pine about 148 px wide at the
  bottom, centred at x≈208 (about x 134–282), tip at about y=48. His body and hair cover only its left edge; its right
  half and its tip are clearly visible to the right of his ahoge. Right edge at least 4 px inside the cell.
- Once standing, the tree's own pixels and position are identical in every frame until it goes back in the bag; only
  decorations are added. Nothing crosses the cell edges.

━━ PULLING IT OUT (xmas-tree-pull: keep frames 1–3 as in revision 3; redraw frame 4) ━━
  4) Faye at the left spot, facing the viewer, dusting his hands; the bare tree standing on the right, proud smile.

━━ DECORATING FROM BEHIND (redraw xmas-tree-deco-a and xmas-tree-deco-b) ━━
Back view as in revision 3 (copied from the back figure in work/faye-christmas/character-sheet.png), at the left spot,
turned slightly toward the tree. Decorations on the visible right part: a gold tinsel garland (wavy 1–2 block strip)
in swoops, red and gold baubles; each frame keeps everything before it and adds a little.
  deco-a 1) back view, garland coil held up in both hands, head tilted toward the tree
  deco-a 2) hips wiggling left (body shifted up to 8 px left, never closer than 4 px to the edge), first garland swoop
            high on the tree
  deco-a 3) hips wiggling right (up to 16 px right of the left spot), garland swooping down across the tree
  deco-a 4) little bounce, a second garland swoop lower down
  deco-b 1) reaching right to hang a red bauble at shoulder height, other hand on his hip
  deco-b 2) wiggle, hanging a gold bauble a little lower
  deco-b 3) STAR: he steps about 32 px right (toward the trunk) and hops (feet 1–2 blocks off the floor), both short
            arms up and to the right, setting a gold star on the tip at about (208, 48). The star is fully visible,
            never behind his ahoge or hair.
  deco-b 4) back on the floor at the left spot, turned to face the viewer, thumbs-up, wink, finished tree on the right

━━ PACKING IT AWAY, so he ends back in his normal spot (new sheet xmas-tree-pack) ━━
  1) facing the viewer at the left spot, admiring the finished tree, hands clasped
  2) lifting the decorated tree on a slant (both hands on the trunk), its base going into the bunny bag
     ("bottomless bag" gag, the bag stays small), tongue out
  3) only the star-topped tip left sticking out of the bag, him halfway back toward the centre (about 28 px left of normal)
  4) EXACT pixel copy of Christmas idle-breath frame 1 (his normal spot, no tree): the join back to his idle

━━ IN-BETWEENS (redraw xmas-tree-between) ━━
  1) pull 1 → 2: unchanged from revision 3
  2) pull 3 → 4: tree halfway from slant to upright on the right, Faye halfway to the left spot (about 28 px left)
  3) pull 4 → deco-a 1: at the left spot, turning to a three-quarter back view, garland coil in hand
  4) deco-b 3 → 4: landing from the star hop, halfway back to the left spot, turning halfway to the front

━━ WIRING (faye.js staged copy) ━━
xmasTree becomes about 11 s: pull1, between1, pull2, pull3, between2, pull4, between3, deco-a 1, deco-a 2, deco-a 3,
deco-a 2, deco-a 3 (wiggle twice, about 260 ms each), deco-a 4, deco-b 1, deco-b 2, deco-b 3, between4, deco-b 4
(hold about 900 ms), pack 1, pack 2, pack 3, pack 4. Add xmas-tree-pack to the season-only `authored` sheets.
Arms stay short everywhere: he steps or hops to reach, his arms never grow.

━━ CHECKS ━━
Same audit as before (heights, floor line, green edge 0, semi-alpha 0, stray-line check, 4 px margins), plus:
- Faye at the left spot is pixel-identical in shape to his normal drawing shifted 56 px (only pose/expression change)
- at least 60% of the tree's pixels are visible (not covered by Faye) in every frame where it stands
- the star touches the tree's tip in deco-b 3 and 4
- pack 4 is byte-identical to Christmas idle-breath frame 1
Update the contact sheet, stage again, don't install.
```

# Round 5: the Christmas curtain intro (first visit from Dec 1)

```
CHRISTMAS CURTAIN INTRO FOR FAYE

The site switches to its Christmas look from Dec 1 to Jan 6 (js/season.js adds class "xmas" to <html> and loads
css/theme-xmas.css; faye/faye.js switches Faye to assets/christmas/). Build a short intro that plays ONCE per device
the first time someone opens a page in the season: a HUGE Faye climbs up from the bottom edge of the screen, closes
a curtain over the normal page, ducks down to change, climbs back up in his Christmas outfit and opens the curtain
onto the Christmas theme.

━━ 1. THE SHOW (about 10 s, step by step) ━━
The bottom edge of the screen is a "ledge": Faye is so big that we only ever see him from the head down to the chest,
with his hands gripping the bottom edge of the screen. His head is about 55–65% of the screen height on a computer,
and never wider than 90% of the screen on a phone. Drawn crisp: whole-number pixel scaling, image-rendering: pixelated.
 0. The page loads in its NORMAL look (no Christmas class yet). A soft dark-pink dim fades over it (0.3 s).
 1. CLIMB UP: first only his ahoge and the top of his hair rise from the bottom edge, then his fingers grab the edge,
    then he pulls himself up until we see him from head to chest, hands on the edge, cheeky grin (about 1.2 s).
 2. PULL THE CORD: he reaches up with one hand to a golden cord hanging from the top of the screen and pulls it down.
 3. CURTAIN CLOSES: two red velvet curtains with white fluff close in a curve from the left and right and meet in the middle (0.9 s).
    Faye stays in front of the closed curtain, looks left and right, "…ห้ามแอบดูนะ" in a pixel speech bubble.
 4. DOWN TO CHANGE, IN A HURRY: he drops down below the bottom edge (0.3 s). Right away a cartoon "hurry" dust cloud
    bursts up from the bottom edge where he went down: a puffy white-pink cloud that shakes and changes shape
    (3 frames looping), with motion lines and little stars (about 1.6 s).
 5. ACCESSORIES FLY UP: while the cloud shakes, his things pop up out of it one by one and fly up and away, spinning:
    the round sunglasses, then the cream hoodie, then one sneaker. Behind the closed curtain the page switches to the
    Christmas theme now (add the "xmas" class, load theme-xmas.css, put the hats on the logos).
 6. BACK IN THE CHRISTMAS OUTFIT: the cloud puffs away and he climbs back up the same way (ahoge and Santa hat first,
    then fingers, then head to chest), now in his Christmas outfit.
 7. SMILE: a big happy smile, eyes ^^, blush, a few sparkles around him (about 0.8 s).
 8. PULL THE CORD + MERRY CHRISTMAS: he pulls the cord again, the speech bubble says "Merry Christmas! 🎄", the curtains
    open in a curve, gathering into swags at the sides (1 s), revealing the Christmas page, a puff of pink-and-white snow bursts out.
 9. He waves and sinks down below the bottom edge. The dim fades out. Done. (On the admin page his normal corner box
    comes back, in the Christmas outfit.)
 A small "ข้าม ›" (skip) button in a corner is always visible: it jumps straight to the end (Christmas theme on,
 curtains gone, big Faye gone). Tapping anywhere else does nothing during the show.

━━ 2. NEW ART (strict rules as every round) ━━
Use the STYLE block and the LINE-ART LOCK from faye/ART-PROMPTS.md word for word. Same 576x656 sheets, 2x2 cells of
288x328, 1-block #34140C outline, no green edges, no soft alpha, short arms always, same head size as the reference
(hair about 172 px wide in the cell).
References: normal = faye/ref/faye-reference-2x.png frame 1; Christmas = faye/assets/christmas/idle-breath.png frame 1.

BUST FRAMES: draw him at the normal size in the cell, but only from the top of his ahoge down to his chest. The bottom
of the cell (y=300) is the ledge: his body is cut off in a clean straight line at y=300, and his hands rest ON that
line, gripping it. Nothing below y=300. His head is in the same place in every frame of a sheet unless the frame says
he is rising.

  intro-normal (normal outfit)
   1) rising: only the ahoge and the top of his hair above the ledge line, fingers of both hands gripping the ledge
   2) up: head to chest visible, both hands gripping the ledge, cheeky grin
   3) reaching up with one hand as high as a short arm goes, other hand on the ledge
      (the cord itself is drawn by code at that hand)
   4) pulling the cord down: that hand now at shoulder height in a fist, determined face, other hand on the ledge
  intro-hurry (no Faye)
   1-3) the hurry cloud: a puffy white-and-pale-pink cartoon dust cloud sitting on the ledge line, three different
        lumpy shapes for a jittery loop, with short motion lines and 2–3 tiny stars; about 200 px wide
   4) the cloud thinning out into a few small puffs (end of the change)
  intro-props (each centred in its cell, no Faye)
   1) his round sunglasses tumbling   2) his cream hoodie crumpled, pink sleeves flapping
   3) one of his white sneakers with the blue stripe   4) a sparkle burst (pink, gold and white pixel stars)
  intro-xmas (Christmas outfit, same bust framing)
   1) rising: only the ahoge and the Santa hat above the ledge, fingers gripping the ledge
   2) up: head to chest, both hands on the ledge, BIG smile, eyes ^^, pink blush
   3) reaching up for the cord, same as intro-normal 3 but in the Christmas outfit, mouth open happily
   4) pulling the cord down, mouth wide open as if shouting "Merry Christmas!", other hand waving
The rising and sinking between key frames is done in code by sliding the bust frames up or down behind the ledge
(the bottom edge of the screen hides anything below it), so the frames above are enough.

━━ 3. THE CURTAINS (code, pixel style to match) ━━
Look: two RED velvet theatre curtains with WHITE FLUFF, like Santa's coat.
- Velvet: red #C8102E with deeper folds #8E0F22 and highlights #E2354A as vertical bands
  (repeating-linear-gradient), hard-edged (no blur) so they sit with the pixel art.
- White fluff: a thick, puffy white fur trim (#FFFFFF with soft pink-grey shading #F3DCE4 in hard steps, a bumpy
  scalloped outline) running down the inner edge of each curtain and along its bottom hem, and along the bottom of
  a red valance across the top of the screen.
- Gold tie-back tassels and the gold cord (2–3 px line with a tassel), the cord ending exactly at Faye's raised hand.

Motion: open and close IN A CURVE, like a real theatre curtain, never as flat sliding rectangles.
- Each panel's inner edge is a smooth curve, not a straight line. The top is fixed to the rail, so while closing the
  top of the inner edge moves first and the bottom trails behind, bowing into a curve; it settles into a straight,
  softly rippled edge when the two panels meet in the middle (with a small overshoot and settle, about 1 s).
- Opening is the reverse into a swag: each panel is gathered up and back to its side, the inner edge sweeping in a
  curved arc from the top centre down to a tie-back at about 60% of the screen height on that side, then falling
  straight below it; the white fluff follows the curve all the way (about 1 s).
- Build the shapes with SVG paths (or clip-path: path()) updated each frame, so the curve and the fluff stay smooth
  at any screen size; keep it to two panels and the valance (cheap on phones).
Big Faye, the cloud and the flying props are always IN FRONT of the curtain.

━━ 4. CODE (start from the CURRENT D:\myapp files; never copy an old file over them) ━━
- New js/xmas-intro.js and css/xmas-intro.css, loaded only when the intro will play (season.js decides and loads them,
  so normal visits and off-season visits download nothing extra). The big Faye is a plain image or canvas of the new
  sheets scaled up (no need for the faye.js idle engine); the new sheets go in faye/assets/intro/.
- js/season.js: today it adds the Christmas theme at load. Change it so that when the intro is due it does NOT apply
  the theme at load; instead it exposes one function (e.g. window.KagaSeason.applyChristmas()) that the intro calls at
  step 5, behind the closed curtain. Everything else in season.js stays as it is.
- When it plays: only in the season (Dec 1 – Jan 6), only on the first page view of the season on that device
  (localStorage key like "kaga-xmas-intro-2026", wrapped in try/catch: if storage fails, don't play), on the shop,
  status and admin pages. ?xmasIntro=1 replays it any time for testing (with ?theme=xmas outside the season).
  Never when prefers-reduced-motion is set: then just apply the theme.
- Admin page: the normal corner Faye is hidden during the show and comes back at the end in the Christmas outfit
  (faye.js picks the outfit when it loads, so mount or remount the corner Faye after the show).
- Layering: the stage sits above everything (above the cart, menus, the corner Faye), blocks taps except the skip
  button, and is removed from the page at the end (no leftovers, no scroll lock left behind).
- Phones: works at 375 px wide; the curtains cover the full height including the address-bar area (100dvh with a
  100vh fallback); the ledge is the real bottom edge of the visible screen.
- Size: keep the new art and code small; no new libraries.

━━ 5. CHECKS, THEN STAGE (don't install) ━━
- Art audit: green edge 0, semi-alpha 0, stray lines 0, 4 px side and top margins, bust frames cut cleanly at y=300
  with nothing below, the same head size and head position as the reference in the "up" frames.
- node --check on every edited file; `npm run check` in D:\myapp passes.
- In a browser at desktop and 375 px: the full show plays with ?xmasIntro=1&theme=xmas on index.html, status.html and
  admin.html; the theme switches behind the closed curtain (not before); skip works at every step; it plays only once
  (second load: no intro, theme already on); outside the season with no params nothing extra loads; no console errors.
- Record a short video or a frame strip of the whole show for review.
- Stage everything in work/faye-christmas-intro/stage/ (same layout as D:\myapp) with a diff of each edited file
  against the current repo file. Then stop; Claude reviews and installs.
```

## Round 5b: a more detailed big Faye (curtain intro only)

```
MORE DETAIL FOR THE BIG FAYE IN THE CURTAIN INTRO (intro sheets only; his normal sprites everywhere else stay as they are)

In the intro Faye is scaled up so much that each art pixel becomes a big block. Redraw ONLY his two bust sheets
(intro-normal, intro-xmas) at DOUBLE pixel density, so he has twice as many pixels across and down and much more
detail. Everything else in the intro is approved and stays exactly as it is: show order, timing, curtains, cloud,
props, season.js, gating and the HTML loaders.

━━ 1. RESOLUTION ━━
- New sheets intro-normal-hd.png and intro-xmas-hd.png: 1152 x 1312, a 2x2 grid of 576 x 656 cells.
- Same 4 px block size as before, so twice as many blocks: his hair is now about 344 px (86 blocks) wide in the cell
  instead of 172 px, and the ledge line is at y=600 in each cell instead of y=300. Nothing below the ledge line.
- The code draws these cells at half the scale of the old ones, so on screen he is EXACTLY the same size and position
  as now (same head size, same ledge, same cord and grip points); only the detail is finer.

━━ 2. WHAT "MORE DETAIL" MEANS (same character, same design) ━━
- Hair: individual locks and strands, 3–4 tones of orange-peach with crisp highlight streaks, the spiky tufts and the
  ahoge curling to the viewer's right, exactly the same silhouette as now.
- Eyes: larger iris detail (2–3 cyan tones, a dark pupil, two white catch-lights), eyelashes, eyebrows.
- Face: soft blush with a few hatch pixels, a small nose hint, clean mouth shapes per frame.
- Sunglasses (normal): round black lenses with a reflection glint and a thin frame; Santa hat (Christmas): fur trim
  texture and a fold shading on the red.
- Clothes: hoodie / coat fabric folds, the zip or toggles, seams; scarf knit texture (Christmas); the bag strap.
- Hands: proper fingers gripping the ledge, knuckles, short arms as always.
- Still pixel art: hard square 4 px blocks, a clean 1-block dark-brown (#34140C) outline, no anti-aliasing, no
  gradients, no blur, no soft shading, binary transparency. More colours are fine (up to about 2x the current
  palette), but stay in the same hues.

━━ 3. STAY ON MODEL (strict) ━━
- Shrink each new frame by half (nearest neighbour): the result must match the approved frame's silhouette (hair
  outline, ahoge, head width, hands, ledge) within 1 block. Show this side by side for every frame.
- Same expressions and poses as the approved frames, frame for frame: normal = rising, up/grin, reach, pull;
  Christmas = rising with the hat, up/big smile, reach, pull/"Merry Christmas" with a wave.
- Reference: the approved intro-normal / intro-xmas frames for pose and silhouette, faye/ref/faye-reference-2x.png
  and the Christmas character sheet for colours and outfit details. No new design elements, no older look, no
  longer arms, no smaller head.
- Make a single detailed head-and-chest "master" for each outfit first, then build all 4 frames from it, so the face
  and hair are identical across frames except for expression and hands.

━━ 4. CODE (staged xmas-intro.js only) ━━
- Load the -hd sheets instead of the old two, and draw them at half the scale (keeping whole-number device-pixel
  scaling: if half scale isn't a whole number on some screen, pick the nearest whole number that keeps him within
  the size limits). Rising and sinking offsets, cord and grip points stay identical on screen.
- Keep the old intro-normal / intro-xmas sheets out of the stage (they aren't needed any more).

━━ 5. CHECKS, THEN STAGE (don't install) ━━
- Art audit on the -hd sheets: green edge 0, semi-alpha 0, stray lines 0, clean ledge at y=600, nothing below it,
  half-size silhouette match within 1 block for all 8 frames (print the per-frame difference).
- Screenshots at 1280 x 900 and 375 px of the "up", "pull", "smile" and "Merry Christmas" moments, old vs new side by
  side, same size on screen.
- Same browser checks as before (full show, skip, once-only, no errors); stage again; don't install.
```

## Round 5c: curtain opens in an A shape

```
CURTAIN OPENING SHAPE (curtain intro; change only how the curtains look while opening and when open)

Now, when the curtains open they form a rounded arch (wide in the middle, round at the top). Change it to an
A shape, like a tent flap or a stage curtain pulled apart at the bottom:
- Open position: the two curtains still meet near the TOP CENTRE (their inner edges about 8–12% of the screen width
  apart at the valance, just around the speech bubble), and their inner edges run DOWN AND OUT in long, almost
  straight lines to the two BOTTOM CORNERS of the screen. The edges bow slightly outward (a gentle curve, not a
  ruler-straight line), so the opening is a tall triangle with soft curved sides: narrow at the top, as wide as the
  screen at the bottom.
- The white fluff follows the whole diagonal inner edge of each curtain, top to bottom corner; the valance with its
  fluff stays across the top.
- Opening motion: the tops of the inner edges stay near the centre while the bottoms sweep outward toward the bottom
  corners (bottom leads, top follows a little), about 1 s, with a small overshoot and settle. Closing is the reverse:
  the bottoms swing back in to meet in the middle.
- Faye, the speech bubble and the cord stay in front of the curtains, inside the opening, exactly where they are now.
- Phones (375 px): same A shape; the top gap stays at least as wide as the speech bubble.
- Everything else stays approved and unchanged: the curtains are still off screen at the start, the show order and
  timing, the fade-out at the end, the art, season.js and the loaders.

Re-run the same checks, add screenshots of the open A shape at 1280 x 900 and 375 px, stage again, don't install.
```
