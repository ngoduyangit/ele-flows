/**
 * One-click image presets: pick a preset on an image node and a new, already-wired
 * image node is created and run – the user never types the prompt.
 */
import { Box, Film, Grid3x3, LayoutGrid, MapPin, PackageCheck, RectangleHorizontal, RectangleVertical, ScanFace, StepForward, Sun, UserSquare, type LucideIcon } from 'lucide-react'

export interface ImagePreset {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  /** null = keep the source image's aspect ratio */
  aspect: string | null
  prompt: string
  /** false = create the node but don't run it (needs another input first). */
  run?: boolean
  /** Shown as the new node's label suffix when it waits for more inputs. */
  needs?: string
}

export const IMAGE_PRESETS: ImagePreset[] = [
  {
    id: 'character-sheet',
    label: 'Character sheet',
    hint: 'Front / side / back + 6 face close-ups',
    icon: UserSquare,
    aspect: '16:9',
    prompt:
      'Character reference sheet of the exact same person as in the reference image. Left half: three full-body views side by side — front, side profile, back — neutral standing pose, arms relaxed. Right half: six head-and-shoulders close-ups in a 3x2 grid — front, three-quarter left, left profile, three-quarter right, back of the head, slight smile. Identical face, hairstyle and outfit in every view, plain light grey background, even studio lighting, photorealistic, no text, no labels.',
  },
  {
    id: 'character-sheet-cinematic',
    label: 'Character sheet · cinematic',
    hint: 'Face close-up + full-body front & back',
    icon: UserSquare,
    aspect: '16:9',
    prompt:
      'Cinematic character reference sheet, split-frame layout, photorealistic, of the exact same person as in the reference image – same face, age, skin tone, hairstyle, hair colour, build and outfit.\n' +
      'Left panel — facial close-up: the entire head fully inside the frame including all the hair, nothing cropped, real skin texture with subtle pores, freckles, moles and other marks exactly as in the reference, calm neutral expression, looking straight into the lens. Shot on 85mm portrait lens, shallow depth of field, soft cinematic key light with gentle fill.\n' +
      'Right panel — full-body front and back views side by side: the same person shown twice within this panel — on the left, a full-body front view facing the camera; on the right, a full-body back view photographed from directly behind. In both, they stand straight in a normal relaxed pose, arms hanging down at their sides, full height in frame head-to-toe, same body proportions, hair and outfit as in the reference. The front view shows the face and the front of the garments; the back view shows the back of the head, hair, shoulders, garment seams and the rear of the trousers and shoes. Both figures matched in framing, scale and lighting for consistency. Shot on 35mm lens, even full-length lighting.\n' +
      'Look: clean studio character sheet, plain solid grey background, consistent character across all views, soft diffused cinematic lighting, muted natural colour grade, fine detail, true-to-life skin tones, vertical divider lines separating each view. No text, no labels.',
  },


  {
    id: 'erase-sheet-face',
    label: 'Lock one face',
    hint: 'Erase the face on the full-body views',
    icon: ScanFace,
    aspect: null,
    prompt:
      'Keep this character sheet exactly as it is – same layout, person, hair, outfit, pose, background, lighting and colours – but erase the face from the full-body views: replace it with a smooth, blank, softly blurred oval in a muted skin tone with no eyes, nose or mouth, the hair staying visible around it. The close-up portrait keeps the face unchanged, so it is the only face in the sheet. No text, no labels.',
  },
  {
    id: 'location-schematic',
    label: 'Top-down schematic',
    hint: 'Floor plan to lock where things stand',
    icon: MapPin,
    aspect: '16:9',
    prompt:
      'A clean top-down schematic map of the location in the reference image, seen straight from above like an architectural floor plan: simple flat shapes for walls, roads, pavements, furniture and key props, each placed exactly where it is in the reference, with true relative sizes and distances. Mark the main props and the walking path with simple coloured shapes and arrows. Plain white background, thin dark lines, flat colours, no perspective, no people, no text.',
  },
  {
    id: 'face-3view',
    label: 'Face 3-view',
    hint: 'Front, profile, three-quarter close-ups',
    icon: ScanFace,
    aspect: '16:9',
    prompt:
      'Three close-up portraits of the exact same person as in the reference image, side by side: front view, left profile, right three-quarter view. Identical face, hairstyle, makeup and clothing, neutral expression, plain grey background, soft studio light, photorealistic, no text.',
  },
  {
    id: 'multi-angle-9',
    label: 'Multi-camera 3×3',
    hint: '9 camera angles of the same moment',
    icon: Grid3x3,
    aspect: '16:9',
    prompt:
      'A 3x3 grid of nine camera angles of the same subject and moment as in the reference image: wide establishing shot, medium shot, close-up, extreme close-up detail, low angle, high angle, over-the-shoulder, side profile, back view. Keep identity, outfit, lighting and location consistent in every panel, thin white gutters between panels, cinematic, no text.',
  },
  {
    id: 'story-4',
    label: 'Story 2×2',
    hint: '4 moments that continue the scene',
    icon: LayoutGrid,
    aspect: '16:9',
    prompt:
      'A 2x2 storyboard grid continuing the story of the reference image: four consecutive moments that naturally follow this scene, same characters, outfits, location and lighting, varied cinematic framing, thin white gutters between panels, no text.',
  },
  {
    id: 'storyboard-25',
    label: 'Storyboard 5×5',
    hint: '25 continuous shots of one sequence',
    icon: Film,
    aspect: '16:9',
    prompt:
      'A 5x5 grid of 25 consecutive storyboard frames forming one continuous cinematic sequence that starts from the reference image: the same characters, outfits, product, location and lighting in every frame, the action progressing step by step, varied shot sizes (wide, medium, close-up, extreme close-up detail) and camera angles like an edited commercial, every panel the same 16:9 size, thin white gutters between panels, photorealistic, no text, no numbers.',
  },
  {
    id: 'scene-sheet',
    label: 'Scene sheet',
    hint: 'Location from several angles, no people',
    icon: MapPin,
    aspect: '16:9',
    prompt:
      'Environment design sheet of the location in the reference image with no people: a wide establishing view on top and, below it, three views (left side, right side, reverse angle). Consistent architecture, props, lighting and colour palette across views, photorealistic, no text.',
  },
  {
    id: 'product-sheet',
    label: 'Product sheet',
    hint: 'All sides + details on white',
    icon: Box,
    aspect: '16:9',
    prompt:
      'Product design sheet of the main object in the reference image: front, back, left, right, three-quarter and top views plus two detail close-ups, pure white background, consistent materials and colours, studio product photography, no text.',
  },
  {
    id: 'cinematic-relight',
    label: 'Cinematic relight',
    hint: 'Same shot, film lighting',
    icon: Sun,
    aspect: null,
    prompt:
      'The same image with the same composition, subject, pose and framing, re-lit with cinematic lighting: motivated key light, soft rim light, gentle contrast, filmic colour grade, subtle atmospheric haze. Do not change identity, outfit or framing.',
  },
  {
    id: 'outpaint-16-9',
    label: 'Expand to 16:9',
    hint: 'Widen the frame, keep the subject',
    icon: RectangleHorizontal,
    aspect: '16:9',
    prompt:
      'Extend the reference image outward to a wide 16:9 frame: keep the original subject, pose, framing scale, lighting and colours exactly as they are in the centre and naturally continue the surroundings on the left and right. Seamless, photorealistic, no borders, no text.',
  },
  {
    id: 'outpaint-9-16',
    label: 'Expand to 9:16',
    hint: 'Vertical frame for Reels / TikTok',
    icon: RectangleVertical,
    aspect: '9:16',
    prompt:
      'Extend the reference image outward to a tall vertical 9:16 frame: keep the original subject, pose, framing scale, lighting and colours exactly as they are in the middle and naturally continue the surroundings above and below. Seamless, photorealistic, no borders, no text.',
  },
  {
    id: 'replace-product',
    label: 'Replace product',
    hint: 'Swap in your real product (connect its photo)',
    icon: PackageCheck,
    aspect: null,
    run: false,
    needs: 'connect product photo',
    prompt:
      'Keep the first reference image exactly as it is – same person, pose, framing, background, lighting and colours – but replace the product in it (the shoes, bottle, bag or object being shown) with the exact product from the second reference image. Match the product\'s shape, colours, materials, logo placement and every detail precisely, at the correct scale and perspective, lit by the scene\'s light with natural contact shadows. Photorealistic advertising photo, no text.',
  },
  {
    id: 'three-seconds-later',
    label: '3 seconds later',
    hint: 'Natural next moment of the scene',
    icon: StepForward,
    aspect: null,
    prompt:
      'The same scene three seconds later: same characters, outfits, location, lighting and camera framing, with the action progressing naturally. Photorealistic continuity frame.',
  },
]
