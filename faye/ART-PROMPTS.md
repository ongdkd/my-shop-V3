# Faye: animation review and art prompts

## What makes Faye feel stiff today

I checked all 45 animations in `faye/faye.js`.

1. **Most actions have one drawing.** 28 of them use a single still, and the code only tilts or bobs it. Hands, mouth, hair and feet never really move.
2. **Many actions borrow a pose that doesn't match.** For example:
   - *laugh* uses the seated wake-up stretch.
   - *stretch* and *surprise* use the "being held" pose.
   - *celebrate* and *high five* reuse the wave.
   - *oops* reuses the thinking pose.
   - *bubble* reuses humming.
   - *breathe, daydream, peek, sway, rain, toe tap, yes, no, blush, drop* and *settle* are all the plain standing drawing.
3. **Every pose change dips through `crouch`,** so he does a small squat between almost everything.
4. **Two drawings get cross-faded.** Fading between two pixel drawings shows a see-through "ghost" for a moment instead of a clean movement.
5. **His mouth never moves,** even when he answers in the chat.

New drawings fix 1, 2 and 5. Points 3 and 4 are code changes, and I can make those once the new frames exist: hard-cut between frames instead of fading, and use the new transition frames (sheet T) instead of the crouch.

---

## How to use this with ChatGPT

- Attach **`faye/assets/faye.png`** and **`faye/assets/poses-b.png`** every time as references.
- Paste the **style block**, then **one sheet prompt**. Ask for **one sheet per image**.
- If he drifts off-model, reply: *"Redraw at exactly the same scale, proportions and pixel size as the reference: head about 2/3 of his height, short legs, same outfit, feet on the same line."*
- Before saving, put the result next to `faye.png`. If the head looks smaller or the legs longer, ask for a redraw. The code resizes him by head size, so a shrunken head makes his body look too big on screen.
- Save each good result as `faye/assets/<sheet-name>.png`, for example `talk.png`, then tell Claude which sheet it is.

### Style block (paste first, every time)

```text
Use the attached images as the exact character reference. Character: "Faye", a chibi pixel-art boy, about 2.5 heads tall. Big messy orange-peach hair with a tall curled ahoge on top, round black sunglasses pushed up on his hair, cyan eyes, pink blush, small orange earrings. Cream zip hoodie with pink sleeves and two small blue stripes, brown cargo pants, white sneakers with blue stripes, a brown cross-body strap with a small cream bag that has a pink bunny face.

Art rules: crisp pixel art, chunky dark-brown outline, flat shading with 2–3 tones, no anti-aliasing, no blur, no gradients, no drop shadow, no text, no labels, no frame numbers. Pure white background.

Proportions (copy the reference exactly, do not "improve" them): chibi, about 2.5 heads tall. The head including hair and ahoge is about 2/3 of his total standing height, and neck to shoe soles is about 1/3. Short stubby arms whose hands reach only to the hem of the hoodie. Short legs. The hair is about as wide as he is tall from chin to shoes. The pixel size (thickness of one "pixel" block and of the outline) is the same as the reference. Do not make the head smaller, the legs longer, or the body slimmer.

Layout: one image, 2×2 grid, four poses, each centered in its own quarter with plenty of empty space around it. The character is the SAME size and pixel scale in all four and the same size as the reference: standing, he fills about 85% of the quarter's height. Both feet sit on the same baseline in each row. Seated or crouching poses keep the same head size and are simply shorter. Outfit, colors and proportions identical to the reference. Only pose and expression change. Hand-held props are drawn in his hands as part of the sprite.
```

---

## Priority 1: used all the time

### Sheet `talk`: talking and blinking (chat replies, every idle)
Now: no mouth movement, and blinks are painted-on eyelids.
```text
Four frames of Faye standing in the neutral reference pose, facing forward:
1) mouth closed, small smile, eyes open
2) mouth half open, eyes open
3) mouth wide open "ah", eyebrows slightly raised
4) mouth closed, eyes closed in a blink (thin curved lines)
Body, arms, hair and bag must be pixel-identical in all four. Only the face changes.
```

### Sheet `idle-breath`: breathe, sway, toe tap
Now: the plain stand drawing, tilted by the code.
```text
Four frames of Faye standing calmly, for subtle idle motion:
1) inhale: shoulders and chest 1–2 pixels higher, ahoge curled slightly tighter
2) exhale: shoulders 1 pixel lower, ahoge tip drooping slightly, relaxed smile
3) weight shifted onto his left leg, hip out a little, ahoge leaning right
4) right foot lifted with the toe tapping, heel down, small content smile
Changes in frames 1–2 are very subtle (1–2 pixels).
```

### Sheet `transition`: replaces the crouch between every pose
Now: every change of action squats through `crouch`.
```text
Four neutral in-between frames of Faye used to blend between actions:
1) anticipation: knees softly bent, arms relaxed slightly behind his body, eyes open
2) small hop up: on his tiptoes, arms slightly out, ahoge stretched up
3) landing: knees bent, ahoge squashed down, arms slightly forward
4) settling back to neutral: standing straight, arms in, ahoge springing to the side
```

### Sheet `look`: peek, rain, stargaze, yes, no
Now: the stand drawing slid sideways, or the thinking pose.
```text
Four frames of Faye standing with head movements:
1) head and eyes turned 3/4 toward the viewer's LEFT, curious, one hand shading his eyes
2) head and eyes turned 3/4 toward the viewer's RIGHT, curious
3) head tilted back looking UP at the sky, hands clasped behind his back, eyes sparkling
4) nodding: chin tucked down, eyes closed happily, smile
Body stays in the neutral pose except where described.
```

---

## Priority 2: reactions (chat replies and app events)

### Sheet `wave`: hello and high five
Now: one frozen wave. High five reuses it.
```text
Four frames of Faye:
1) wave anticipation: waving arm rising to shoulder height, knees slightly bent
2) arm fully up, hand tilted LEFT, cheerful open-mouth smile
3) arm fully up, hand tilted RIGHT, same smile
4) high five: one arm stretched forward and up, palm flat facing the viewer, eyes shut in a big grin
```

### Sheet `cheer`: celebrate and laugh
Now: celebrate reuses the wave, and laugh uses a *seated* pose.
```text
Four frames of Faye:
1) celebrate jump: both feet off the ground, both fists high in the air, eyes ^^, mouth wide open
2) celebrate landing: knees bent, fists pulled down to his chest "yes!", ahoge flopped
3) laughing: standing, one hand on his belly, head tilted back, eyes ^^, mouth wide open
4) laughing: leaning forward, both hands on his belly, eyes squeezed shut, tear at the corner of one eye
```

### Sheet `feelings`: surprise, oops, blush, no
Now: surprise uses "held", oops uses "think", blush and no use the stand drawing.
```text
Four frames of Faye:
1) surprised: eyes wide, small "o" mouth, ahoge sticking straight up, both hands raised to chest height, one foot lifted
2) oops: sheepish grin with tongue tip out, one hand scratching the back of his head, eyes closed
3) blushing: both hands on his cheeks, extra pink blush, looking down and to the side, shy smile
4) shaking head "no": head turned to one side, eyes closed, small frown, hands waving in front of his chest
```

### Sheet `sneeze`: build-up and release
Now: one sneeze drawing.
```text
Four frames of Faye sneezing:
1) "ah…": head tilted back, eyes half closed, nose scrunched, mouth open
2) "AH…": head further back, eyes squeezed, one hand rising toward his face
3) "CHOO!": head snapped forward, eyes shut, hand covering his mouth, ahoge whipping forward
4) after: rubbing his nose with a finger, embarrassed smile
```

### Sheet `carry`: picked up, carried, dropped
Now: one dangling drawing, and landing is the stand drawing.
```text
Four frames of Faye:
1) picked up: lifted by the back of the hoodie, surprised face, legs together, arms out
2) dangling: legs swinging LEFT, arms limp, grumpy pout
3) dangling: legs swinging RIGHT, kicking a little, eyes closed
4) landing: knees deeply bent, arms out for balance, small dust puff at his feet
```

### Sheet `letter`: love letter and shrug
Now: the letter and the shrug each have one drawing.
```text
Four frames of Faye:
1) hiding a pink envelope behind his back, shy look to the side
2) holding the pink envelope out with both hands, bowing slightly, eyes closed, blushing
3) shrug start: shoulders rising, palms turning up, eyebrows raised
4) full shrug: shoulders up, palms up at his sides, little "dunno" smile, head tilted
```

---

## Priority 3: thinking (while the app is loading)

### Sheet `think`: ponder and idea
Now: ponder has one drawing; idea is one drawing plus a lightbulb.
```text
Four frames of Faye:
1) ponder: hand on chin, eyes looking up-left, mouth pursed
2) ponder: finger tapping his chin, eyes looking up-right, eyebrow raised
3) idea wind-up: eyes wide, mouth opening, hand starting to rise
4) idea: index finger pointing straight up, big grin, sparkle in his eyes, ahoge standing tall
```

### Sheet `search`: magnifying glass
Now: one drawing, slid around by the code.
```text
Four frames of Faye holding a round magnifying glass with a blue handle:
1) leaning LEFT, glass held to his eye, eye looking huge through the lens
2) leaning RIGHT, glass held low, squinting at the floor
3) standing, glass held up toward the viewer, curious face
4) found it: glass held up high, happy open mouth
```

### Sheet `write`: process
Now: a pencil up and a pencil down, which is fine. These add life.
```text
Four frames of Faye holding a small blue notebook:
1) scribbling fast, tongue poking out in concentration
2) pencil tapping his cheek, thinking
3) scratching his head with the pencil, confused
4) holding the notebook up proudly, checkmark-happy smile
```

---

## Priority 4: idle activities

### Sheet `sleep`: sleep, yawn, wake
Now: sleep is one drawing plus z's, and yawn fades between two drawings.
```text
Four frames of Faye:
1) yawn start: standing, mouth opening, eyes half closed, one hand rising
2) big yawn: mouth wide, hand covering it, eyes squeezed, a tear at the corner, ahoge drooping
3) sleeping sitting cross-legged, head drooped forward, breathing IN (shoulders up), small snot bubble
4) same as 3 but breathing OUT (shoulders down), mouth slightly open, ahoge flopped over
```

### Sheet `tea`: tea and sip
Now: one tea drawing.
```text
Four frames of Faye holding a cream mug with a pink bunny face:
1) blowing on the hot tea, cheeks puffed, steam curling
2) sipping: mug at his lips, eyes closed
3) happy sigh: mug lowered to his chest, eyes ^^, little pink blush
4) peeking into the empty mug, one eye closed
```

### Sheet `music`: vibe and hum
Now: vibe has one drawing; hum has one drawing.
```text
Four frames of Faye with blue headphones on:
1) vibing: head bobbed LEFT, eyes closed, fists up at chest height, one knee bent
2) vibing: head bobbed RIGHT, other knee bent, open-mouth smile
3) humming: eyes closed, mouth small "o", swaying, one finger tapping the rhythm
4) humming: eyes closed, mouth closed in a smile, swaying the other way
```

### Sheet `game`
Now: one drawing plus sparks.
```text
Four frames of Faye sitting cross-legged holding a blue handheld game console:
1) focused, tongue out, thumbs pressing
2) leaning LEFT with the console, eyes narrowed
3) leaning RIGHT with the console, gritted teeth
4) winning: arms raised, console held up, big grin
```

### Sheet `daydream-stretch`: daydream and stretch
Now: daydream is the stand drawing plus a heart; stretch uses "being held".
```text
Four frames of Faye:
1) daydreaming: hands clasped beside his cheek, eyes looking up dreamily, soft smile
2) daydreaming: head resting on his hand, eyes half closed, blush
3) stretch: arms reaching straight up with fingers interlaced, on tiptoes, eyes closed
4) stretch: leaning to one side with arms still up, mouth open "nnngh"
```

### Sheet `outdoors`: rain and bubbles
Now: rain is the stand drawing plus drops; bubbles reuse the hum drawing.
```text
Four frames of Faye:
1) holding a small pink umbrella over his head, looking up at the rain, smiling
2) palm held out, catching a raindrop, curious face, no umbrella
3) blowing bubbles: a bubble wand at his lips, cheeks puffed
4) watching a bubble float up, eyes following it, mouth open in wonder
```

### Sheet `snack-photo`: snack and photo
Now: snack has two drawings; photo has one.
```text
Four frames of Faye:
1) chewing a cookie: cheeks full, eyes ^^, crumbs falling
2) holding a half-eaten cookie, licking his lips
3) photo: blue camera raised to his eye, other eye closed, one knee bent
4) photo: looking at the camera's screen, happy surprised face
```

### Sheet `extras`: fidget, flower, strum
Now: each has one or two drawings. These add the missing in-betweens.
```text
Four frames of Faye:
1) fidget: twisting the bag strap with both hands, looking down shyly
2) fidget: swinging the little bunny bag side to side, bored pout
3) flower: sniffing a small yellow flower, eyes closed, blush, little sparkle
4) ukulele: head tilted, mid-strum, mouth open singing, one foot tapping
```

### Already good, no new art needed
- **wake**: four drawings in a sequence (awake, eye rub, stretch, stand).
- **plane**: six drawings, the smoothest animation he has.
- **page**: turns the page with two extra drawings.

---

## Suggested order

1. `talk`, `idle-breath`, `transition`: on screen the most, biggest gain.
2. `wave`, `cheer`, `feelings`: the reactions people trigger.
3. `think`, `sleep`: loading and napping.
4. Everything else, whenever you like.

Each finished sheet replaces one borrowed or single drawing. Bring them back in any order and I'll measure them and add them to `faye/faye.js`. I'll also switch from cross-fading to hard cuts, and use the `transition` frames instead of the crouch.
