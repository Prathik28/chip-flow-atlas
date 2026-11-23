# 🧩 Chip Flow Atlas

[![guides](https://github.com/Prathik28/chip-flow-atlas/actions/workflows/guides.yml/badge.svg)](https://github.com/Prathik28/chip-flow-atlas/actions/workflows/guides.yml) [![links](https://github.com/Prathik28/chip-flow-atlas/actions/workflows/links.yml/badge.svg)](https://github.com/Prathik28/chip-flow-atlas/actions/workflows/links.yml)

A fun, beginner-friendly guide to **how computer chips are designed**: which tool is used, when, and where to learn it.

**🌐 Live site: https://chip-flow-atlas.web.app**

When I was a beginner, I struggled to understand which website does what and where to start. This site is the guide I wish I'd had.

## What's inside

| Section | What it does |
| --- | --- |
| 🚀 **Start here** | Pick a goal (play with an FPGA, make a real chip, or design analog circuits) and get a step-by-step learning path with free tools and websites. |
| 📋 **Steps** | The whole chip design journey as a flowchart for **Digital ASIC**, **FPGA** and **Analog** flows. Each step explains the tools, what goes in and out, and where you loop back if something fails. |
| 🗺️ **Map** | The same journey drawn as boxes and arrows, with dashed arrows showing failure loops. |
| 🧊 **3D FPGA board** | A board you can spin and zoom. Tap any part to learn what it does, then run sample Verilog programs (blink, button logic, counter, light chaser, traffic light) and watch the LEDs react. Includes a list of real beginner boards. |
| 🛠️ **Project guides** | Four hands-on beginner projects with code to copy and the output to expect: simulate a counter, see it as real gates, simulate an analog circuit, and blink LEDs on an iCEBreaker FPGA board. |
| 🤔 **Help me choose** | Answer a few questions about your problem and get the right tool. |
| 📖 **Words explained** | A plain-English glossary (RTL, netlist, GDSII, tape-out and more). |

There is also a search box that finds any tool by name or description.

## Links to sections

Every section has its own address, so you can bookmark it or send it to a friend, and the browser's Back button works:

- `#start`: the home page
- `#steps/asic`, `#steps/fpga`, `#steps/analog`: the design flow for each kind of chip
- `#map/asic`, `#map/fpga`, `#map/analog`: the same flows as boxes and arrows
- `#board`: the 3D FPGA board
- `#guides`, or one guide directly: `#guides/sim`, `#guides/synth`, `#guides/spice`, `#guides/fpga`
- `#choose`: "Help me choose"
- `#words`: the glossary

For example: `https://chip-flow-atlas.web.app/#map/fpga`

## Run it locally

It's a single static file with no build step and no dependencies.

Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Notes

- The 3D board is built with plain CSS 3D transforms, with no libraries.
- The sample programs use a simplified step-by-step simulation to show what each piece of Verilog does. It is not a real Verilog simulator.
- Tool names are examples of common choices, not an exhaustive or ranked list. Commercial EDA licenses and foundry PDKs vary by company and process node. Prices and availability of boards change, so check the seller's page.
- Fonts (Fredoka and Nunito) load from Google Fonts. If they can't load, the site falls back to a plain rounded system font.

## Automatic checks

Two checks run on GitHub, and the badges at the top show their latest result:

- **guides**: runs the code and commands from every project guide (Icarus Verilog, Yosys and ngspice) and checks they still give the results the guides promise. It runs on every push.
- **links**: checks that every web link in the site and this README still works. It runs every Monday and whenever the page or README changes. Sites that refuse automated checks (for example LinkedIn) only produce a warning, not a failure.

You can run both yourself:

```bash
node scripts/check-guides.mjs   # needs iverilog, yosys and ngspice installed
node scripts/check-links.mjs
```

## License

Released under the [MIT License](LICENSE).

## Made by

**PRATHIK AMTE**: [LinkedIn](https://www.linkedin.com/in/prathik-amte-313367296/)
