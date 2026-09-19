// Board enclosure: a two-part case (base and lid) for a rectangular circuit board with four
// corner mounting holes on standoffs and one opening in a long side wall. Class C. Licence:
// CC0 1.0. Authored for the michani demo, 2026. Family reference: the open-source water
// quality tester (Wijnen, Anzalone and Pearce, 2014). The board preview uses NopSCADlib's
// perf board vitamin when show_board is 1; the exported part never includes it.

include <NopSCADlib/core.scad>
include <NopSCADlib/vitamins/pcbs.scad>

// Board length along x
board_length = 60; // [20:200]
// Board width along y
board_width = 40; // [20:200]
// Mounting hole diameter on the board
hole_diameter = 3; // [2:6]
// Distance from each board edge to the hole centre
hole_inset = 3.5; // [2:12]
// Height of the standoffs under the board
standoff_height = 5; // [3:15]
// Wall and floor thickness
wall_thickness = 2; // [1.2:4]
// Gap between the board edge and the inside wall
clearance = 0.3; // [0.1:2]
// Inside height of the lid above the board
lid_height = 15; // [5:60]
// Width of the side opening along x
opening_width = 12; // [4:100]
// Height of the side opening
opening_height = 8; // [3:50]
// Position of the opening centre along the long wall, from the board's x origin
opening_offset = 30; // [0:200]
// Which part to render: 0 both side by side, 1 base only, 2 lid only
part = 0; // [0:2]
// Show the perf board in place for preview: 0 no, 1 yes
show_board = 0; // [0:1]

$fn = 32;

inner_length = board_length + 2 * clearance;
inner_width = board_width + 2 * clearance;
outer_length = inner_length + 2 * wall_thickness;
outer_width = inner_width + 2 * wall_thickness;
base_height = wall_thickness + standoff_height + 2;
lid_outer_height = lid_height + wall_thickness;

// Board origin (its lower left corner) sits at [wall + clearance, wall + clearance, floor + standoff].
board_origin = [wall_thickness + clearance, wall_thickness + clearance, wall_thickness + standoff_height];

module hole_positions() {
  for (x = [hole_inset, board_length - hole_inset], y = [hole_inset, board_width - hole_inset])
    translate([x, y, 0]) children();
}

module base() {
  difference() {
    union() {
      difference() {
        cube([outer_length, outer_width, base_height]);
        translate([wall_thickness, wall_thickness, wall_thickness])
          cube([inner_length, inner_width, base_height]);
      }
      // Standoffs under each mounting hole.
      translate([board_origin[0], board_origin[1], wall_thickness])
        hole_positions() cylinder(h = standoff_height, d = hole_diameter + 2 * wall_thickness);
    }
    // Screw holes through the standoffs and the floor.
    translate([board_origin[0], board_origin[1], -1])
      hole_positions() cylinder(h = base_height + 2, d = hole_diameter);
  }
}

module lid() {
  difference() {
    cube([outer_length, outer_width, lid_outer_height]);
    translate([wall_thickness, wall_thickness, -1])
      cube([inner_length, inner_width, lid_height + 1]);
    // Side opening in the long wall at y = 0, centred on opening_offset along the board.
    translate([board_origin[0] + opening_offset - opening_width / 2, -1, -1])
      cube([opening_width, wall_thickness + 2, opening_height + 1]);
  }
}

module board_preview() {
  // NopSCADlib's perf board, placed at the board origin. Preview only.
  translate([board_origin[0] + board_length / 2, board_origin[1] + board_width / 2, board_origin[2]])
    pcb(PERF60x40);
}

if (part == 0 || part == 1) {
  base();
  if (show_board == 1) board_preview();
}
if (part == 0 || part == 2) {
  translate([part == 0 ? outer_length + 10 : 0, 0, 0]) lid();
}
