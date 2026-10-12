# UML design verification

Draw a UML design in draw.io, let an AI implement it in C++, and see exactly where the
implementation differs from the design: as a report, and as a colour-coded draw.io diagram.

## Try it

1. Open this folder in VS Code. Install the recommended extensions when it asks.
2. Press **Ctrl+Shift+B** (**Cmd+Shift+B** on macOS) and choose an example.
3. Open that example's `reports/class-report.md` and click
   **Open the colour-coded comparison in draw.io**. The legend on each page explains the colours.

You need Python 3, CMake and a C++20 compiler (on macOS, the Xcode Command Line Tools). The first
run sets up `.venv/` with libclang, which takes a minute.

**Windows:** only Python 3 is needed. The first run installs one fixed toolchain, MSYS2 (gcc,
cmake, ninja), through `winget`, after asking you (about 1 GB, once). It is used instead of Visual
Studio, so every PC behaves the same. Without `winget`, install MSYS2 from msys2.org and run
`pacman -S --needed mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-ninja`
in the *MSYS2 UCRT64* shell.

## How it works

```
diagrams/input/class.drawio              ← a person draws the design: the class diagram
diagrams/input/state-<class>.drawio      ← for a class that has one, its state machine
diagrams/input/sequence-<scenario>.drawio ← for a scenario worth showing, its sequence diagram
impl/                                    ← an AI writes the C++

        Ctrl+Shift+B

reports/<design>-report.md                    what differs, with an alignment score, per design
diagrams/output/<design>-comparison.drawio    design and implementation side by side,
                                              every difference coloured
```

The implemented design is read from the code by libclang, not by an AI; a sequence diagram is
recorded by running its scenario. The same design and the same code therefore always give the
same report.

## Examples

| Example | What it shows | Alignment |
|---|---|:-:|
| [1-class-simple](examples/1-class-simple/) | 3 classes, implemented exactly as designed | 100 % |
| [2-class-library](examples/2-class-library/) | 11 classes, with three deliberate mistakes to find | 90.7 % |
| [3-state-simple](examples/3-state-simple/) | 1 class with a state machine, implemented exactly as designed | 100 % |
| [4-state-order](examples/4-state-order/) | 2 state machines with guards, actions and a self-transition, three deliberate mistakes to find | 86.7 %, 81.2 % |
| [5-sequence-simple](examples/5-sequence-simple/) | 1 scenario over 3 classes, implemented exactly as designed | 100 % |
| [6-sequence-library](examples/6-sequence-library/) | 2 scenarios over 5 classes, three deliberate mistakes to find | 80.0 %, 77.8 % |

## The examples as stories

Every push to `main` publishes the examples on GitHub Pages
([.github/workflows/pages.yml](.github/workflows/pages.yml)): the workflow verifies every
project from scratch, and [tools/site/build_site.py](tools/site/build_site.py) tells each one as
an interactive story, picked from a dropdown — the drawings, the C++, the verdict, and the
design and the code running side by side. Fire events at a state machine and watch the
drawing and the transition table move together, or part ways where the code has a mistake;
step through a scenario call by call.

Nothing to write per example: a new folder under `examples/` (or your `project/`, once it has a
drawing) becomes a story on the next push. To preview locally, run the VS Code task *Preview the
stories*, or `.venv/bin/python tools/site/build_site.py && .venv/bin/python -m http.server -d _site`.

## Your own design

Your work goes in [`project/`](project/), which is always first in the menu:

```
project/
  diagrams/input/class.drawio              1. draw your class diagram here
  diagrams/input/state-<class>.drawio         if a class has one, its state machine
  diagrams/input/sequence-<scenario>.drawio   for a scenario worth showing, its sequence diagram
  impl/CMakeLists.txt                      2. the AI writes the implementation here
  impl/include/…                              (the headers are what gets compared)
  impl/src/…
  impl/scenarios/…                            (one program per sequence diagram, run and recorded)
```

Run the task after each step. With no drawing yet, it tells you where to save one. With a drawing
but no implementation, it converts each design to `diagrams/output/<design>-design.mmd`, the text
version to hand to the AI. Once both exist, you get a report per design.

In VS Code, create the file and it opens in the draw.io editor. The class, state and sequence
shapes are under **More Shapes › UML**. The file's name says what kind of diagram it is:
`class.drawio` is the class diagram, `state-order.drawio` the state machine of the class
`Order`, `sequence-place_order.drawio` the scenario *place order*.

## In this repository

| Folder | Contains |
|---|---|
| [`project/`](project/) | your own design and implementation |
| [`examples/`](examples/) | worked examples |
| [`tools/`](tools/) | `verify.py`, which the task runs, the `umlverify` library, and `render-drawio` |
| [`.vscode/`](.vscode/) | the *Verify design* task and the recommended extensions |

AI agents implementing a design are guided by [`AGENTS.md`](AGENTS.md): where to write, which
structure to use, and how UML maps to C++.

How the verification works, and how to add a diagram type:
[tools/umlverify/docs/](tools/umlverify/docs/README.md). How UML maps to C++:
[UML-CPP-MAPPING.md](tools/umlverify/docs/UML-CPP-MAPPING.md).

**Not there yet:** a devcontainer, fragments (alt/loop/opt) in sequence diagrams, and diagram
types other than class, state and sequence diagrams.

# 1. What the program recorded (first lines)
Get-Content examples\5-sequence-simple\build-trace\traces\set_target.txt -TotalCount 8

# 2. What the executable's symbol table says
$nm = "C:\msys64\ucrt64\bin\nm.exe"
$exe = Get-ChildItem examples\5-sequence-simple\build-trace -Recurse -Filter scenario_set_target.exe | Select -First 1
& $nm -n --demangle $exe.FullName | Select-String "uml_trace_reference|setTarget|Thermostat" | Select -First 8
