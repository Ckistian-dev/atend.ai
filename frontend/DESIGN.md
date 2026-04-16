# Design System Documentation

## 1. Overview & Creative North Star: "The Intelligent Stratum"

This design system moves away from the rigid, boxed-in layouts of traditional service management platforms toward a philosophy called **"The Intelligent Stratum."** 

In an AI-driven environment, information should feel like it is floating in a structured, multi-dimensional space. We move beyond the "template" look by utilizing intentional asymmetry, expansive breathing room, and high-contrast editorial typography. Instead of using borders to cage data, we use tonal depth and "strata" (layers) to guide the eye. The result is a high-tech, sophisticated experience that feels less like a database and more like a curated command center.

---

## 2. Colors & Surface Philosophy

Our palette is anchored in a deep, authoritative Cobalt (`primary: #0037b0`) and supported by a range of atmospheric blues. The system's primary color is `#0037b0`, secondary is `#1d4ed8`, tertiary is `#c4c5d7`, and the neutral base is `#0b1c30`.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning or containment. 
Boundaries must be defined solely through background color shifts or subtle tonal transitions. For example, a dashboard widget should be identified by its shift from `surface` (#f8f9ff) to `surface_container_lowest` (#ffffff), never by an outline.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of fine paper. 
*   **Base:** `surface` (#f8f9ff)
*   **Lower Tier:** `surface_container_low` (#eff4ff) for subtle grouping.
*   **Focus Tier:** `surface_container_highest` (#d3e4fe) for active or high-priority elements.
*   **The Card Base:** Always use `surface_container_lowest` (#ffffff) for primary content cards to create a "lifted" feel against the tinted background.

### The "Glass & Gradient" Rule
To inject "visual soul" into the AI experience:
*   **Glassmorphism:** For floating modals or navigation overlays, use `surface` colors at 80% opacity with a `backdrop-blur` of 20px.
*   **Signature Textures:** Use a subtle linear gradient (135° `primary` #0037b0 to `primary_container` #1d4ed8) for hero sections and primary CTAs. This creates a professional polish that flat colors cannot replicate.

---

## 3. Typography: Editorial Authority

We use a dual-typeface system to balance high-tech precision with human-centric readability.

*   **Display & Headlines (Plus Jakarta Sans):** This typeface provides the "SaaS" character. Use `display-lg` and `headline-md` with tight letter spacing (-0.02em) to create an authoritative, editorial feel for AI insights and page headers.
*   **Body & UI (Inter):** Chosen for its exceptional legibility. `body-md` is our workhorse. Use `label-sm` in all-caps with 0.05em tracking for metadata to create a "technical" aesthetic.

**Hierarchy as Identity:** Large, high-contrast headings (`on_surface` #0b1c30) against airy backgrounds convey transparency and intelligence, while the systematic use of `on_surface_variant` (#434655) for secondary text prevents the UI from feeling overwhelming.

---

## 4. Elevation & Depth: Tonal Layering

Traditional drop shadows are often a crutch for poor layout. In this system, we prioritize **Tonal Layering**.

*   **The Layering Principle:** Achieve depth by "stacking" surface-container tiers. Place a `surface_container_lowest` card on a `surface_container_low` section. The subtle color shift creates a soft, natural lift.
*   **Ambient Shadows:** When a "floating" effect is necessary (e.g., a dropdown), use extra-diffused shadows: `box-shadow: 0 12px 32px -4px rgba(11, 28, 48, 0.06)`. Note the shadow color is a tinted version of `on_surface`, not pure black.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility, it must be a "Ghost Border": `outline_variant` (#c4c5d7) at 20% opacity. **Forbid 100% opaque borders.**
*   **Roundedness:** Adhere to the `lg` (1rem) and `xl` (1.5rem) tokens for major containers, which corresponds to a moderate roundedness (level 2). This softness offsets the "tech" aesthetic to make the AI feel approachable.

---

## 5. Components

### Buttons
*   **Primary:** Gradient (Primary to Primary-Container), white text, `xl` roundedness. Large padding (12px 24px).
*   **Secondary:** No background, `outline_variant` Ghost Border (20% opacity), `primary` text.
*   **Tertiary:** `surface_container_high` background with `on_surface` text.

### Input Fields
*   **Default:** `surface_container_lowest` background. No border. Subtle `bottom-shadow` only.
*   **Focus:** Soft 2px glow using `primary` at 15% opacity.
*   **State:** Use `error` (#ba1a1a) only for critical validation; use `secondary` for helpful AI suggestions.

### Chips (AI Tags)
*   Use `secondary_container` with `on_secondary_container` text. These should be `full` rounded (pills) to contrast against the `lg` roundedness of cards.

### Cards & Lists
*   **Zero Dividers:** Forbid the use of divider lines. Separate list items using `spacing-md` (vertical white space) or by alternating subtle background shifts between `surface_container_low` and `surface_container_lowest`. The system uses a spacious layout (spacing level 3).

### New Component: The "Insight Rail"
*   A vertical, semi-transparent (`surface_variant` at 40%) bar used to group AI-generated suggestions or logs, providing a clear visual anchor without a heavy container.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use asymmetrical layouts where one column is significantly wider than the other to create visual interest.
*   **Do** use `primary_fixed` (#dce1ff) as a background for high-importance "Success" or "AI Active" states.
*   **Do** ensure text contrast ratios always exceed 4.5:1, especially when using blue-on-blue tonal shifts.

### Don't:
*   **Don't** use 1px borders to separate content. Use whitespace or tonal shifts.
*   **Don't** use sharp corners. Everything must feel organic and fluid (minimum 0.5rem radius, corresponding to roundedness level 2).
*   **Don't** use pure black (#000000) for text. Use `on_surface` (#0b1c30) to maintain the sophisticated blue-black tonal depth.
*   **Don't** crowd the interface. If an AI service platform feels busy, it feels like it’s struggling. Use `lg` and `xl` spacing tokens to let the data breathe (corresponding to spacing level 3).