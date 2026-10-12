---
name: drawio-visual-check
description: Render .drawio files to PNG and inspect them visually. Use after creating or changing any .drawio file (a design in diagrams/input/, a generated class-comparison.drawio, or code in tools/umlverify that writes draw.io), and before claiming a diagram is correct or looks right. Reading the XML is not enough — line routing, label placement and clipping only show in a render.
---

# Checking draw.io diagrams visually

draw.io files are XML, but whether a diagram is *readable* depends on how draw.io lays it out:
where lines route, where labels land, whether text fits. None of that can be judged from the XML.
Render the file and look at the image.

## Render

```bash
npm install --prefix tools/render-drawio          # once; installs puppeteer (headless Chromium)
node tools/render-drawio/render.js <file.drawio>... [--page N] [--out DIR] [--scale S]
```

- Renders every page unless `--page N` (0-based) is given.
- Writes PNGs to `.cache/drawio-renders/` (gitignored) and prints their paths, one per line.
- Uses draw.io's own viewer, downloaded once into `.cache/drawio-viewer/`, so what you see is
  what the VS Code extension and app.diagrams.net show.

Then open each printed PNG and look at it — with your file-reading or image tool (in Claude
Code, the Read tool). If you cannot view images, do not guess from the XML: ask the user to open
the PNG or attach it to the chat, and say which pages to look at. Render **every** page of a
comparison — page 1 (design) and page 2 (implemented) differ.

Running the renderer is a terminal command; in GitHub Copilot the user is asked to approve it.

## What to check

Go through this list for each image; report what you actually see, not what the XML implies.

**Lines**
- No line passes through a class box. A line crossing a box reads as a relation to that class.
- Lines meet a class at its border, not along an internal divider (it then looks like one line
  running through the class).
- Two relations between the same pair of classes are visibly separate, not drawn on top of each
  other.
- Crossings between lines are clean right angles, and as few as the layout allows.

**UML notation** (see `tools/umlverify/docs/UML-CPP-MAPPING.md`, "Drawing relations")
- Composition: filled diamond at the owner. Aggregation: hollow diamond at the owner.
  Inheritance / realization: hollow triangle at the parent (realization dashed).
  Dependency: dashed with an open arrowhead. Association: open arrowhead.
- Role name and multiplicity sit at the far end, either side of the line, **beside** the class —
  never on top of an arrowhead, diamond or triangle.
- No invented multiplicity at the near end.

**Text**
- Every class name, «stereotype» and member is fully visible: nothing clipped, nothing spilling
  into the next row.
- «interface» / «enumeration» headers are tall enough for both lines.

**Comparison drawings** (`class-comparison.drawio`)
- The legend is present on both pages and its counts match `reports/class-report.md`.
- Colours: amber = changed (both pages), red = missing (design page), green = extra and
  grey = not counted (implemented page). Nothing is coloured that the report does not list.
- Classes the AI added sit in the column on the right and their lines route around other classes.

## Known draw.io quirks

- **Italic text is clipped** when a cell has `overflow=hidden`: draw.io clips to the upright
  width, cutting the last letter. Italic rows (abstract methods) must not set `overflow=hidden`.
- **draw.io's router does not avoid boxes.** An edge without waypoints or exit/entry points is
  routed straight through whatever is in the way; give it explicit routing
  (`tools/umlverify/core/routing.py` does this for generated lines).
- **Stacked member rows are not re-laid out by the viewer**: a row's `y` in the XML is where it
  is drawn, so rows must be positioned correctly when written.

## When the render is wrong

Fix the generator or the drawing, re-render, and look again. Do not stop at the first fix: one
change (a wider box, a moved class) often shifts other lines and labels.
