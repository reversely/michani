# Michani

Michani turns a conversation into a printable part. A person says what they need, answers questions about size and material, confirms a plan, and receives an STL mesh, the OpenSCAD source with its values set, and a report of every check that ran on it.

The programme exists for people who have a printer and no design file: field engineers on water and solar projects who need a bracket or fitting that matches hardware already on site, and people using a shared printer at a library, school, or makerspace who need a tool at filament cost.

## The flow

Every part goes through the same three steps: requirements, build, verification. The session state machine in `src/engine/session.ts` runs them in order and refuses any transition an agent has not earned.

### 1. Requirements

The requirements agent turns the conversation into a specification: the part, its dimensions in millimetres, the material, the hardware it fits, the load, and the environment. Size and material are the two facts it asks for until it has them. From the specification it writes a plan that names a library design to adapt or, when none matches, generation of new code, plus the risk label and the checks that will run. The person confirms the plan, and nothing is built before that.

![Specification and plan for tweezers, awaiting confirmation](docs/screenshots/1-requirements.png)

### 2. Build

Adaptation sets the declared parameters of a library design and writes no geometry. Generation writes new OpenSCAD from the specification and the plan. Either way the OpenSCAD source renders in the browser, each declared parameter appears as a slider limited to its declared range, and the mesh exports as STL, SCAD, or DXF.

![A rendered part with its parameters as sliders and an STL export](docs/screenshots/2-build.png)

### 3. Verification

Every build passes through the registered checks before it reaches the person. Each check returns pass, warn, fail, or did not run with its reason, and the report quotes the evidence. Here the tweezers pass parameter limits, mesh validity, and printable size, and requirement coverage warns where a parameter name does not map to a stated requirement.

![Check report for the tweezers: three passes, one warning, two checks not applicable to class A](docs/screenshots/3-verification-pass.png)

A failed verdict goes back to the build step with its finding, up to three times. A generated stool fails here twice over: the mesh has open edges, and its largest dimension exceeds a 200 mm bed. The plan carries the risk label "needs expert review" because the part bears a person's weight.

![Check report for a generated stool: mesh validity fails, printable size warns](docs/screenshots/3-verification-fail.png)

## The library

Each design under `library/` is one OpenSCAD file and one JSON record. The record declares every adjustable value with a default, a minimum, and a maximum, and states the source, licence, attribution, part class, risk label, and evidence level. Evidence levels run from untested through prototyped and field used to test data published and clinically validated.

Adding a design means adding one folder. The current five are tweezers, a key turner, a pipe adapter, a panel mounting clip, and a two-part board enclosure. Shared components and material properties sit beside them in `library/components` and `library/materials.json`.

## Verification

Checks under `src/server/verification/checks` register against one interface. The current set covers parameter limits, mesh validity, printable size, requirement coverage, fit clearance, and hole alignment. Each returns pass, warn, fail, or did not run with its reason, and the report quotes the evidence.

The verification agents in `src/engine/agents/verification.ts` group those checks into geometry, coverage, printability, and fit verdicts. A part for medical, drinking-water, or load-bearing use carries the risk label "needs expert review" in its plan and report.

## Running it

Node.js 20.19 or 22.12 and newer, npm 10, Docker Desktop, the Supabase CLI, and an Anthropic API key. Every agent step calls Anthropic, so one key covers the application.

```bash
git clone https://github.com/reversely/michani.git
cd michani
npm install
uv sync                                 # pre-commit tooling
supabase start -x logflare,vector       # local database and auth
cp .env.local.template .env.local       # Supabase URL and keys from `supabase status`, plus ANTHROPIC_API_KEY
npm run dev                             # http://localhost:3000/cadam/engine
```

The other provider keys in the template stay as placeholders.

## Tests

```bash
npm run typecheck && npm run lint && npm run test:unit     # fast suite, recorded model answers
npm run test:e2e                                           # Playwright, needs Supabase and the dev server
LIVE_AGENT_TESTS=1 npm run test:unit -- agents             # calls Anthropic
```

The pre-commit hook runs file hygiene, the type check, and lint-staged.

## Layout

| Path                       | Contents                                                                         |
| -------------------------- | -------------------------------------------------------------------------------- |
| `src/engine`               | Session state machine, loop, requirements and verification agents, tool registry |
| `src/server/agents`        | Library, drafting, and generation prompts and output schemas                     |
| `src/server/verification`  | Check registry and the checks                                                    |
| `src/server/report`        | Check report and package builder                                                 |
| `src/views/EngineView.tsx` | The workspace and conversation screen                                            |
| `library/`                 | Designs and their metadata records                                               |
| `tests/`                   | Unit, render, and end-to-end suites with recorded fixtures                       |
| `supabase/`                | Migrations and local stack configuration                                         |

## CAD

OpenSCAD is the only CAD language. Library files declare their adjustable values as top-level variables with Customizer range comments, and the drafting agent passes values as variable overrides without touching the file body. Rendering runs in the browser through an OpenSCAD WebAssembly build with the BOSL, BOSL2, MCAD, and NopSCADlib libraries, and the editor exports STL, SCAD, and DXF.

That renderer, the parameter sliders, the export path, and the Supabase-backed application shell come from [CADAM](https://github.com/Adam-CAD/CADAM) by AdamCAD, which this repository forks. Michani is distributed under the GNU General Public License v3.0 (see `LICENSE`), the same licence as CADAM and the portions of openscad-web-gui it derives from. The bundled OpenSCAD WASM binaries are GPL v2 or later, distributed here under GPLv3 as part of the combined work; see `src/vendor/openscad-wasm/SOURCE-OFFER.txt`. Each library design carries its own licence and attribution in its metadata record, and the package copies them into the download.
