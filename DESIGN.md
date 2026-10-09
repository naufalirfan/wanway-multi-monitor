---
version: alpha
name: WanWay Monitor
description: Instrument-panel telemetry console for watching many IOPGPS vehicles at once.
colors:
  ink: "#0A0C0D"
  surface: "#14181B"
  surface-2: "#1B2024"
  line: "#262D33"
  text: "#E9E7E2"
  muted: "#959B9F"
  faint: "#868D92"
  accent: "#F5B544"
  accent-ink: "#1C1405"
  online: "#4CC38A"
  offline: "#E5534B"
  idle: "#7D8A94"
typography:
  display:
    fontFamily: IBM Plex Sans
    fontSize: 1.0625rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: IBM Plex Sans
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: IBM Plex Sans
    fontSize: 0.6875rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  data:
    fontFamily: IBM Plex Mono
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  sm: 7px
  md: 10px
  lg: 14px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
  field:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 9px
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sm}"
    padding: 10px
  button-primary-hover:
    backgroundColor: "{colors.text}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.offline}"
    rounded: "{rounded.sm}"
    padding: 4px
  vehicle-row:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 10px
---

## Overview

A **Monitor** surface: the operator is watching many vehicles report in from many
IOPGPS accounts at once. Density and glanceability beat expression, so the
composition is fixed — a control panel on the left, the map on the right — and the
craft lives in the panel's type, status system and states.

Dark is chosen from the use scene, not the category: the map is the bright surface,
so the chrome around it stays low-luminance to keep the vehicle layer readable.

## Colors

- **Ink (#0A0C0D) / Surface (#14181B):** warm-neutral near-black. Not the Tailwind
  slate-blue that every generated dashboard reaches for.
- **Accent (#F5B544):** phosphor amber — the instrument signal. Carries interaction
  only; never status.
- **Status trio** is separate from the accent: `online` green, `offline` red,
  `idle` slate for "reporting, no fix". Three states, no fourth.

## Typography

IBM Plex Sans for UI, IBM Plex Mono for measured data (IMEI, coordinates,
timestamps) — mono is earned here because the values are literal measurements, not
a costume. Labels are small, uppercase, tracked.

## Layout

Fixed control panel (340px) beside a flexible map. Below 760px the panel stacks on
top of the map and scrolls independently. Rhythm: tight within a vehicle row,
generous between accounts.

## Shapes

Two radii only — 7px controls, 10px containers. No pills except status dots.

## Components

`button-primary` is the single high-emphasis action (add account). Everything else
is a quiet surface: fields and rows sit on `surface-2`, borders are 1px `line`.
Vehicle rows lead with the status dot, then name, then mono IMEI, then right-aligned
relative time.

## Do's and Don'ts

- Do let status color be the only saturated thing in the panel.
- Do theme browser surfaces (selection, caret, scrollbar, focus ring) from the palette.
- Don't add emoji, gradients, glass, or a colored left rail on rows.
- Don't put a hero, a big metric, or icon-topped cards on a Monitor surface.
